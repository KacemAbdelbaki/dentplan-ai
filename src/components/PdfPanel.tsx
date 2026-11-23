import { PDFViewer, pdf } from "@react-pdf/renderer";
import { useMemo, useState } from "react";
import type { Plan, PlanStatus, Settings, Totals } from "../../shared/schema";
import { PlanDocument } from "../pdf/PlanDocument";

interface Props {
  plan: Plan;
  totals: Totals;
  settings: Settings;
  openQuestions: number;
  status: PlanStatus;
  onPresented: () => void;
}

function fileName(plan: Plan) {
  const name = (plan.patient.name || "patient").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_");
  return `Treatment_plan_${name}_${new Date().toISOString().slice(0, 10)}.pdf`;
}

export function PdfPanel({ plan, totals, settings, openQuestions, status, onPresented }: Props) {
  const [downloading, setDownloading] = useState(false);
  const date = useMemo(() => new Date(), []);
  const doc = <PlanDocument plan={plan} totals={totals} settings={settings} date={date} />;

  const download = async () => {
    setDownloading(true);
    try {
      const blob = await pdf(doc).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(plan);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } finally {
      setDownloading(false);
    }
  };

  const warnings = [
    totals.missingCount > 0 && `${totals.missingCount} price(s) are missing and will show as "to be confirmed".`,
    openQuestions > 0 && `${openQuestions} question(s) from the assistant are still open.`,
    !plan.patient.name && "The patient name is empty.",
    !settings.currency && "No currency is set (Settings).",
  ].filter(Boolean) as string[];

  return (
    <section className="panel pdf-panel">
      <div className="pdf-toolbar">
        <h2>PDF preview</h2>
        <span className="spacer" />
        {(status === "draft" || status === "final") && (
          <button type="button" className="ghost" onClick={onPresented} title="Track this case in the dashboard">
            Mark as presented to patient
          </button>
        )}
        <button type="button" className="primary" onClick={download} disabled={downloading || plan.stages.length === 0}>
          {downloading ? "Preparing…" : "Download PDF"}
        </button>
      </div>
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {plan.stages.length === 0 ? (
        <p className="muted">Nothing to preview yet.</p>
      ) : (
        <PDFViewer className="pdf-viewer" showToolbar>
          {doc}
        </PDFViewer>
      )}
    </section>
  );
}
