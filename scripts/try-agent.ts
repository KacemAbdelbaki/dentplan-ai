/**
 * Smoke test of the Gemini agent without the UI (one real API call).
 *   npm run try-agent
 *   npm run try-agent -- "your own dictation here"
 */
import { emptyPlan, defaultSettings, type PriceItem } from "../shared/schema";
import { computeTotals } from "../shared/pricing";
import { runAgentTurn } from "../server/agent";

const priceList: PriceItem[] = [
  { id: "scaling", name: "Scaling & polishing", aliases: ["cleaning"], category: "Hygiene", price: 80 },
  { id: "rct-molar", name: "Root canal treatment – molar", aliases: ["endo molar"], category: "Endodontics", price: 300 },
  { id: "crown-zirconia", name: "Zirconia crown", aliases: [], category: "Prosthetics", price: 450 },
  { id: "crown-pfm", name: "PFM crown", aliases: [], category: "Prosthetics", price: 300 },
  { id: "extraction-simple", name: "Simple extraction", aliases: ["extraction"], category: "Surgery", price: 60 },
  { id: "implant", name: "Dental implant", aliases: [], category: "Implants", price: null },
];

const utterance =
  process.argv[2] ??
  "Patient John Smith. Start with scaling. Then root canal on thirty six and a crown, two weeks later. " +
    "Extract forty six and put an implant after three months, implant price 1200.";

const settings = { ...defaultSettings, currency: "$" };

const t0 = Date.now();
const result = await runAgentTurn({ utterance, plan: emptyPlan(), openQuestions: [], history: [], priceList, settings });
console.log(`\n⏱  ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log("MESSAGE:", result.message, "\n");
result.plan.stages.forEach((s, i) => {
  const iv = s.intervalBeforeStage ? `${s.intervalBeforeStage.value} ${s.intervalBeforeStage.unit}` : "immediately";
  console.log(`Stage ${i + 1}: ${s.title}  [wait: ${iv}]`);
  for (const p of s.procedures) {
    console.log(`   - ${p.name} | teeth ${p.teeth.join(",") || "-"} | x${p.quantity} | ${p.unitPrice ?? "?"} (${p.priceSource}${p.priceListId ? `:${p.priceListId}` : ""})`);
  }
});
console.log("\nQUESTIONS:");
result.questions.forEach((q) => console.log(` ? ${q.question}  ${q.suggestedAnswers.length ? `[${q.suggestedAnswers.join(" | ")}]` : ""}`));
console.log("\nASSUMPTIONS:", result.plan.assumptions);
console.log("\nTOTALS:", computeTotals(result.plan));
