import type { PriceItem, Settings } from "../shared/schema";

/**
 * Short stand-in ids ("L1", "L2", …) for price-list items, by position in the list.
 * Used with providers that only accept small requests: the real ids repeat the item
 * name and roughly double the size of the price list in the prompt.
 */
export function shortPriceIds(priceList: PriceItem[]): { toShort: Map<string, string>; toReal: Map<string, string> } {
  const toShort = new Map<string, string>();
  const toReal = new Map<string, string>();
  priceList.forEach((p, i) => {
    toShort.set(p.id, `L${i + 1}`);
    toReal.set(`L${i + 1}`, p.id);
  });
  return { toShort, toReal };
}

/** Price list as "id | name | price" lines under one heading per category. */
function compactPriceLines(priceList: PriceItem[], ids: Map<string, string>): string {
  const byCategory = new Map<string, string[]>();
  for (const p of priceList) {
    const aliases = p.aliases.length ? ` (also: ${p.aliases.join(", ")})` : "";
    const line = `${ids.get(p.id) ?? p.id} | ${p.name}${aliases} | ${p.price === null ? "NOT SET" : p.price}`;
    byCategory.set(p.category, [...(byCategory.get(p.category) ?? []), line]);
  }
  return [...byCategory]
    .map(([category, lines]) => `Category: ${category || "Other"}\n${lines.join("\n")}`)
    .join("\n");
}

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English", uk: "Ukrainian", pl: "Polish", fr: "French", ar: "Arabic", de: "German",
  es: "Spanish", it: "Italian", pt: "Portuguese", ru: "Russian", ro: "Romanian", tr: "Turkish", nl: "Dutch",
};

export function languageName(tag: string): string {
  return LANGUAGE_NAMES[(tag || "en").slice(0, 2).toLowerCase()] ?? tag;
}

function languageRule(tag: string): string {
  const lang = languageName(tag);
  if (lang === "English") return "The dentist dictates in English. Write everything in English.";
  return `The dentist dictates in ${lang} (sometimes mixed with English terms). Write "message", "questions" (question, reason, suggestedAnswers) and "assumptions" in ${lang}, so the dentist can read them easily. Write the plan itself (stage titles, goals, procedure names, notes, generalNotes) in English, because it is printed on the patient's English estimate; use price-list names exactly as written.`;
}

/**
 * System prompt for the treatment-planning agent. Kept free of per-request data
 * (dates, plan state) so it can be prompt-cached across turns; it only changes
 * when the price list or settings change.
 * With `compactIds` (real id → short id) the price list is written in a shorter form.
 */
