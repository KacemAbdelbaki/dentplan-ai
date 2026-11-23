/**
 * Runs the client's sample dictations through the real assistant, using the clinic
 * price list currently loaded in the app (data/prices.json).
 *   npm run test-patients                      → all patients in the notes file
 *   npm run test-patients -- 3                 → only patient 3
 *   npm run test-patients -- 1,4 "other.txt"   → patients 1 and 4 from another file
 * Each "PATIENT n" block in the notes file is sent as one dictation.
 * Results go to test-output/: patient-N.json (plan, questions, totals) and patient-N.pdf.
 * Makes one real Gemini call per patient.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderToFile } from "@react-pdf/renderer";
import { runAgentTurn } from "../server/agent";
import { store } from "../server/store";
import { computeTotals } from "../shared/pricing";
import { formatMoney, stageTimingLabel } from "../shared/format";
import { emptyPlan } from "../shared/schema";
import { PlanDocument } from "../src/pdf/PlanDocument";

const only = process.argv[2] && /^[\d,]+$/.test(process.argv[2]) ? process.argv[2].split(",").map(Number) : null;
const notesFile = process.argv[3] ?? "provided resources/dentist_notes_EN (1).txt";
const outDir = "test-output";

/** Splits the notes file into one dictation per "PATIENT n" heading. */
function parsePatients(text: string): { n: number; dictation: string }[] {
  const parts = text.split(/^PATIENT\s+(\d+)[^\n]*\n/m);
  const patients: { n: number; dictation: string }[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const dictation = parts[i + 1]
      .replace(/^[-=]{3,}\s*$/gm, "")
      .replace(/^\s*•\s*/gm, "- ")
      .trim();
    patients.push({ n: Number(parts[i]), dictation });
  }
  return patients;
}

const priceList = await store.getPrices();
const settings = { ...(await store.getSettings()), currency: "€" };
const patients = parsePatients(readFileSync(notesFile, "utf8")).filter((p) => !only || only.includes(p.n));
mkdirSync(outDir, { recursive: true });
console.log(`Price list: ${priceList.length} items · ${patients.length} patient(s) from ${notesFile}\n`);

let failures = 0;
for (const { n, dictation } of patients) {
  console.log(`${"=".repeat(70)}\nPATIENT ${n}\n${"=".repeat(70)}`);
  const t0 = Date.now();
  try {
    const result = await runAgentTurn({
      utterance: dictation,
      plan: emptyPlan(),
      openQuestions: [],
      history: [],
      priceList,
      settings,
    });
    const totals = computeTotals(result.plan);
    const money = (v: number | null) => formatMoney(v, settings);
    console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s, ${result.model})  ${result.message}\n`);

    result.plan.stages.forEach((s, i) => {
      console.log(`Stage ${i + 1}: ${s.title}  [${stageTimingLabel(result.plan, i)}]  subtotal ${money(totals.stages[i].subtotal)}`);
      for (const p of s.procedures) {
        const src = p.priceSource === "list" ? `list:${p.priceListId}` : p.priceSource;
        const teeth = p.teeth.length ? ` [${p.teeth.join(",")}]` : "";
        console.log(`   ${String(p.quantity).padStart(2)} × ${p.name}${teeth} — ${p.unitPrice === null ? "?" : money(p.unitPrice)} (${src})${p.discountPercent ? ` −${p.discountPercent}%` : ""}${p.notes ? `  // ${p.notes}` : ""}`);
      }
    });
    console.log(`\nTOTAL ${money(totals.total)}  (subtotal ${money(totals.subtotal)}, discount ${result.plan.discountPercent}% = ${money(totals.discount)}, ${totals.missingCount} missing price(s))`);
    if (result.plan.generalNotes) console.log(`NOTES: ${result.plan.generalNotes}`);
    console.log(`\nQUESTIONS (${result.questions.length}):`);
    result.questions.forEach((q, i) =>
      console.log(`  ${i + 1}. ${q.question}${q.suggestedAnswers.length ? `  [${q.suggestedAnswers.join(" | ")}]` : ""}`),
    );
    console.log(`\nASSUMPTIONS (${result.plan.assumptions.length}):`);
    result.plan.assumptions.forEach((a) => console.log(`  - ${a}`));
    console.log();

    writeFileSync(path.join(outDir, `patient-${n}.json`), JSON.stringify({ dictation, ...result, totals }, null, 2));
    await renderToFile(
      <PlanDocument plan={result.plan} totals={totals} settings={settings} date={new Date()} />,
      path.join(outDir, `patient-${n}.pdf`),
    );
  } catch (err) {
    failures++;
    console.log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${err instanceof Error ? err.message : err}\n`);
  }
}
console.log(`Done: ${patients.length - failures}/${patients.length} patients produced a plan. Files in ${outDir}/`);
process.exitCode = failures ? 1 : 0;
