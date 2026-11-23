import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  MAX_VERSIONS,
  PlanSchema,
  PlanStatusSchema,
  PriceItemSchema,
  QuestionSchema,
  SettingsSchema,
  type PlanSummary,
  type SavedPlan,
} from "../shared/schema";
import { AgentError, describeAgentReply, hasApiKey, MODELS, runAgentTurn } from "./agent";
import { computeTotals, diffPlans, reconcilePrices } from "../shared/pricing";
import { planDurationDays } from "../shared/format";
import { loadDemo } from "./demo";
import { store } from "./store";

const app = express();

/**
 * Optional password for the whole app (HTTP basic auth, any user name). Set DENTPLAN_PASSWORD
 * whenever the app is reachable from outside this computer (e.g. through a tunnel).
 */
const PASSWORD = process.env.DENTPLAN_PASSWORD ?? "";
if (PASSWORD) {
  const expected = createHash("sha256").update(PASSWORD).digest();
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? "").split(" ");
    const given = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
    if (timingSafeEqual(createHash("sha256").update(given).digest(), expected)) return next();
    res.set("WWW-Authenticate", 'Basic realm="DentPlan", charset="UTF-8"').status(401).send("Password required");
  });
}

app.use(express.json({ limit: "5mb" })); // logo data URLs can be large

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const param = (req: Request, name: string) => String(req.params[name]);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apiKeyConfigured: hasApiKey(), models: MODELS });
});

// ---------- Prices & settings ----------

app.get("/api/prices", route(async (_req, res) => res.json(await store.getPrices())));
app.put(
  "/api/prices",
  route(async (req, res) => {
    const items = z.array(PriceItemSchema).parse(req.body);
    const ids = new Set(items.map((i) => i.id));
    if (ids.size !== items.length) return res.status(400).json({ error: "Price list ids must be unique." });
    await store.setPrices(items);
    res.json(items);
  }),
);

app.get("/api/settings", route(async (_req, res) => res.json(await store.getSettings())));
app.put(
  "/api/settings",
  route(async (req, res) => {
    const s = SettingsSchema.parse(req.body);
    await store.setSettings(s);
    res.json(s);
  }),
);

// ---------- Plans ----------

app.get(
  "/api/plans",
  route(async (_req, res) => {
    const plans = await store.listPlans();
    const summaries: PlanSummary[] = plans.map((p) => {
      const t = computeTotals(p.plan);
      return {
        id: p.id,
        patientName: p.plan.patient.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        status: p.status,
        total: t.total,
        missingCount: t.missingCount,
        stageCount: p.plan.stages.length,
        procedureCount: p.plan.stages.reduce((n, s) => n + s.procedures.length, 0),
        openQuestions: p.questions.length,
        durationDays: planDurationDays(p.plan),
      };
    });
    res.json(summaries);
  }),
);

app.post("/api/plans", route(async (_req, res) => res.status(201).json(await store.createPlan())));

app.get(
  "/api/plans/:id",
  route(async (req, res) => {
    const saved = await store.getPlan(param(req, "id"));
    if (!saved) return res.status(404).json({ error: "Plan not found" });
    res.json({ ...saved, totals: computeTotals(saved.plan) });
  }),
);

const PlanUpdateSchema = z.object({
  plan: PlanSchema.optional(),
  questions: z.array(QuestionSchema).optional(),
  status: PlanStatusSchema.optional(),
  /** null: the dentist dismissed the "changed by the assistant" highlights. */
  lastChanges: z.null().optional(),
});

const withTotals = (p: SavedPlan) => ({ ...p, totals: computeTotals(p.plan) });

app.put(
  "/api/plans/:id",
  route(async (req, res) => {
    const saved = await store.getPlan(param(req, "id"));
    if (!saved) return res.status(404).json({ error: "Plan not found" });
    const body = PlanUpdateSchema.parse(req.body);
    const next = await store.savePlan({
      ...saved,
      plan: body.plan ? reconcilePrices(body.plan, await store.getPrices()) : saved.plan,
      questions: body.questions ?? saved.questions,
      status: body.status ?? saved.status,
      lastChanges: body.lastChanges === null ? null : saved.lastChanges,
    });
    res.json(withTotals(next));
  }),
);

