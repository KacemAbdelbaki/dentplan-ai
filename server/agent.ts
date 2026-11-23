import { ApiError, FinishReason, GoogleGenAI, type Content } from "@google/genai";
import Groq from "groq-sdk";
import { z } from "zod";
import {
  AgentTurnSchema,
  type AgentTurn,
  type ConversationEntry,
  type Plan,
  type PriceItem,
  type Question,
  type Settings,
} from "../shared/schema";
import { buildSystemPrompt, shortPriceIds } from "./prompt";
import { reconcilePrices } from "../shared/pricing";
import { hedgedRace, HedgeTimeoutError } from "./hedge";

/** Primary model. Override with GEMINI_MODEL in .env. */
export const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

/**
 * Backup models, used when the primary is overloaded (503), slow, out of quota (429) or
 * retired (404). Override with a comma-separated GEMINI_FALLBACK_MODELS.
 */
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-4-hydrogen,gemini-3.5-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * Optional last-resort backup on another provider (Groq), used only when GROQ_API_KEY is set.
 * Groq's free tier allows small requests only, so the price list is sent in a compact form.
 */
const GROQ_PREFIX = "groq:";
const GROQ_MODELS = (process.env.GROQ_MODELS ?? "openai/gpt-oss-120b")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
const groqKey = () => process.env.GROQ_API_KEY || "";

const geminiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

/** Every model a turn may use, in order of preference. Groq models are prefixed with "groq:". */
export const MODELS = [
  ...(geminiKey() ? [MODEL, ...FALLBACKS.filter((m) => m !== MODEL)] : []),
  ...(groqKey() ? GROQ_MODELS.map((m) => GROQ_PREFIX + m) : []),
];

/** If a model has not answered after this long, the next one is started alongside it. */
const HEDGE_DELAY_MS = Number(process.env.GEMINI_HEDGE_DELAY_MS) || 20_000;
/** Time limit for the whole turn (all models together), so the dentist never waits for minutes. */
const TURN_BUDGET_MS = Number(process.env.GEMINI_TURN_BUDGET_MS) || 120_000;

/** The model answered, but not with a usable plan. Another model may do better. */
class UnreadableReplyError extends Error {}

/** Error with a user-facing message and an HTTP status for the route handler. */
export class AgentError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
  ) {
    super(message);
  }
}

export const hasApiKey = () => !!geminiKey() || !!groqKey();

let client: GoogleGenAI | null = null;
const getClient = () =>
  (client ??= new GoogleGenAI({
    apiKey: geminiKey(),
    // The SDK default (5 attempts, up to 60 s apart) can stall a turn for minutes when a
    // model is overloaded. No retry on the same model: moving to the next model is the retry.
    httpOptions: { retryOptions: { attempts: 1 } },
  }));

let groqClient: Groq | null = null;
const getGroq = () => (groqClient ??= new Groq({ apiKey: groqKey(), maxRetries: 0 }));

const httpStatus = (err: unknown): number | undefined => {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : undefined;
};

/**
 * Errors where another model may succeed: overload, quota, retired model, request too large
 * for that provider, timeout, network.
 */
export function isModelUnavailable(err: unknown): boolean {
  const s = httpStatus(err);
  if (s !== undefined && (err instanceof ApiError || err instanceof Groq.APIError)) {
    return s === 404 || s === 408 || s === 413 || s === 429 || s >= 500;
  }
  return err instanceof Error && /abort|time ?out|timed out|fetch failed|network|connection/i.test(`${err.name} ${err.message}`);
}

/** Rewrites every priceListId through `map` (ids not in the map are kept). */
function mapPriceIds(plan: Plan, map: Map<string, string>): Plan {
  return {
    ...plan,
    stages: plan.stages.map((s) => ({
      ...s,
      procedures: s.procedures.map((p) => ({
        ...p,
        priceListId: p.priceListId ? (map.get(p.priceListId) ?? p.priceListId) : null,
      })),
    })),
  };
}

