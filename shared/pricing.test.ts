import { describe, expect, it } from "vitest";
import { computeTotals, diffPlans, hasChanges, lineTotal, reconcilePrices } from "./pricing";
import type { Plan, PriceItem, Procedure } from "./schema";

const priceList: PriceItem[] = [
  { id: "scaling", name: "Scaling", aliases: [], category: "Hygiene", price: 80 },
  { id: "rct-molar", name: "RCT molar", aliases: [], category: "Endo", price: 300 },
  { id: "unpriced", name: "Something", aliases: [], category: "X", price: null },
];

function proc(p: Partial<Procedure>): Procedure {
  return {
    id: "p1",
    name: "x",
    teeth: [],
    quantity: 1,
    priceSource: "missing",
    priceListId: null,
    unitPrice: null,
    discountPercent: 0,
    notes: "",
    ...p,
  };
}

function plan(procs: Procedure[][], discountPercent = 0): Plan {
  return {
    patient: { name: "", notes: "" },
    stages: procs.map((procedures, i) => ({
      id: `s${i + 1}`,
      title: `Stage ${i + 1}`,
      goal: "",
      intervalBeforeStage: null,
      visits: null,
      procedures,
    })),
    discountPercent,
    generalNotes: "",
    assumptions: [],
  };
}