/** Copy of a plan (e.g. a similar case, or an alternative option for the same patient). */
app.post(
  "/api/plans/:id/duplicate",
  route(async (req, res) => {
    const saved = await store.getPlan(param(req, "id"));
    if (!saved) return res.status(404).json({ error: "Plan not found" });
    const copy = await store.createPlan({
      plan: { ...saved.plan, patient: { ...saved.plan.patient, name: `${saved.plan.patient.name || "Unnamed"} (copy)` } },
      questions: saved.questions,
    });
    res.status(201).json(withTotals(copy));
  }),
);

/** Restores the version saved before the last assistant turn. */
app.post(
  "/api/plans/:id/undo",
  route(async (req, res) => {
    const saved = await store.getPlan(param(req, "id"));
    if (!saved) return res.status(404).json({ error: "Plan not found" });
    const prev = saved.versions.at(-1);
    if (!prev) return res.status(409).json({ error: "There is nothing to undo." });
    const next = await store.savePlan({
      ...saved,
      plan: prev.plan,
      questions: prev.questions,
      conversation: saved.conversation.slice(0, prev.conversationLength),
      versions: saved.versions.slice(0, -1),
      lastChanges: null,
      status: "draft",
    });
    res.json({ ...withTotals(next), undoneUtterance: prev.utterance });
  }),
);

app.delete(
  "/api/plans/:id",
  route(async (req, res) => {
    await store.deletePlan(param(req, "id"));
    res.status(204).end();
  }),
);

// ---------- Agent ----------

const TurnSchema = z.object({
  utterance: z.string().trim().min(1, "Say or type something first."),
  plan: PlanSchema,
});

app.post(
  "/api/plans/:id/turn",
  route(async (req, res) => {
    const saved = await store.getPlan(param(req, "id"));
    if (!saved) return res.status(404).json({ error: "Plan not found" });
    const { utterance, plan } = TurnSchema.parse(req.body);
    const [priceList, settings] = await Promise.all([store.getPrices(), store.getSettings()]);

    const before = reconcilePrices(plan, priceList);
    const result = await runAgentTurn({
      utterance,
      plan: before,
      openQuestions: saved.questions,
      history: saved.conversation,
      priceList,
      settings,
    });

    const now = new Date().toISOString();
    const next = await store.savePlan({
      ...saved,
      status: "draft",
      plan: result.plan,
      questions: result.questions,
      versions: [
        ...saved.versions,
        { at: now, utterance, plan: before, questions: saved.questions, conversationLength: saved.conversation.length },
      ].slice(-MAX_VERSIONS),
      lastChanges: diffPlans(before, result.plan),
      conversation: [
        ...saved.conversation,
        { role: "dentist", text: utterance, at: now },
        { role: "agent", text: describeAgentReply(result.message, result.questions), at: now },
      ],
    });
    res.json({
      ...next,
      totals: computeTotals(next.plan),
      message: result.message,
      answeredBy: result.model,
      usedBackupModel: result.model !== MODELS[0],
    });
  }),
);

// ---------- Demo data ----------

app.post(
  "/api/demo",
  route(async (_req, res) => {
    res.json(await loadDemo());
  }),
);

// ---------- Static client (production) ----------

const dist = path.resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

// ---------- Errors ----------

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AgentError) {
    return res.status(err.status).json({ error: err.message, retryable: err.retryable });
  }
  if (err instanceof z.ZodError) {
    return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
  }
  console.error(err);
  res.status(500).json({ error: "Unexpected server error. See the server console for details." });
});

const port = Number(process.env.PORT) || 3001;
/** Only this computer by default. The Docker image sets HOST=0.0.0.0 (the container is isolated; publish its port on 127.0.0.1). */
const host = process.env.HOST || "127.0.0.1";
app.listen(port, host, () => {
  console.log(`DentPlan API on http://localhost:${port}  (AI key ${hasApiKey() ? "configured" : "MISSING – see README"})`);
  console.log(PASSWORD ? "Password protection: on" : "Password protection: off (set DENTPLAN_PASSWORD before exposing the app)");
});
