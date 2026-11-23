import { useEffect, useMemo, useState } from "react";
import { PLAN_STATUSES, STATUS_LABEL, type PlanStatus, type PlanSummary, type Settings } from "../../shared/schema";
import { formatDuration, formatMoney } from "../../shared/format";
import { api } from "../api";

interface Props {
  settings: Settings;
  onOpen: (id: string) => void;
  onNew: () => void;
  onDemoLoaded: () => Promise<void>;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d > 1 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

type Filter = "all" | PlanStatus;

export function PlansList({ settings, onOpen, onNew, onDemoLoaded }: Props) {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [loadingDemo, setLoadingDemo] = useState(false);

  const load = () =>
    api
      .listPlans()
      .then(setPlans)
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const money = (n: number) => formatMoney(n, settings);

  const stats = useMemo(() => {
    const ps = plans ?? [];
    const by = (s: PlanStatus) => ps.filter((p) => p.status === s);
    const accepted = by("accepted");
    const declined = by("declined");
    const presented = by("presented");
    const decided = accepted.length + declined.length;
    const sum = (list: PlanSummary[]) => list.reduce((n, p) => n + p.total, 0);
    return {
      open: by("draft").length + by("final").length,
      presented: presented.length,
      presentedValue: sum(presented),
      acceptance: decided ? Math.round((accepted.length / decided) * 100) : null,
      decided,
      acceptedValue: sum(accepted),
      acceptedCount: accepted.length,
    };
  }, [plans]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: plans?.length ?? 0, draft: 0, final: 0, presented: 0, accepted: 0, declined: 0 };
    for (const p of plans ?? []) c[p.status]++;
    return c;
  }, [plans]);

  const shown = (plans ?? []).filter(
    (p) => (filter === "all" || p.status === filter) && (!query || p.patientName.toLowerCase().includes(query.toLowerCase())),
  );

  const remove = async (p: PlanSummary) => {
    if (!window.confirm(`Delete the plan for ${p.patientName || "this patient"}? This cannot be undone.`)) return;
    await api.deletePlan(p.id);
    load();
  };

  const duplicate = async (p: PlanSummary) => {
    const copy = await api.duplicatePlan(p.id);
    onOpen(copy.id);
  };

  const loadDemo = async () => {
    setLoadingDemo(true);
    setError(null);
    try {
      await api.loadDemo();
      await onDemoLoaded();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDemo(false);
    }
  };

  if (plans?.length === 0) {
    return (
      <div className="page">
        {error && <div className="error-box">{error}</div>}
        <div className="welcome">
          <div className="welcome-badge">🦷</div>
          <h1>Treatment plans in minutes, by voice</h1>
          <p className="lead">
            Dictate the plan the way you would tell a colleague. The assistant builds the stages, timing and prices from
            your price list, asks about anything unclear, and produces a patient-ready PDF.
          </p>
          <ol className="steps">
            <li>
              <strong>Set up once</strong>
              <span>Clinic details in Settings, your fees in the Price list.</span>
            </li>
            <li>
              <strong>Dictate</strong>
              <span>“Root canal on 36, zirconia crown two weeks later, implant on 46 after three months.”</span>
            </li>
            <li>
              <strong>Answer and send</strong>
              <span>Click the suggested answers, check the plan, download the PDF.</span>
            </li>
          </ol>
          <div className="row-gap center">
            <button type="button" className="primary big" onClick={onNew}>
              + Start a new plan
            </button>
            <button type="button" className="ghost big" onClick={loadDemo} disabled={loadingDemo}>
              {loadingDemo ? "Loading…" : "Explore with demo patients"}
            </button>
          </div>
          <p className="muted small">The demo adds six sample cases, a sample price list (€) and clinic details if yours are empty.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Treatment plans</h1>
          <p className="muted">{settings.clinicName}</p>
        </div>
        <button type="button" className="primary" onClick={onNew}>
          + New plan
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
      {plans === null && !error && <p className="muted">Loading…</p>}

      {plans && plans.length > 0 && (
        <>
          <div className="kpis">
            <div className="kpi">
              <span className="kpi-label">Open cases</span>
              <span className="kpi-value">{stats.open}</span>
              <span className="kpi-sub">drafts and ready-to-present</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Awaiting decision</span>
              <span className="kpi-value">{money(stats.presentedValue)}</span>
              <span className="kpi-sub">{stats.presented} presented case{stats.presented === 1 ? "" : "s"}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Acceptance rate</span>
              <span className="kpi-value">{stats.acceptance === null ? "—" : `${stats.acceptance}%`}</span>
              <span className="kpi-sub">{stats.decided ? `of ${stats.decided} decided case${stats.decided === 1 ? "" : "s"}` : "no decisions yet"}</span>
            </div>
            <div className="kpi accent">
              <span className="kpi-label">Accepted treatment</span>
              <span className="kpi-value">{money(stats.acceptedValue)}</span>
              <span className="kpi-sub">{stats.acceptedCount} accepted case{stats.acceptedCount === 1 ? "" : "s"}</span>
            </div>
          </div>

          <div className="list-toolbar">
            <div className="filter-chips" role="tablist" aria-label="Filter by status">
              {(["all", ...PLAN_STATUSES] as Filter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={filter === f}
                  className={`fchip ${filter === f ? "active" : ""}`}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "All" : STATUS_LABEL[f]} <span className="count">{counts[f]}</span>
                </button>
              ))}
            </div>
            <input
              className="search"
              type="search"
              placeholder="Search patients…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search patients"
            />
          </div>

          <table className="list plans-table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>Status</th>
                <th>Treatment</th>
                <th>Last change</th>
                <th className="num">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} onClick={() => onOpen(p.id)} className="clickable">
                  <td>
                    <div className="pt-name">{p.patientName || <span className="muted">Unnamed patient</span>}</div>
                  </td>
                  <td>
                    <span className={`status-badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                    {p.openQuestions > 0 && p.status === "draft" && (
                      <span className="badge" title="Open questions from the assistant">
                        {p.openQuestions} question{p.openQuestions > 1 ? "s" : ""}
                      </span>
                    )}
                    {p.missingCount > 0 && <span className="badge warn">{p.missingCount} price{p.missingCount > 1 ? "s" : ""} missing</span>}
                  </td>
                  <td className="muted">
                    {p.stageCount ? `${p.stageCount} stage${p.stageCount > 1 ? "s" : ""} · ${p.procedureCount} items · ${formatDuration(p.durationDays)}` : "Empty"}
                  </td>
                  <td className="muted" title={new Date(p.updatedAt).toLocaleString()}>
                    {relativeTime(p.updatedAt)}
                  </td>
                  <td className="num strong">{money(p.total)}</td>
                  <td className="num row-actions">
                    <button
                      type="button"
                      className="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicate(p);
                      }}
                      title="Duplicate"
                      aria-label="Duplicate plan"
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="icon danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        remove(p);
                      }}
                      title="Delete"
                      aria-label="Delete plan"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted center">
                    No plans match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="muted small foot-note">
            Tip: set a case to <em>Presented</em> after showing the PDF, then <em>Accepted</em> or <em>Declined</em> to
            track your acceptance rate.{" "}
            <button type="button" className="link small" onClick={loadDemo} disabled={loadingDemo}>
              Add demo patients
            </button>
          </p>
        </>
      )}
    </div>
  );
}
