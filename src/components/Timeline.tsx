import type { Plan } from "../../shared/schema";
import { estimatedStartLabels, formatDuration, planDurationDays, stageStartDays } from "../../shared/format";
import { stageColor, stageInk } from "../../shared/toothChart";

/**
 * Treatment timeline: one segment per stage, its length proportional to the time until the
 * next stage (with a minimum so short stages stay readable).
 */
export function Timeline({ plan }: { plan: Plan }) {
  if (plan.stages.length === 0) return null;
  const starts = stageStartDays(plan);
  const labels = estimatedStartLabels(plan);
  const total = planDurationDays(plan);
  const minShare = Math.max(1, total * 0.12);

  return (
    <section className="panel timeline-panel">
      <div className="panel-head">
        <h2>Timeline</h2>
        <span className="muted small">
          {plan.stages.length} stage{plan.stages.length > 1 ? "s" : ""} · {formatDuration(total)}
        </span>
      </div>
      <div className="timeline" role="list">
        {plan.stages.map((s, i) => {
          const until = i < starts.length - 1 ? starts[i + 1] - starts[i] : 0;
          const grow = i < starts.length - 1 ? Math.max(until, minShare) : minShare * 0.8;
          return (
            <div key={s.id} className="tl-seg" style={{ flexGrow: grow }} role="listitem">
              <div className="tl-when">{labels[i]}</div>
              <div className="tl-track">
                <span className="tl-node" style={{ background: stageColor(i), color: stageInk(i) }}>
                  {i + 1}
                </span>
                {i < plan.stages.length - 1 && <span className="tl-line" />}
                {i < plan.stages.length - 1 && until > 0 && (
                  <span className="tl-wait">{formatDuration(until).replace("about ", "~")}</span>
                )}
              </div>
              <div className="tl-title" title={s.title}>
                {s.title.replace(/^stage\s*\d+\s*[–:-]\s*/i, "") || `Stage ${i + 1}`}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
