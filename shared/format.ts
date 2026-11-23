import type { Interval, Plan, Settings } from "./schema";

export function formatMoney(n: number | null, settings: Pick<Settings, "currency">): string {
  if (n === null) return "—";
  const num = n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  const c = settings.currency.trim();
  if (!c) return num;
  // Symbols go in front ($1,200), codes go after (1,200 DZD).
  return c.length === 1 ? `${c}${num}` : `${num} ${c}`;
}

export function formatInterval(i: Interval): string {
  const unit = i.value === 1 ? i.unit.replace(/s$/, "") : i.unit;
  return `${i.value} ${unit}`;
}

/** "Start: immediately" / "2 weeks after Stage 1" */
export function stageTimingLabel(plan: Plan, index: number): string {
  const stage = plan.stages[index];
  if (index === 0) {
    return stage.intervalBeforeStage ? `Starts in ${formatInterval(stage.intervalBeforeStage)}` : "Starts immediately";
  }
  const prev = `Stage ${index}`;
  return stage.intervalBeforeStage ? `${formatInterval(stage.intervalBeforeStage)} after ${prev}` : `Right after ${prev}`;
}

export const toDays = (i: Interval | null) =>
  !i ? 0 : i.unit === "days" ? i.value : i.unit === "weeks" ? i.value * 7 : i.value * 30;

/** Day offset at which each stage starts (0 for the first, unless it has a wait). */
export function stageStartDays(plan: Plan): number[] {
  let days = 0;
  return plan.stages.map((s) => (days += toDays(s.intervalBeforeStage)));
}

/** Total time from the first to the last stage, in days. */
export const planDurationDays = (plan: Plan) => stageStartDays(plan).at(-1) ?? 0;

/** "3 weeks", "about 7 months", "1 year 2 months". */
export function formatDuration(days: number): string {
  if (days <= 0) return "a single phase";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  const months = Math.round(days / 30);
  if (months < 12) return `about ${months} months`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return `about ${y} year${y > 1 ? "s" : ""}${m ? ` ${m} month${m > 1 ? "s" : ""}` : ""}`;
}

/** Rough cumulative start time of each stage, e.g. "Week 2", "Month 4". */
export function estimatedStartLabels(plan: Plan): string[] {
  let days = 0;
  return plan.stages.map((s) => {
    days += toDays(s.intervalBeforeStage);
    if (days === 0) return "Now";
    if (days < 14) return `Day ${days}`;
    if (days < 60) return `Week ${Math.round(days / 7)}`;
    return `Month ${Math.round(days / 30)}`;
  });
}

export const teethLabel = (teeth: string[]) => teeth.join(", ");