describe("reconcilePrices", () => {
  it("applies the list price even if the model wrote a different number", () => {
    const out = reconcilePrices(plan([[proc({ priceSource: "list", priceListId: "scaling", unitPrice: 999 })]]), priceList);
    const p = out.stages[0].procedures[0];
    expect(p.unitPrice).toBe(80);
    expect(p.priceSource).toBe("list");
  });

  it("marks an unknown price-list id as missing", () => {
    const out = reconcilePrices(plan([[proc({ priceSource: "list", priceListId: "nope", unitPrice: 50 })]]), priceList);
    const p = out.stages[0].procedures[0];
    expect(p.priceSource).toBe("missing");
    expect(p.unitPrice).toBeNull();
    expect(p.priceListId).toBeNull();
  });

  it("marks a list item whose price is not set as missing", () => {
    const out = reconcilePrices(plan([[proc({ priceSource: "list", priceListId: "unpriced" })]]), priceList);
    expect(out.stages[0].procedures[0].priceSource).toBe("missing");
  });

  it("keeps dictated and manual prices", () => {
    const out = reconcilePrices(
      plan([[proc({ id: "a", priceSource: "dictated", unitPrice: 1200 }), proc({ id: "b", priceSource: "manual", unitPrice: 45 })]]),
      priceList,
    );
    expect(out.stages[0].procedures.map((p) => [p.priceSource, p.unitPrice])).toEqual([
      ["dictated", 1200],
      ["manual", 45],
    ]);
  });

  it("forces a dictated/manual source with no price to missing", () => {
    const out = reconcilePrices(plan([[proc({ priceSource: "dictated", unitPrice: null })]]), priceList);
    expect(out.stages[0].procedures[0].priceSource).toBe("missing");
  });

  it("clears a stray price on a missing item", () => {
    const out = reconcilePrices(plan([[proc({ priceSource: "missing", unitPrice: 70 })]]), priceList);
    expect(out.stages[0].procedures[0].unitPrice).toBeNull();
  });

  it("clamps quantity to a whole number >= 1 and fills missing / duplicate ids", () => {
    const out = reconcilePrices(
      plan([[proc({ id: "", quantity: 0 }), proc({ id: "dup", quantity: 2.6 }), proc({ id: "dup" })]]),
      priceList,
    );
    const ps = out.stages[0].procedures;
    expect(ps[0].quantity).toBe(1);
    expect(ps[1].quantity).toBe(3);
    const ids = ps.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it("does not mutate its input", () => {
    const input = plan([[proc({ priceSource: "list", priceListId: "scaling", unitPrice: 1 })]]);
    reconcilePrices(input, priceList);
    expect(input.stages[0].procedures[0].unitPrice).toBe(1);
  });
});

describe("computeTotals", () => {
  it("sums stages, applies discount, counts missing prices", () => {
    const p = plan(
      [
        [proc({ id: "a", priceSource: "list", priceListId: "scaling", unitPrice: 80 })],
        [
          proc({ id: "b", priceSource: "dictated", unitPrice: 300, quantity: 2 }),
          proc({ id: "c", priceSource: "missing", unitPrice: null }),
        ],
      ],
      10,
    );
    const t = computeTotals(p);
    expect(t.stages).toEqual([
      { stageId: "s1", subtotal: 80, missingCount: 0 },
      { stageId: "s2", subtotal: 600, missingCount: 1 },
    ]);
    expect(t.subtotal).toBe(680);
    expect(t.discount).toBe(68);
    expect(t.total).toBe(612);
    expect(t.missingCount).toBe(1);
  });

  it("rounds to 2 decimals and ignores out-of-range discounts", () => {
    const p = plan([[proc({ priceSource: "manual", unitPrice: 10.333, quantity: 3 })]], 150);
    const t = computeTotals(p);
    expect(t.subtotal).toBe(31);
    expect(t.discount).toBe(31);
    expect(t.total).toBe(0);
    expect(computeTotals(plan([[proc({ priceSource: "manual", unitPrice: 50 })]], -5)).discount).toBe(0);
  });

  it("handles an empty plan", () => {
    expect(computeTotals(plan([]))).toEqual({ stages: [], gross: 0, itemDiscount: 0, subtotal: 0, discount: 0, total: 0, missingCount: 0 });
  });
});

describe("item discounts", () => {
  it("applies the item discount to the line and reports the savings", () => {
    const p = plan([
      [
        proc({ id: "a", priceSource: "dictated", unitPrice: 100, quantity: 4, discountPercent: 30 }),
        proc({ id: "b", priceSource: "dictated", unitPrice: 50 }),
      ],
    ]);
    expect(lineTotal(p.stages[0].procedures[0])).toBe(280);
    const t = computeTotals(p);
    expect(t.gross).toBe(450);
    expect(t.itemDiscount).toBe(120);
    expect(t.subtotal).toBe(330);
    expect(t.total).toBe(330);
  });

  it("applies the plan discount after item discounts", () => {
    const p = plan([[proc({ priceSource: "dictated", unitPrice: 200, discountPercent: 50 })]], 10);
    const t = computeTotals(p);
    expect(t.subtotal).toBe(100);
    expect(t.discount).toBe(10);
    expect(t.total).toBe(90);
  });

  it("clamps out-of-range item discounts when reconciling", () => {
    const r = reconcilePrices(
      plan([[proc({ id: "a", priceSource: "dictated", unitPrice: 10, discountPercent: 150 }), proc({ id: "b", priceSource: "dictated", unitPrice: 10, discountPercent: -5 })]]),
      priceList,
    );
    expect(r.stages[0].procedures.map((x) => x.discountPercent)).toEqual([100, 0]);
  });

  it("gives no line total for a missing price, whatever the discount", () => {
    expect(lineTotal(proc({ discountPercent: 20 }))).toBeNull();
  });
});

describe("diffPlans", () => {
  it("finds added, changed and removed procedures and stages", () => {
    const before = plan([[proc({ id: "a", name: "Scaling" }), proc({ id: "b", name: "Filling" })]]);
    const after = plan([
      [proc({ id: "a", name: "Scaling" }), proc({ id: "c", name: "Crown" })],
      [proc({ id: "d", name: "Implant" })],
    ]);
    after.stages[0].procedures[0] = { ...after.stages[0].procedures[0], teeth: ["36"] };
    const d = diffPlans(before, after);
    expect(d.addedProcedureIds).toEqual(["c", "d"]);
    expect(d.changedProcedureIds).toEqual(["a"]);
    expect(d.addedStageIds).toEqual(["s2"]);
    expect(d.removed).toEqual(["Filling"]);
    expect(hasChanges(d)).toBe(true);
  });

  it("reports nothing for identical plans", () => {
    const p = plan([[proc({ id: "a" })]]);
    expect(hasChanges(diffPlans(p, structuredClone(p)))).toBe(false);
  });
});
