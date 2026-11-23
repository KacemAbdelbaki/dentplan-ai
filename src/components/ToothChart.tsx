import { useMemo, useState } from "react";
import type { Plan, Settings } from "../../shared/schema";
import { MARK_LABEL, normTooth, stageColor, teethWork, toothMarks, type Mark } from "../../shared/toothChart";
import { renderMarkIcon, renderToothChart } from "../chart/renderToothChart";

interface Props {
  plan: Plan;
  settings: Settings;
  selected: string | null;
  onSelect: (tooth: string | null) => void;
}

const DOM = { Svg: "svg", G: "g", Path: "path", Circle: "circle", Ellipse: "ellipse", Line: "line", Text: "text" } as const;
const MARK_ORDER: Mark[] = ["other", "endo", "crown", "extraction", "implant"];
const MARK_SHORT: Record<Mark, string> = {
  other: "Filling / other",
  endo: "Root canal",
  crown: "Crown",
  extraction: "Extraction",
  implant: "Implant",
};

/** Odontogram: teeth coloured by the stage they are treated in. Click a tooth to filter the plan. */
export function ToothChart({ plan, settings, selected, onSelect }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const work = useMemo(() => teethWork(plan), [plan]);
  const focus = hovered ?? selected;
  const focusWork = focus ? (work.get(focus) ?? work.get(normTooth(focus)) ?? []) : [];
  const marksUsed = new Set([...work.values()].flatMap((w) => [...toothMarks(w)]));

  const chart = renderToothChart(DOM, {
    plan,
    numbering: settings.toothNumbering,
    width: 760,
    selected,
    hovered,
    toothProps: (cell) => ({
      className: `tooth-hit ${work.has(cell.label) ? "has-work" : ""}`,
      onMouseEnter: () => setHovered(cell.label),
      onMouseLeave: () => setHovered(null),
      onClick: () => onSelect(selected === cell.label ? null : cell.label),
      tabIndex: 0,
      role: "button",
      "aria-label": `Tooth ${cell.label}${work.has(cell.label) ? ", treatment planned" : ""}`,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(selected === cell.label ? null : cell.label);
        }
      },
    }),
  });

  return (
    <section className="panel chart-panel">
      <div className="panel-head">
        <h2>Tooth chart</h2>
        <span className="muted small">
          {work.size ? `${work.size} ${work.size === 1 ? "tooth" : "teeth"} involved · click a tooth to see only its work` : "No tooth-specific work yet"}
        </span>
        <span className="spacer" />
        {selected && (
          <button type="button" className="chip selected" onClick={() => onSelect(null)}>
            Tooth {selected} ✕
          </button>
        )}
      </div>
      <div className="chart-wrap">{chart}</div>
      <div className="chart-foot">
        {focus ? (
          <div className="tooth-detail">
            <strong>Tooth {focus}</strong>
            {focusWork.length === 0 ? (
              <span className="muted">No treatment planned</span>
            ) : (
              focusWork.map((w) => (
                <span key={w.procedureId + w.stageIndex} className="tooth-work">
                  <i className="dot" style={{ background: stageColor(w.stageIndex) }} />
                  Stage {w.stageIndex + 1} · {w.name}
                </span>
              ))
            )}
          </div>
        ) : (
          <div className="legend">
            {MARK_ORDER.filter((m) => marksUsed.has(m)).map((m) => (
              <span key={m} className="legend-item" title={MARK_LABEL[m]}>
                {renderMarkIcon(DOM, m, "#475569", 34)}
                {MARK_SHORT[m]}
              </span>
            ))}
            {marksUsed.size > 0 && <span className="legend-note muted">Colour = stage that treats the tooth first · numbers = all its stages</span>}
          </div>
        )}
      </div>
    </section>
  );
}
