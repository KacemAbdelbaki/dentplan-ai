import type { Plan, PlanStatus, PlanSummary, PriceItem, Question, SavedPlan, Settings, Totals } from "../shared/schema";

export type PlanWithTotals = SavedPlan & {
  totals: Totals;
  message?: string;
  /** Set on assistant turns: which AI model answered, and whether it was a backup model. */
  answeredBy?: string;
  usedBackupModel?: boolean;
  /** Set by undo: the dictation whose result was undone (put back in the draft box). */
  undoneUtterance?: string;
};

export interface Health {
  ok: boolean;
  apiKeyConfigured: boolean;
  models: string[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Cannot reach the DentPlan server. Is it running?", true);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, !!data.retryable);
  return data as T;
}

export const api = {
  health: () => request<Health>("GET", "/api/health"),
  listPlans: () => request<PlanSummary[]>("GET", "/api/plans"),
  createPlan: () => request<SavedPlan>("POST", "/api/plans"),
  getPlan: (id: string) => request<PlanWithTotals>("GET", `/api/plans/${id}`),
  savePlan: (id: string, body: { plan?: Plan; questions?: Question[]; status?: PlanStatus; lastChanges?: null }) =>
    request<PlanWithTotals>("PUT", `/api/plans/${id}`, body),
  setStatus: (id: string, status: PlanStatus) => request<PlanWithTotals>("PUT", `/api/plans/${id}`, { status }),
  duplicatePlan: (id: string) => request<PlanWithTotals>("POST", `/api/plans/${id}/duplicate`),
  undo: (id: string) => request<PlanWithTotals>("POST", `/api/plans/${id}/undo`),
  loadDemo: () => request<{ plansCreated: number; pricesLoaded: boolean; settingsLoaded: boolean }>("POST", "/api/demo"),
  deletePlan: (id: string) => request<void>("DELETE", `/api/plans/${id}`),
  turn: (id: string, utterance: string, plan: Plan) =>
    request<PlanWithTotals>("POST", `/api/plans/${id}/turn`, { utterance, plan }),
  getPrices: () => request<PriceItem[]>("GET", "/api/prices"),
  setPrices: (items: PriceItem[]) => request<PriceItem[]>("PUT", "/api/prices", items),
  getSettings: () => request<Settings>("GET", "/api/settings"),
  setSettings: (s: Settings) => request<Settings>("PUT", "/api/settings", s),
};