/** One attempt on a Groq model. The price list goes in with short ids ("L12") to keep the request small. */
async function askGroq(model: string, input: AgentInput, signal: AbortSignal, timeout: number): Promise<AgentTurn> {
  const { toShort, toReal } = shortPriceIds(input.priceList);
  const contents = buildContents(input.history, mapPriceIds(input.plan, toShort), input.openQuestions, input.utterance);
  try {
    const r = await getGroq().chat.completions.create(
      {
        model,
        messages: [
          { role: "system", content: buildSystemPrompt(input.priceList, input.settings, toShort) },
          ...contents.map((c) => ({
            role: c.role === "model" ? ("assistant" as const) : ("user" as const),
            content: c.parts?.map((p) => p.text ?? "").join("") ?? "",
          })),
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "agent_turn", strict: true, schema: agentTurnJsonSchema() },
        },
        max_completion_tokens: 16000,
      },
      { signal, timeout },
    );
    const choice = r.choices[0];
    if (choice?.finish_reason === "length") {
      throw new AgentError("The plan was too long for one reply. Try splitting the dictation into parts.", 422, true);
    }
    const parsed = parseAgentJson(choice?.message?.content ?? undefined);
    if (!parsed) throw new UnreadableReplyError(`${model} returned a reply that does not match the plan format`);
    return { ...parsed, plan: mapPriceIds(parsed.plan, toReal) };
  } catch (err) {
    // Groq rejects a reply that breaks the schema with a 400; another model may do better.
    if (err instanceof Groq.APIError && err.status === 400 && /json|schema|validat/i.test(err.message)) {
      throw new UnreadableReplyError(`${model}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * JSON Schema for Gemini's structured output, generated from the same zod schema
 * the app validates with. `$schema` is dropped (not a supported keyword).
 */
export function agentTurnJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(AgentTurnSchema) as Record<string, unknown>;
  return schema;
}

export function describeAgentReply(text: string, questions: Question[]): string {
  if (!questions.length) return text;
  return `${text}\nQuestions I asked:\n${questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`;
}

/**
 * Builds the conversation: previous dentist/assistant exchanges as plain text, then a
 * final user message carrying the CURRENT plan JSON (which may include the dentist's
 * manual edits) plus the new utterance. The plan state therefore always comes from
 * the app, not from the model's memory.
 */
export function buildContents(
  history: ConversationEntry[],
  currentPlan: Plan,
  openQuestions: Question[],
  utterance: string,
): Content[] {
  const turns: { role: "user" | "model"; text: string }[] = [];
  for (const entry of history) {
    const role = entry.role === "dentist" ? "user" : "model";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n\n${entry.text}`;
    else turns.push({ role, text: entry.text });
  }
  // The conversation must start with the user.
  if (turns[0]?.role === "model") turns.shift();

  const open = openQuestions.length
    ? `\n\nQuestions still open from your last turn:\n${openQuestions.map((q) => `- [${q.id}] ${q.question}`).join("\n")}`
    : "";
  const finalUser =
    `Current plan (authoritative – includes any manual edits by the dentist):\n` +
    "```json\n" +
    JSON.stringify(currentPlan, null, 1) +
    "\n```" +
    open +
    `\n\nDentist says:\n"""${utterance}"""`;

  const last = turns[turns.length - 1];
  if (last && last.role === "user") last.text += `\n\n${finalUser}`;
  else turns.push({ role: "user", text: finalUser });

  return turns.map((t) => ({ role: t.role, parts: [{ text: t.text }] }));
}

export interface AgentInput {
  utterance: string;
  plan: Plan;
  openQuestions: Question[];
  history: ConversationEntry[];
  priceList: PriceItem[];
  settings: Settings;
}

const BLOCKED: string[] = [
  FinishReason.SAFETY,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.RECITATION,
];

/** Returns the updated plan and questions, plus the name of the model that answered. */
export async function runAgentTurn(input: AgentInput): Promise<AgentTurn & { model: string }> {
  if (!hasApiKey() || MODELS.length === 0) {
    throw new AgentError("No AI API key configured. Add GEMINI_API_KEY to the .env file and restart.", 503, false);
  }

  const request = {
    contents: buildContents(input.history, input.plan, input.openQuestions, input.utterance),
    config: {
      systemInstruction: buildSystemPrompt(input.priceList, input.settings),
      responseMimeType: "application/json",
      responseJsonSchema: agentTurnJsonSchema(),
      maxOutputTokens: 16000,
    },
  };

  const turnStarted = Date.now();

  /** One model, one attempt. Throws AgentError for problems another model would not fix. */
  const askModel = async (model: string, signal: AbortSignal): Promise<AgentTurn> => {
    const remaining = Math.max(1000, TURN_BUDGET_MS - (Date.now() - turnStarted));
    if (model.startsWith(GROQ_PREFIX)) return askGroq(model.slice(GROQ_PREFIX.length), input, signal, remaining);
    const response = await getClient().models.generateContent({
      model,
      ...request,
      config: {
        ...request.config,
        abortSignal: signal,
        httpOptions: { timeout: remaining, retryOptions: { attempts: 1 } },
      },
    });

    if (response.promptFeedback?.blockReason) {
      throw new AgentError("The AI declined this request. Try rephrasing the dictation.", 422, false);
    }
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && BLOCKED.includes(finish)) {
      throw new AgentError("The AI declined this request. Try rephrasing the dictation.", 422, false);
    }
    if (finish === FinishReason.MAX_TOKENS) {
      throw new AgentError("The plan was too long for one reply. Try splitting the dictation into parts.", 422, true);
    }
    const parsed = parseAgentJson(response.text);
    if (!parsed) throw new UnreadableReplyError(`${model} returned a reply that does not match the plan format`);
    return parsed;
  };

  try {
    const { value, candidate } = await hedgedRace({
      candidates: MODELS,
      run: askModel,
      isSoftFailure: (err) => err instanceof UnreadableReplyError || isModelUnavailable(err),
      hedgeDelayMs: HEDGE_DELAY_MS,
      budgetMs: TURN_BUDGET_MS,
      // Keep the provider's raw error in the server log; the user gets a friendly message.
      onFailure: (model, err, ms) =>
        console.error(`[agent] ${model} failed after ${(ms / 1000).toFixed(1)} s:`, err instanceof Error ? err.message : err),
    });
    console.log(`[agent] answered by ${candidate} after ${((Date.now() - turnStarted) / 1000).toFixed(1)} s`);
    return { ...value, plan: reconcilePrices(value.plan, input.priceList), model: candidate };
  } catch (err) {
    if (err instanceof AgentError) throw err;
    if (err instanceof UnreadableReplyError) {
      throw new AgentError("The AI reply could not be read. Please try again.", 502, true);
    }
    if (err instanceof HedgeTimeoutError) {
      console.error(`[agent] no model answered within ${TURN_BUDGET_MS / 1000} s (${MODELS.join(", ")})`);
      throw new AgentError("The AI did not answer in time (all models tried). Please try again.", 503, true);
    }
    throw toAgentError(err, true);
  }
}

/** Maps an SDK / network error to a user-facing AgentError. */
function toAgentError(err: unknown, allModelsTried = false): AgentError {
  const s = httpStatus(err);
  if (s !== undefined && (err instanceof ApiError || err instanceof Groq.APIError)) {
    const groq = err instanceof Groq.APIError;
    const keyName = groq ? "GROQ_API_KEY" : "GEMINI_API_KEY";
    if ((s === 400 && /api key/i.test(err.message)) || s === 401 || s === 403) {
      return new AgentError(`The AI API key was rejected or lacks access. Check ${keyName} in .env.`, 502, false);
    }
    if (s === 404) {
      return new AgentError(`AI models not found (${MODELS.join(", ")}). Check the model names in .env.`, 502, false);
    }
    if (s === 429 || s === 413) {
      return new AgentError("The AI quota is used up for now (all models tried). Try again in a minute.", 503, true);
    }
    if (s >= 500) {
      return new AgentError(
        allModelsTried
          ? "The AI service is overloaded right now (all models tried). Please try again in a minute."
          : "The AI service had a temporary problem. Please try again.",
        503,
        true,
      );
    }
    return new AgentError(`The AI service returned an error (${s}): ${err.message}`, 502, false);
  }
  if (isModelUnavailable(err)) {
    return new AgentError("The AI service did not answer in time or could not be reached. Please try again.", 503, true);
  }
  return new AgentError("Unexpected error while contacting the AI service. See the server log.", 500, false);
}

/** Parses and validates the model's JSON; tolerates a ```json fence just in case. */
export function parseAgentJson(text: string | undefined): AgentTurn | null {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const result = AgentTurnSchema.safeParse(JSON.parse(cleaned));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
