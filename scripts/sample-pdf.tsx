/**
 * Renders a sample treatment-plan PDF without the browser (checks the PDF layout).
 *   npm run sample-pdf            → writes sample-plan.pdf
 *   npm run sample-pdf -- out.pdf
 */
import { renderToFile } from "@react-pdf/renderer";
import { PlanDocument } from "../src/pdf/PlanDocument";
import { computeTotals } from "../shared/pricing";
import { defaultSettings, type Plan } from "../shared/schema";

const plan: Plan = {
  patient: { name: "John Smith", notes: "" },
  discountPercent: 5,
  generalNotes: "Patient prefers morning appointments.",
  assumptions: [],
  stages: [
    {
      id: "s1", title: "Stage 1 – Hygiene", goal: "Healthy gums before treatment", intervalBeforeStage: null, visits: 1,
      procedures: [
        { id: "p1", name: "Scaling & polishing", teeth: [], quantity: 1, priceSource: "list", priceListId: "scaling", unitPrice: 80, discountPercent: 0, notes: "" },
      ],
    },
    {
      id: "s2", title: "Endodontics & crown", goal: "Save tooth 36", intervalBeforeStage: { value: 1, unit: "weeks" }, visits: 2,
      procedures: [
        { id: "p2", name: "Root canal treatment (molar)", teeth: ["36"], quantity: 1, priceSource: "list", priceListId: "rct-molar", unitPrice: 300, discountPercent: 0, notes: "" },
        { id: "p3", name: "Zirconia crown", teeth: ["36"], quantity: 1, priceSource: "list", priceListId: "crown-zirconia", unitPrice: 450, discountPercent: 0, notes: "Shade A2" },
      ],
    },
    {
      id: "s3", title: "Implant", goal: "Replace 46", intervalBeforeStage: { value: 3, unit: "months" }, visits: null,
      procedures: [
        { id: "p4", name: "Dental implant", teeth: ["46"], quantity: 1, priceSource: "dictated", priceListId: null, unitPrice: 1200, discountPercent: 0, notes: "" },
        { id: "p5", name: "Bone graft", teeth: ["46"], quantity: 1, priceSource: "missing", priceListId: null, unitPrice: null, discountPercent: 0, notes: "If needed" },
      ],
    },
  ],
};

const settings = {
  ...defaultSettings,
  currency: "$",
  clinicName: "Smile Dental Clinic",
  clinicAddress: "12 Main Street",
  clinicPhone: "+1 555 0100",
  dentistName: "Dr. Example",
};

const out = process.argv[2] ?? "sample-plan.pdf";
await renderToFile(<PlanDocument plan={plan} totals={computeTotals(plan)} settings={settings} date={new Date()} />, out);
console.log(`Wrote ${out}`);