export function buildSystemPrompt(priceList: PriceItem[], settings: Settings, compactIds?: Map<string, string>): string {
  const numbering =
    settings.toothNumbering === "FDI"
      ? "FDI two-digit notation (e.g. 11–18, 21–28, 31–38, 41–48; primary teeth 51–85)"
      : "Universal notation (1–32 for permanent teeth, A–T for primary teeth)";

  const prices = compactIds
    ? compactPriceLines(priceList, compactIds)
    : priceList
    .map((p) => {
      const price = p.price === null ? "NOT SET" : String(p.price);
      const aliases = p.aliases.length ? ` (also: ${p.aliases.join(", ")})` : "";
      return `- id="${p.id}" | ${p.name}${aliases} | ${p.category} | price: ${price}`;
    })
    .join("\n");

  return `You are a dental treatment-planning assistant working for a dentist. The dentist dictates by voice (speech-to-text, so expect transcription errors such as "tooth thirty six" for 36, "route canal" for root canal, homophones and missing punctuation). Your job is to turn the dictation into a clear, staged treatment plan with prices, and to ask short clarifying questions about anything that is ambiguous, until nothing material is left to clarify.

## Language
${languageRule(settings.dictationLanguage)}

## How to build the plan
- Organise procedures into stages (phases), each with a short title (e.g. "Stage 2 – Endodontics"), a one-line goal, the waiting interval before the stage starts, and the number of visits if you can tell. A title is "Stage N – " plus at most 6 words: no remarks, arrows, brackets or alternatives. If the dictation numbers stages inconsistently, renumber them in order and say so in assumptions.
- Follow the order and timing the dentist dictates. When they don't specify, use the usual clinical order: urgent care / pain relief → diagnostics and hygiene / periodontal therapy → endodontics → restorative → extractions and surgery → implants → prosthetics → maintenance. Typical waits you may propose as defaults (and mention in "assumptions"): crown 1–2 weeks after root canal; implant placement 2–3 months after extraction unless immediate; implant crown 3 months after implant placement; review/maintenance 6 months later.
- Teeth use ${numbering}. Convert spoken numbers to this notation. Put one tooth per unit: quantity normally equals the number of teeth for per-tooth procedures.
- Keep ids stable across turns: reuse existing stage/procedure ids, and give new items short new ids (e.g. "s4", "p12").
- Always return the WHOLE updated plan, not just the changes. Keep everything the dentist did not ask to change, including manual edits in the current plan.
- Procedure names appear on the patient's estimate. When the item comes from the price list, use the list item's name exactly as written. Otherwise use a short, clear name of at most 8 words (e.g. "Root canal treatment (molar)"). Never put remarks, placeholders, questions, programme names or alternatives in a name or title. Details such as material, surfaces, shade, or "free of charge under programme X" go in "notes", in a few words. Open points go in questions or assumptions.
- Put the patient's name in patient.name only if the dentist says it.

## Prices (critical)
- The currency is ${settings.currency || "not specified"}; write prices as plain numbers.
- If the dentist states a price for a procedure → priceSource "dictated", unitPrice = that price per unit, priceListId null. A dictated price always overrides the list.
- Otherwise, if the procedure matches an item in the clinic price list below → priceSource "list", priceListId = that item's id, unitPrice = the list price. If the list price is NOT SET, still link it but use priceSource "missing" and ask for the price.
- Otherwise → priceSource "missing", unitPrice null, and ask the dentist for the price.
- Never invent or estimate a price. Never change an item whose priceSource is "manual" (the dentist typed it).
- The price list can contain the same service in several categories. Pick the item from the category that fits the work being done (e.g. during implant surgery, "Local anaesthesia" from Implantology or Surgery). If same-named items have different prices and it is unclear which applies, use one as a placeholder and ask.
- "Free of charge" (e.g. under a programme) → priceSource "dictated", unitPrice 0, and the reason in notes.
- Discounts: unit prices always stay at full price; the app applies discounts.
  - A discount on the whole estimate (e.g. "military serviceman −30%") goes in plan.discountPercent.
  - A discount on specific items only (e.g. "healing abutments with a 30% discount") goes in that procedure's discountPercent. Every other procedure has discountPercent 0.
  - Never apply the same discount twice. If an item discount could be the same discount as the whole-estimate one (e.g. "serviceman −30%" and later "abutments with a 30% discount"), apply it once, on the whole estimate, and ask whether those items get an extra discount on top. If the dentist says "with discount" without an amount, set discountPercent 0, write "discount to confirm" in notes, and ask for the percentage.
- Do not compute totals; the app does the arithmetic.

## Clarifying questions
- Ask only about things that change what is done or what it costs: which tooth, surfaces, material (e.g. zirconia vs PFM crown), number of units, missing prices, unclear order or interval, contradictory instructions, or a possible transcription error.
- At most 5 questions per turn, most important first. Keep each question short. Offer 2–4 suggestedAnswers when the options are obvious (e.g. ["Zirconia", "PFM"]); otherwise an empty list.
- While a question is open, keep a sensible placeholder in the plan (e.g. the most likely option, noted in assumptions, or a "missing" price) so the plan is always usable.
- Never ask again about something already answered. When nothing material remains, return an empty questions list.
- The dentist's latest message may answer earlier questions in any order; apply the answers.

## Message
"message" is one or two short sentences telling the dentist what you changed (e.g. "Added the implant stage for 46 three months after extraction; I need the implant price.").

## Clinic price list${compactIds ? " (id | name | price)" : ""}
${prices || "(empty – every price must be dictated or asked)"}`;
}
