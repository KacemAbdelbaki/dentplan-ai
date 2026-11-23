import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { agentTurnJsonSchema, buildContents, isModelUnavailable, parseAgentJson } from "./agent";
import { buildSystemPrompt, shortPriceIds } from "./prompt";
import { defaultSettings, emptyPlan, type ConversationEntry } from "../shared/schema";

const at = "2026-01-01T00:00:00Z";
const text = (c: { parts?: { text?: string }[] }) => c.parts?.[0]?.text ?? "";

describe("buildContents", () => {
  it("starts a fresh conversation with one user message containing plan + utterance", () => {
    const c = buildContents([], emptyPlan(), [], "Scaling first");
    expect(c).toHaveLength(1);
    expect(c[0].role).toBe("user");
    expect(text(c[0])).toContain('"stages": []');
    expect(text(c[0])).toContain("Scaling first");
  });

  it("alternates user/model and ends with the current plan + new utterance", () => {
    const history: ConversationEntry[] = [
      { role: "dentist", text: "first", at },
      { role: "agent", text: "did it", at },
    ];
    const c = buildContents(history, emptyPlan(), [{ id: "q1", question: "Which tooth?", reason: "", suggestedAnswers: [] }], "36");
    expect(c.map((m) => m.role)).toEqual(["user", "model", "user"]);
    expect(text(c[2])).toContain("[q1] Which tooth?");
    expect(text(c[2])).toContain('"""36"""');
  });

  it("merges consecutive same-role entries and drops a leading model turn", () => {
    const history: ConversationEntry[] = [
      { role: "agent", text: "orphan", at },
      { role: "dentist", text: "a", at },
      { role: "dentist", text: "b", at },
    ];
    const c = buildContents(history, emptyPlan(), [], "c");
    expect(c).toHaveLength(1);
    expect(text(c[0])).toMatch(/a\n\nb\n\nCurrent plan/);
  });
});

describe("agentTurnJsonSchema", () => {
  // Keywords Gemini's responseJsonSchema accepts (per @google/genai docs).
  const allowed = new Set([
    "$id", "$defs", "$ref", "$anchor", "type", "format", "title", "description", "enum", "items",
    "prefixItems", "minItems", "maxItems", "minimum", "maximum", "anyOf", "oneOf", "properties",
    "additionalProperties", "required", "propertyOrdering",
  ]);

  function collectKeys(node: unknown, out: Set<string>, parentKey = ""): void {
    if (Array.isArray(node)) return node.forEach((n) => collectKeys(n, out));
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) {
      // Keys under "properties" / "$defs" are field names, not keywords.
      if (parentKey !== "properties" && parentKey !== "$defs") out.add(k);
      collectKeys(v, out, k);
    }
  }

  it("uses only supported keywords and requires plan, questions, message", () => {
    const schema = agentTurnJsonSchema();
    const keys = new Set<string>();
    collectKeys(schema, keys);
    expect([...keys].filter((k) => !allowed.has(k))).toEqual([]);
    expect(schema.required).toEqual(["plan", "questions", "message"]);
  });
});

describe("parseAgentJson", () => {
  const valid = { plan: emptyPlan(), questions: [], message: "ok" };

  it("parses valid JSON, also inside a code fence", () => {
    expect(parseAgentJson(JSON.stringify(valid))?.message).toBe("ok");
    expect(parseAgentJson("```json\n" + JSON.stringify(valid) + "\n```")?.message).toBe("ok");
  });

  it("returns null for invalid JSON or wrong shape", () => {
    expect(parseAgentJson("not json")).toBeNull();
    expect(parseAgentJson(JSON.stringify({ message: "x" }))).toBeNull();
    expect(parseAgentJson(undefined)).toBeNull();
  });
});

describe("buildSystemPrompt", () => {
  it("lists price items with ids and marks unset prices", () => {
    const p = buildSystemPrompt(
      [
        { id: "scaling", name: "Scaling", aliases: ["cleaning"], category: "Hygiene", price: 80 },
        { id: "implant", name: "Implant", aliases: [], category: "Implants", price: null },
      ],
      { ...defaultSettings, currency: "€" },
    );
    expect(p).toContain('id="scaling" | Scaling (also: cleaning) | Hygiene | price: 80');
    expect(p).toContain('id="implant" | Implant | Implants | price: NOT SET');
    expect(p).toContain("The currency is €");
    expect(p).toContain("FDI");
  });
});

describe("isModelUnavailable", () => {
  const apiErr = (status: number) => new ApiError({ message: "x", status });

  it("falls back on overload, quota, retired model and timeouts", () => {
    for (const s of [503, 500, 429, 404, 408]) expect(isModelUnavailable(apiErr(s))).toBe(true);
    const abort = new Error("This operation was aborted");
    abort.name = "AbortError";
    expect(isModelUnavailable(abort)).toBe(true);
    expect(isModelUnavailable(new TypeError("fetch failed"))).toBe(true);
  });

  it("does not fall back on request or key errors", () => {
    for (const s of [400, 401, 403]) expect(isModelUnavailable(apiErr(s))).toBe(false);
    expect(isModelUnavailable(new Error("something else"))).toBe(false);
  });
});

describe("dictation language", () => {
  it("asks for questions in the dentist's language but keeps the patient plan in English", () => {
    const p = buildSystemPrompt([], { ...defaultSettings, dictationLanguage: "uk-UA" });
    expect(p).toContain("dictates in Ukrainian");
    expect(p).toMatch(/plan itself .* in English/);
    expect(buildSystemPrompt([], defaultSettings)).toContain("Write everything in English");
  });
});

describe("compact price list (small-request providers)", () => {
  it("uses short ids grouped by category", () => {
    const list = [
      { id: "implant-osstem-long-id", name: "Osstem implant", aliases: [], category: "Implantology", price: 460 },
      { id: "scaling-long-id", name: "Scaling", aliases: ["cleaning"], category: "Hygiene", price: null },
    ];
    const { toShort, toReal } = shortPriceIds(list);
    const p = buildSystemPrompt(list, defaultSettings, toShort);
    expect(p).toContain("L1 | Osstem implant | 460");
    expect(p).toContain("L2 | Scaling (also: cleaning) | NOT SET");
    expect(p).not.toContain("implant-osstem-long-id");
    expect(toReal.get("L1")).toBe("implant-osstem-long-id");
  });
});

describe("isModelUnavailable", () => {
  it("treats a provider's 'request too large' (413) as a reason to try another model", () => {
    expect(isModelUnavailable(new ApiError({ message: "too large", status: 413 }))).toBe(true);
    expect(isModelUnavailable(new ApiError({ message: "bad key", status: 401 }))).toBe(false);
  });
});
