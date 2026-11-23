import { z } from "zod";

// ---------- Plan (also the Gemini structured-output format) ----------

export const IntervalSchema = z.object({
  value: z.number().describe("Amount of time, e.g. 2"),
  unit: z.enum(["days", "weeks", "months"]),
});

export const PriceSourceSchema = z
  .enum(["list", "dictated", "missing", "manual"])
  .describe(
    "list = price taken from the clinic price list (set priceListId); dictated = the dentist said the price; " +
      "missing = unknown, ask a question; manual = typed by the dentist in the table (never change it)",
  );

export const ProcedureSchema = z.object({
  id: z.string().describe("Stable id; keep existing ids, invent short new ones like 'p7'"),
  name: z.string(),
  teeth: z.array(z.string()).describe("Tooth numbers in the clinic's numbering system; empty if not tooth-specific"),
  quantity: z.number().describe("Number of units (usually one per tooth)"),
  priceSource: PriceSourceSchema,
  priceListId: z.string().nullable(),
  unitPrice: z.number().nullable(),
  discountPercent: z
    .number()
    .describe("Discount on this item only, 0–100 (e.g. 30 for '30% off the abutments'); 0 = no item discount"),
  notes: z.string(),
});

export const StageSchema = z.object({
  id: z.string(),
  title: z.string(),
  goal: z.string(),
  intervalBeforeStage: IntervalSchema.nullable().describe(
    "Waiting time after the previous stage before this one starts; null for the first stage or 'immediately'",
  ),
  visits: z.number().nullable(),
  procedures: z.array(ProcedureSchema),
});

export const PlanSchema = z.object({
  patient: z.object({ name: z.string(), notes: z.string() }),
  stages: z.array(StageSchema),
  discountPercent: z.number(),
  generalNotes: z.string(),
  assumptions: z.array(z.string()).describe("Things you assumed that the dentist should be aware of"),
});

export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  reason: z.string().describe("Why it matters (one short phrase)"),
  suggestedAnswers: z.array(z.string()),
});

export const AgentTurnSchema = z.object({
  plan: PlanSchema,
  questions: z.array(QuestionSchema),
  message: z.string().describe("One or two sentences telling the dentist what changed"),
});

export type Interval = z.infer<typeof IntervalSchema>;
export type PriceSource = z.infer<typeof PriceSourceSchema>;
export type Procedure = z.infer<typeof ProcedureSchema>;
export type Stage = z.infer<typeof StageSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

// ---------- App data ----------

export const PriceItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  aliases: z.array(z.string()),
  category: z.string(),
  price: z.number().nullable().describe("null = price not set yet"),
});
export type PriceItem = z.infer<typeof PriceItemSchema>;

