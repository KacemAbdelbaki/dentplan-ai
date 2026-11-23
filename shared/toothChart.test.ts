import { describe, expect, it } from "vitest";
import { chartLayout, dominantMark, fdiToUniversal, markOf, teethWork, timelinePositions } from "./toothChart";
import { formatDuration, planDurationDays, stageStartDays } from "./format";
import { emptyPlan, migratePlan, migrateSavedPlan, type Plan, type Procedure, type SavedPlan } from "./schema";

const proc = (p: Partial<Procedure>): Procedure => ({
  id: "p",
  name: "x",
  teeth: [],
  quantity: 1,
  priceSource: "missing",
  priceListId: null,
  unitPrice: null,
  discountPercent: 0,
  notes: "",
  ...p,
});

describe("tooth numbering", () => {
  it("converts FDI to Universal", () => {
    expect([18, 11, 21, 28, 38, 31, 41, 48].map(fdiToUniversal)).toEqual([1, 8, 9, 16, 17, 24, 25, 32]);
  });

  it("lays out 16 teeth per jaw, patient's right on the viewer's left", () => {
    const fdi = chartLayout("FDI");
    expect(fdi.upper).toHaveLength(16);
    expect(fdi.lower).toHaveLength(16);
    expect(fdi.upper[0].label).toBe("18");
    expect(fdi.upper[15].label).toBe("28");
    expect(fdi.lower[0].label).toBe("48");
    expect(fdi.lower[15].label).toBe("38");
    expect(fdi.upper[0].kind).toBe("molar");
    expect(fdi.upper[7].kind).toBe("incisor");
    const uni = chartLayout("Universal");
    expect(uni.upper.map((c) => c.label).slice(0, 2)).toEqual(["1", "2"]);
    expect(uni.lower[0].label).toBe("32");
  });
});

describe("chart symbols", () => {
  it("recognises the kind of work from the procedure name", () => {
    expect(markOf(proc({ name: "Complex tooth extraction" }))).toBe("extraction");
    expect(markOf(proc({ name: "Osstem implant placement" }))).toBe("implant");
    expect(markOf(proc({ name: "Zirconia crown on Osstem implant" }))).toBe("crown");
    expect(markOf(proc({ name: "Root canal treatment — molars" }))).toBe("endo");
    expect(markOf(proc({ name: "Aesthetic restoration" }))).toBe("other");
  });

  it("collects work per tooth in stage order and sums it up", () => {
    const plan: Plan = {
      ...emptyPlan(),
      stages: [
        { id: "s1", title: "", goal: "", intervalBeforeStage: null, visits: null, procedures: [proc({ id: "a", name: "Extraction", teeth: ["46"] })] },
        {
          id: "s2",
          title: "",
          goal: "",
          intervalBeforeStage: { value: 3, unit: "months" },
          visits: null,
          procedures: [proc({ id: "b", name: "Implant placement", teeth: ["tooth 46", "36"] })],
        },
      ],
    };
    const work = teethWork(plan);
    expect(work.get("46")?.map((w) => w.stageIndex)).toEqual([0, 1]);
    expect(dominantMark(work.get("46")!)).toBe("implant");
    expect(work.get("36")?.[0].mark).toBe("implant");
  });
});

describe("timeline", () => {
  const plan: Plan = {
    ...emptyPlan(),
    stages: [
      { id: "a", title: "", goal: "", intervalBeforeStage: null, visits: null, procedures: [] },
      { id: "b", title: "", goal: "", intervalBeforeStage: { value: 2, unit: "weeks" }, visits: null, procedures: [] },
      { id: "c", title: "", goal: "", intervalBeforeStage: { value: 3, unit: "months" }, visits: null, procedures: [] },
    ],
  };

  it("computes stage start days and total duration", () => {
    expect(stageStartDays(plan)).toEqual([0, 14, 104]);
    expect(planDurationDays(plan)).toBe(104);
  });

  it("formats durations for patients", () => {
    expect(formatDuration(0)).toBe("a single phase");
    expect(formatDuration(7)).toBe("7 days");
    expect(formatDuration(21)).toBe("3 weeks");
    expect(formatDuration(104)).toBe("about 3 months");
    expect(formatDuration(400)).toBe("about 1 year 1 month");
  });

  it("keeps same-day stages apart and stays within 0–1", () => {
    const pos = timelinePositions([0, 0, 0, 90]);
    expect(pos[0]).toBe(0);
    expect(pos[1]).toBeGreaterThan(pos[0]);
    expect(pos[2]).toBeGreaterThan(pos[1]);
    expect(Math.max(...pos)).toBeLessThanOrEqual(1);
  });
});

describe("migration of older saved data", () => {
  it("fills item discounts, versions and status", () => {
    const old = {
      id: "x",
      createdAt: "",
      updatedAt: "",
      status: "draft",
      plan: { ...emptyPlan(), stages: [{ id: "s", title: "", goal: "", intervalBeforeStage: null, visits: null, procedures: [{ ...proc({}), discountPercent: undefined }] }] },
      questions: [],
      conversation: [],
    } as unknown as SavedPlan;
    const m = migrateSavedPlan(old);
    expect(m.plan.stages[0].procedures[0].discountPercent).toBe(0);
    expect(m.versions).toEqual([]);
    expect(m.lastChanges).toBeNull();
    expect(migratePlan(m.plan)).toEqual(m.plan);
  });
});
