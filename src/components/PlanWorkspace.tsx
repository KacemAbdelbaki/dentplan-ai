import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PLAN_STATUSES,
  STATUS_LABEL,
  type Plan,
  type PlanStatus,
  type PriceItem,
  type Question,
  type SavedPlan,
  type Settings,
} from "../../shared/schema";
import { computeTotals, hasChanges } from "../../shared/pricing";
import { formatMoney } from "../../shared/format";
import { api, ApiError } from "../api";
import { DictationBar } from "./DictationBar";
import { PlanEditor } from "./PlanEditor";
import { QuestionsPanel } from "./QuestionsPanel";
import { Timeline } from "./Timeline";
import { ToothChart } from "./ToothChart";

interface Props {
  planId: string;
  settings: Settings;
  priceList: PriceItem[];
  apiKeyConfigured: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
}

// react-pdf is large; load it only when the PDF tab is opened.
const PdfPanel = lazy(() => import("./PdfPanel").then((m) => ({ default: m.PdfPanel })));

const answerLine = (q: Question, a: string) => `Re "${q.question}": ${a}.`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PlanWorkspace({ planId, settings, priceList, apiKeyConfigured, onBack, onOpen }: Props) {
  const [saved, setSaved] = useState<SavedPlan | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; retryable: boolean } | null>(null);
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [backupModel, setBackupModel] = useState<string | null>(null);
  const [tab, setTab] = useState<"plan" | "pdf">("plan");
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [toothFilter, setToothFilter] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSentDraft = useRef("");

  useEffect(() => {
    api
      .getPlan(planId)
      .then((p) => {
        setSaved(p);
        setPlan(p.plan);
      })
      .catch((e) => setError({ text: e.message, retryable: false }));
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [planId]);

  const totals = useMemo(() => (plan ? computeTotals(plan) : null), [plan]);

  const persist = useCallback(
    async (next: Plan, extra: { questions?: Question[]; status?: PlanStatus } = {}) => {
      setSaveState("saving");
      try {
        const res = await api.savePlan(planId, { plan: next, ...extra });
        setSaved(res);
        setSaveState("saved");
        return res;
      } catch {
        setSaveState("error");
        return null;
      }
    },
    [planId],
  );

  /** Manual edits: update immediately, save after a short pause. */
  const editPlan = (next: Plan) => {
    setPlan(next);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persist(next), 700);
  };

  /** Saves any pending manual edit right away (before an action that reads the saved plan). */
  const flush = async () => {
    if (saveTimer.current && plan) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
      await persist(plan);
    }
  };

  const sendTurn = async (text?: string) => {
    const utterance = (text ?? draft).trim();
    if (!plan || !utterance) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setBusy(true);
    setError(null);
    setNotice(null);
    lastSentDraft.current = utterance;
    try {
      const res = await api.turn(planId, utterance, plan);
      setSaved(res);
      setBackupModel(res.usedBackupModel && res.answeredBy ? res.answeredBy : null);
      setPlan(res.plan);
      setDraft("");
      setAnswered({});
      setSaveState("saved");
    } catch (e) {
      const err = e as ApiError;
      setError({ text: err.message, retryable: err.retryable });
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setBusy(true);
    setError(null);
    try {
      const res = await api.undo(planId);
      setSaved(res);
      setPlan(res.plan);
      setBackupModel(null);
      setAnswered({});
      if (res.undoneUtterance) setDraft(res.undoneUtterance);
      setNotice("Undone. Your dictation is back in the box: edit it and send again, or clear it.");
    } catch (e) {
      setError({ text: (e as Error).message, retryable: false });
    } finally {
      setBusy(false);
    }
  };

  const dismissChanges = async () => {
    if (!plan) return;
    await flush();
    const res = await api.savePlan(planId, { lastChanges: null });
    setSaved(res);
  };

  const setStatus = async (status: PlanStatus) => {
    await flush();
    const res = await api.setStatus(planId, status);
    setSaved(res);
  };

  const duplicate = async () => {
    await flush();
    const copy = await api.duplicatePlan(planId);
    onOpen(copy.id);
  };

  const onAnswer = (q: Question, a: string) => {
    setAnswered((prev) => ({ ...prev, [q.id]: a }));
    setDraft((prev) => {
      const re = new RegExp(`^Re "${escapeRe(q.question)}": .*$`, "m");
      const line = answerLine(q, a);
      if (re.test(prev)) return prev.replace(re, line);
      return prev.trim() ? `${prev.trimEnd()}\n${line}` : line;
    });
  };

  const finish = async () => {
    if (!plan) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const status = saved && saved.status !== "draft" ? saved.status : "final";
    await persist(plan, { status });
    setTab("pdf");
  };

  if (!saved || !plan || !totals) {
    return <div className="page">{error ? <div className="error-box">{error.text}</div> : <div className="muted">Loading…</div>}</div>;
  }

  const changes = saved.lastChanges;
  const showChanges = hasChanges(changes) && !busy;
  const canUndo = saved.versions.length > 0;

  return (
    <div className="workspace">
      <div className="ws-head">
        <button type="button" className="link back" onClick={onBack}>
          ← Plans
        </button>
        <label className="patient">
          <span className="sr-only">Patient name</span>
          <input
            value={plan.patient.name}
            placeholder="Patient name"
            onChange={(e) => editPlan({ ...plan, patient: { ...plan.patient, name: e.target.value } })}
            disabled={busy}
          />
        </label>
        <select
          className={`status-select ${saved.status}`}
          value={saved.status}
          onChange={(e) => setStatus(e.target.value as PlanStatus)}
          disabled={busy}
          aria-label="Case status"
          title="Case status"
        >
          {PLAN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <span className={`save-state ${saveState}`}>
          {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved!" : "✓ Saved"}
        </span>
        <span className="spacer" />
        <div className="ws-total">
          <span>Total</span>
          <strong>{formatMoney(totals.total, settings)}</strong>
          {totals.missingCount > 0 && <em>+ {totals.missingCount} TBC</em>}
        </div>
        <div className="ws-actions">
          <button type="button" className="ghost" onClick={undo} disabled={busy || !canUndo} title="Undo the last assistant update">
            ↶ Undo
          </button>
          <button type="button" className="ghost" onClick={duplicate} disabled={busy} title="Copy this plan (e.g. an alternative option)">
            Duplicate
          </button>
          <div className="tabs">
            <button type="button" className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}>
              Plan
            </button>
            <button type="button" className={tab === "pdf" ? "active" : ""} onClick={() => setTab("pdf")}>
              PDF
            </button>
          </div>
          <button type="button" className="primary" onClick={finish} disabled={busy || plan.stages.length === 0}>
            I'm satisfied → PDF
          </button>
        </div>
      </div>

      {!apiKeyConfigured && (
        <div className="error-box">
          The AI assistant is not configured: add your <code>GEMINI_API_KEY</code> to the <code>.env</code> file and
          restart the app. You can still edit plans by hand.
        </div>
      )}

      <DictationBar
        draft={draft}
        setDraft={(u) => setDraft(u)}
        onSend={() => sendTurn()}
        busy={busy}
        lang={settings.dictationLanguage}
        placeholder={
          plan.stages.length
            ? "Dictate changes or answers, e.g. “Crown on 36 is zirconia. Implant price 1200. 30% off the abutments.”"
            : "e.g. “Patient John Smith. Start with scaling. Root canal on 36 then a zirconia crown two weeks later. Extract 46 and place an implant after three months, implant price 1200.”"
        }
      />

      {showChanges && changes && (
        <div className="changes-box">
          <span className="changes-icon">✦</span>
          <span>
            The assistant{" "}
            {[
              changes.addedProcedureIds.length && `added ${plural(changes.addedProcedureIds.length, "item")}`,
              changes.changedProcedureIds.length && `updated ${plural(changes.changedProcedureIds.length, "item")}`,
              changes.addedStageIds.length && `created ${plural(changes.addedStageIds.length, "stage")}`,
              changes.removed.length && `removed ${changes.removed.slice(0, 3).join(", ")}${changes.removed.length > 3 ? "…" : ""}`,
            ]
              .filter(Boolean)
              .join(", ")}
            . Changes are highlighted below.
          </span>
          <span className="spacer" />
          {canUndo && (
            <button type="button" className="link" onClick={undo}>
              Undo this update
            </button>
          )}
          <button type="button" className="link" onClick={dismissChanges}>
            Looks good
          </button>
        </div>
      )}

      {notice && !busy && (
        <div className="info-box">
          {notice}
          <button type="button" className="link" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      )}

      {backupModel && !busy && (
        <div className="warn-box">
          The main AI model was busy, so a backup model ({backupModel}) wrote this update. Backup models make more
          mistakes: please check the procedures and prices carefully.
        </div>
      )}

      {error && (
        <div className="error-box">
          {error.text}
          {error.retryable && (
            <button type="button" className="link" onClick={() => sendTurn(lastSentDraft.current)} disabled={busy}>
              Retry
            </button>
          )}
        </div>
      )}

      {tab === "plan" ? (
        <div className="ws-body">
          <QuestionsPanel
            conversation={saved.conversation}
            questions={saved.questions}
            answered={answered}
            onAnswer={onAnswer}
            busy={busy}
          />
          <div className="ws-main">
            {plan.stages.length > 0 && (
              <div className="visuals">
                <Timeline plan={plan} />
                <ToothChart plan={plan} settings={settings} selected={toothFilter} onSelect={setToothFilter} />
              </div>
            )}
            <PlanEditor
              plan={plan}
              totals={totals}
              priceList={priceList}
              settings={settings}
              onChange={editPlan}
              disabled={busy}
              changes={showChanges ? changes : null}
              toothFilter={toothFilter}
            />
          </div>
        </div>
      ) : (
        <Suspense fallback={<div className="panel muted">Loading PDF engine…</div>}>
          <PdfPanel
            plan={plan}
            totals={totals}
            settings={settings}
            openQuestions={saved.questions.length}
            status={saved.status}
            onPresented={() => setStatus("presented")}
          />
        </Suspense>
      )}
    </div>
  );
}
