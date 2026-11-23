import type { Plan, PlanChanges, PriceItem, Procedure, Totals } from "./schema";

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampPct = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);

/**
 * Enforces pricing rules on a plan produced by the agent (or edited by hand):
 *  - "list" items always take the current price-list price (the model can't invent one)
 *  - unknown / unpriced list items become "missing"
 *  - "dictated" / "manual" prices are kept, unless empty → "missing"
 *  - quantities are whole numbers >= 1; item discounts are 0–100; ids are non-empty and unique
 * Returns a new plan; the input is not mutated.
 */
export function reconcilePrices(plan: Plan, priceList: PriceItem[]): Plan {
  const byId = new Map(priceList.map((p) => [p.id, p]));
  const seenStage = new Set<string>();
  const seenProc = new Set<string>();
  let counter = 0;
  const uniqueId = (wanted: string, seen: Set<string>, prefix: string) => {
    let id = wanted.trim();
    while (!id || seen.has(id)) id = `${prefix}${++counter}`;
    seen.add(id);
    return id;
  };

  return {
    ...plan,
    patient: { ...plan.patient },
    discountPercent: clampPct(plan.discountPercent),
    assumptions: [...plan.assumptions],
    stages: plan.stages.map((stage) => ({
      ...stage,
      id: uniqueId(stage.id, seenStage, "s"),
      intervalBeforeStage: stage.intervalBeforeStage ? { ...stage.intervalBeforeStage } : null,
      procedures: stage.procedures.map((proc) => reconcileProcedure(proc, byId, uniqueId(proc.id, seenProc, "p"))),
    })),
  };
}

function reconcileProcedure(proc: Procedure, byId: Map<string, PriceItem>, id: string): Procedure {
  const quantity = Number.isFinite(proc.quantity) ? Math.max(1, Math.round(proc.quantity)) : 1;
  const base: Procedure = { ...proc, id, quantity, discountPercent: clampPct(proc.discountPercent), teeth: [...proc.teeth] };

  if (proc.priceSource === "list") {
    const item = proc.priceListId ? byId.get(proc.priceListId) : undefined;
    if (item && item.price !== null) return { ...base, unitPrice: item.price };
    return { ...base, priceSource: "missing", priceListId: item ? item.id : null, unitPrice: null };
  }

  if (proc.priceSource === "dictated" || proc.priceSource === "manual") {
    if (proc.unitPrice === null || !Number.isFinite(proc.unitPrice) || proc.unitPrice < 0) {
      return { ...base, priceSource: "missing", unitPrice: null };
    }
    return base;
  }

  return { ...base, priceSource: "missing", unitPrice: null };
}

export const isPriceMissing = (p: Procedure) => p.priceSource === "missing" || p.unitPrice === null;

/** Line amount after the item's own discount; null when the price is missing. */
export function lineTotal(p: Procedure): number | null {
  if (isPriceMissing(p)) return null;
  return round2((p.unitPrice as number) * p.quantity * (1 - clampPct(p.discountPercent) / 100));
}

/** Stage subtotals, item and plan discounts, and grand total. Missing prices are counted, never guessed. */
export function computeTotals(plan: Plan): Totals {
  let gross = 0;
  const stages = plan.stages.map((stage) => {
    let subtotal = 0;
    let missingCount = 0;
    for (const p of stage.procedures) {
      const amount = lineTotal(p);
      if (amount === null) missingCount++;
      else {
        subtotal += amount;
        gross += (p.unitPrice as number) * p.quantity;
      }
    }
    return { stageId: stage.id, subtotal: round2(subtotal), missingCount };
  });
  const subtotal = round2(stages.reduce((s, x) => s + x.subtotal, 0));
  const discount = round2((subtotal * clampPct(plan.discountPercent)) / 100);
  return {
    stages,
    gross: round2(gross),
    itemDiscount: round2(gross - subtotal),
    subtotal,
    discount,
    total: round2(subtotal - discount),
    missingCount: stages.reduce((s, x) => s + x.missingCount, 0),
  };
}

const procKey = (p: Procedure) =>
  JSON.stringify([p.name, p.teeth, p.quantity, p.priceSource, p.priceListId, p.unitPrice, p.discountPercent, p.notes]);

/**
 * What changed from `before` to `after`, by id: new and edited procedures and stages,
 * plus readable names of removed items. Used to highlight an assistant turn's edits.
 */
export function diffPlans(before: Plan, after: Plan): PlanChanges {
  const oldProcs = new Map(before.stages.flatMap((s) => s.procedures.map((p) => [p.id, p] as const)));
  const newProcs = new Set(after.stages.flatMap((s) => s.procedures.map((p) => p.id)));
  const oldStages = new Map(before.stages.map((s) => [s.id, s]));
  const newStages = new Set(after.stages.map((s) => s.id));
  const changes: PlanChanges = {
    addedProcedureIds: [],
    changedProcedureIds: [],
    addedStageIds: [],
    changedStageIds: [],
    removed: [],
  };

  for (const stage of after.stages) {
    const old = oldStages.get(stage.id);
    if (!old) changes.addedStageIds.push(stage.id);
    else if (
      old.title !== stage.title ||
      old.goal !== stage.goal ||
      old.visits !== stage.visits ||
      JSON.stringify(old.intervalBeforeStage) !== JSON.stringify(stage.intervalBeforeStage)
    ) {
      changes.changedStageIds.push(stage.id);
    }
    for (const p of stage.procedures) {
      const prev = oldProcs.get(p.id);
      if (!prev) changes.addedProcedureIds.push(p.id);
      else if (procKey(prev) !== procKey(p)) changes.changedProcedureIds.push(p.id);
    }
  }
  for (const s of before.stages) {
    if (!newStages.has(s.id)) changes.removed.push(s.title || "a stage");
    else for (const p of s.procedures) if (!newProcs.has(p.id)) changes.removed.push(p.name || "a procedure");
  }
  return changes;
}

export const hasChanges = (c: PlanChanges | null | undefined) =>
  !!c &&
  c.addedProcedureIds.length + c.changedProcedureIds.length + c.addedStageIds.length + c.changedStageIds.length + c.removed.length > 0;