export const SettingsSchema = z.object({
  clinicName: z.string(),
  clinicAddress: z.string(),
  clinicPhone: z.string(),
  dentistName: z.string(),
  logoDataUrl: z.string(),
  currency: z.string(),
  toothNumbering: z.enum(["FDI", "Universal"]),
  validityDays: z.number(),
  disclaimer: z.string(),
  /** BCP-47 language the dentist dictates in, e.g. "en-US", "uk-UA", "fr-FR". */
  dictationLanguage: z.string(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export interface ConversationEntry {
  role: "dentist" | "agent";
  text: string;
  at: string;
}

/**
 * Where a case stands. draft = being built; final = ready to present (PDF made);
 * presented = shown to the patient; accepted / declined = the patient's decision.
 */
export const PLAN_STATUSES = ["draft", "final", "presented", "accepted", "declined"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PlanStatusSchema = z.enum(PLAN_STATUSES);

export const STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  final: "Ready",
  presented: "Presented",
  accepted: "Accepted",
  declined: "Declined",
};

/** A snapshot taken before each assistant turn, so the turn can be undone. */
export interface PlanVersion {
  at: string;
  /** What the dentist said in the turn that replaced this version. */
  utterance: string;
  plan: Plan;
  questions: Question[];
  conversationLength: number;
}

/** What the last assistant turn changed, for highlighting in the editor. */
export interface PlanChanges {
  addedProcedureIds: string[];
  changedProcedureIds: string[];
  addedStageIds: string[];
  changedStageIds: string[];
  removed: string[];
}

export interface SavedPlan {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: PlanStatus;
  plan: Plan;
  questions: Question[];
  conversation: ConversationEntry[];
  /** Older versions, newest last (at most MAX_VERSIONS). */
  versions: PlanVersion[];
  lastChanges: PlanChanges | null;
}

export const MAX_VERSIONS = 20;

export interface StageTotal {
  stageId: string;
  subtotal: number;
  missingCount: number;
}

export interface Totals {
  stages: StageTotal[];
  /** Sum of all priced lines at full price. */
  gross: number;
  /** Savings from per-item discounts. */
  itemDiscount: number;
  /** Sum of the stage subtotals (after item discounts). */
  subtotal: number;
  /** Discount on the whole estimate (plan.discountPercent). */
  discount: number;
  total: number;
  missingCount: number;
}

export interface PlanSummary {
  id: string;
  patientName: string;
  createdAt: string;
  updatedAt: string;
  status: PlanStatus;
  total: number;
  missingCount: number;
  stageCount: number;
  procedureCount: number;
  openQuestions: number;
  /** Total treatment duration in days (sum of the waits between stages). */
  durationDays: number;
}

// ---------- Defaults ----------

export function emptyPlan(): Plan {
  return {
    patient: { name: "", notes: "" },
    stages: [],
    discountPercent: 0,
    generalNotes: "",
    assumptions: [],
  };
}

export const defaultSettings: Settings = {
  clinicName: "My Dental Clinic",
  clinicAddress: "",
  clinicPhone: "",
  dentistName: "",
  logoDataUrl: "",
  currency: "",
  toothNumbering: "FDI",
  validityDays: 90,
  dictationLanguage: "en-US",
  disclaimer:
    "This is an estimate based on today's examination. The final treatment and fees may change if new findings appear during treatment.",
};

export const defaultPriceList: PriceItem[] = [
  { id: "exam", name: "Examination & consultation", aliases: ["checkup", "consultation"], category: "Diagnostic", price: null },
  { id: "xray-pa", name: "Periapical X-ray", aliases: ["x-ray", "radiograph"], category: "Diagnostic", price: null },
  { id: "opg", name: "Panoramic X-ray (OPG)", aliases: ["panoramic"], category: "Diagnostic", price: null },
  { id: "scaling", name: "Scaling & polishing", aliases: ["cleaning", "hygiene", "prophylaxis"], category: "Hygiene", price: null },
  { id: "filling-composite", name: "Composite filling", aliases: ["filling", "white filling", "restoration"], category: "Restorative", price: null },
  { id: "rct-anterior", name: "Root canal treatment – anterior", aliases: ["endo front tooth"], category: "Endodontics", price: null },
  { id: "rct-premolar", name: "Root canal treatment – premolar", aliases: [], category: "Endodontics", price: null },
  { id: "rct-molar", name: "Root canal treatment – molar", aliases: ["endo molar"], category: "Endodontics", price: null },
  { id: "post-core", name: "Post & core build-up", aliases: ["core build up"], category: "Restorative", price: null },
  { id: "crown-zirconia", name: "Zirconia crown", aliases: ["zircon crown"], category: "Prosthetics", price: null },
  { id: "crown-pfm", name: "Porcelain-fused-to-metal crown", aliases: ["PFM", "metal ceramic crown"], category: "Prosthetics", price: null },
  { id: "extraction-simple", name: "Simple extraction", aliases: ["extraction", "pull tooth"], category: "Surgery", price: null },
  { id: "extraction-surgical", name: "Surgical extraction", aliases: ["wisdom tooth removal"], category: "Surgery", price: null },
  { id: "implant", name: "Dental implant (fixture)", aliases: ["implant"], category: "Implants", price: null },
  { id: "implant-crown", name: "Implant crown with abutment", aliases: ["crown on implant"], category: "Implants", price: null },
  { id: "whitening", name: "In-office whitening", aliases: ["bleaching"], category: "Cosmetic", price: null },
];

// ---------- Migration of data saved by older versions ----------

/** Fills fields added after a plan was saved (e.g. item discounts). Safe on current data. */
export function migratePlan(raw: Plan): Plan {
  return {
    ...emptyPlan(),
    ...raw,
    patient: { ...emptyPlan().patient, ...raw.patient },
    stages: (raw.stages ?? []).map((s) => ({
      ...s,
      procedures: (s.procedures ?? []).map((p) => ({ ...p, discountPercent: p.discountPercent ?? 0 })),
    })),
  };
}

export function migrateSavedPlan(raw: SavedPlan): SavedPlan {
  return {
    ...raw,
    status: PLAN_STATUSES.includes(raw.status) ? raw.status : "draft",
    plan: migratePlan(raw.plan),
    questions: raw.questions ?? [],
    conversation: raw.conversation ?? [],
    versions: (raw.versions ?? []).map((v) => ({ ...v, plan: migratePlan(v.plan) })),
    lastChanges: raw.lastChanges ?? null,
  };
}
