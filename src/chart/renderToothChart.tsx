import type { ComponentType, ReactNode } from "react";
import type { Plan, Settings } from "../../shared/schema";
import {
  chartLayout,
  normTooth,
  stageColor,
  stageInk,
  teethWork,
  tint,
  TOOTH_H,
  toothMarks,
  toothShape,
  type Mark,
  type ToothCell,
} from "../../shared/toothChart";

/**
 * The tooth chart is drawn twice: as DOM SVG in the app and with react-pdf's SVG
 * primitives in the PDF. Both get the same geometry by passing their primitives in.
 */
export interface SvgPrimitives {
  Svg: ComponentType<any> | string;
  G: ComponentType<any> | string;
  Path: ComponentType<any> | string;
  Circle: ComponentType<any> | string;
  Ellipse: ComponentType<any> | string;
  Line: ComponentType<any> | string;
  Text: ComponentType<any> | string;
}

export interface ToothChartOptions {
  plan: Plan;
  numbering: Settings["toothNumbering"];
  /** Pixel width to draw at (height follows). */
  width: number;
  selected?: string | null;
  hovered?: string | null;
  /** Web only: pointer handlers per tooth. */
  toothProps?: (cell: ToothCell) => Record<string, unknown>;
  /** react-pdf svg text needs its font size in `style`. */
  pdf?: boolean;
}

const LABEL_H = 13;
const PIP_R = 5;
const PIP_ROW = 14;
const MID_GAP = 10;
export const CHART_HEIGHT = (LABEL_H + TOOTH_H + PIP_ROW) * 2 + MID_GAP;

const INK = "#0f172a";
const CROWN = "#ffffff";
const ROOT = "#f4efe6";
const LINE = "#c3cbd6";
const METAL = "#dfe5ec";
const METAL_LINE = "#64748b";

interface BodyOptions {
  shape: ReturnType<typeof toothShape>;
  width: number;
  marks: Set<Mark>;
  color: string;
  treated: boolean;
  stroke: string;
  strokeWidth: number;
}

/** One tooth with the symbols for its planned work, in a `width` × TOOTH_H box. */
function toothBody(P: SvgPrimitives, b: BodyOptions): ReactNode {
  const { G, Path, Ellipse, Line } = P;
  const { shape, marks, color: c, treated, stroke, strokeWidth: sw } = b;
  if (marks.has("implant")) {
    // Implant: crown on a titanium screw, no natural roots.
    return (
      <G>
        <Path d={shape.implant.body} fill={METAL} stroke={METAL_LINE} strokeWidth={1} />
        {shape.implant.threads.map(([x1, y1, x2, y2], i) => (
          <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={METAL_LINE} strokeWidth={0.9} />
        ))}
        <Path d={shape.crown} fill={tint(c, marks.has("crown") ? 0.35 : 0.7)} stroke={stroke} strokeWidth={sw} />
      </G>
    );
  }
  if (marks.has("extraction")) {
    // Extraction: a faded outline crossed out.
    return (
      <G>
        <Path d={shape.outline} fill="#ffffff" stroke={tint(c, 0.25)} strokeWidth={1.1} strokeDasharray="3 2" />
        <Line x1={2} y1={4} x2={b.width - 2} y2={TOOTH_H - 4} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
        <Line x1={b.width - 2} y1={4} x2={2} y2={TOOTH_H - 4} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
      </G>
    );
  }
  return (
    <G>
      <Path d={shape.outline} fill={treated ? tint(c, 0.88) : ROOT} stroke={stroke} strokeWidth={sw} />
      <Path
        d={shape.crown}
        fill={marks.has("crown") ? tint(c, 0.35) : treated ? tint(c, 0.8) : CROWN}
        stroke={stroke}
        strokeWidth={marks.has("crown") ? sw + 0.6 : sw}
      />
      {marks.has("endo") &&
        shape.canals.map(([x1, y1, x2, y2], i) => (
          <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={2.2} strokeLinecap="round" />
        ))}
      {marks.has("other") && !marks.has("crown") && (
        <Ellipse cx={shape.filling.cx} cy={shape.filling.cy} rx={shape.filling.rx} ry={shape.filling.ry} fill={c} />
      )}
    </G>
  );
}

/** A small single tooth showing one kind of work, for legends. */
export function renderMarkIcon(P: SvgPrimitives, mark: Mark, color: string, height: number, pdf = false): ReactNode {
  const width = 27;
  const { Svg } = P;
  return (
    <Svg width={(width / TOOTH_H) * height} height={height} viewBox={`-1 -1 ${width + 2} ${TOOTH_H + 2}`} {...(pdf ? {} : { "aria-hidden": true })}>
      {toothBody(P, {
        shape: toothShape("premolar", width, false),
        width,
        marks: new Set([mark]),
        color,
        treated: true,
        stroke: color,
        strokeWidth: 1.4,
      })}
    </Svg>
  );
}

export function renderToothChart(P: SvgPrimitives, o: ToothChartOptions): ReactNode {
  const { Svg, G, Circle, Line, Text } = P;
  const layout = chartLayout(o.numbering);
  const work = teethWork(o.plan);
  const scale = o.width / layout.width;
  const text = (props: Record<string, unknown>, children: ReactNode, size: number) =>
    o.pdf ? (
      <Text {...props} style={{ fontSize: size, fontFamily: "Helvetica" }}>
        {children}
      </Text>
    ) : (
      <Text {...props} fontSize={size}>
        {children}
      </Text>
    );

  const upperY = LABEL_H;
  const upperPipY = upperY + TOOTH_H + PIP_ROW / 2;
  const biteY = upperY + TOOTH_H + PIP_ROW + MID_GAP / 2;
  const lowerPipY = upperY + TOOTH_H + PIP_ROW + MID_GAP + PIP_ROW / 2;
  const lowerY = upperY + TOOTH_H + PIP_ROW * 2 + MID_GAP;

  const tooth = (cell: ToothCell) => {
    const upper = cell.jaw === "upper";
    const shape = toothShape(cell.kind, cell.width, upper);
    const items = work.get(cell.label) ?? work.get(normTooth(cell.label)) ?? [];
    const treated = items.length > 0;
    const stages = [...new Set(items.map((w) => w.stageIndex))];
    const c = treated ? stageColor(stages[0]) : LINE;
    const marks = toothMarks(items);
    const active = o.selected === cell.label || o.hovered === cell.label;
    const dim = !!o.selected && o.selected !== cell.label;
    const stroke = active ? INK : treated ? c : LINE;
    const sw = active ? 2 : treated ? 1.4 : 1;

    const body = toothBody(P, { shape, width: cell.width, marks, color: c, treated, stroke, strokeWidth: sw });

    const pipY = upper ? upperPipY : lowerPipY;
    return (
      <G key={cell.label} transform={`translate(${cell.x} 0)`} opacity={dim ? 0.35 : 1} {...(o.toothProps?.(cell) ?? {})}>
        {text(
          {
            x: cell.width / 2,
            y: upper ? LABEL_H - 3.5 : lowerY + TOOTH_H + LABEL_H - 2,
            textAnchor: "middle",
            fill: active ? INK : treated ? "#334155" : "#94a3b8",
            fontWeight: treated || active ? "bold" : "normal",
          },
          cell.label,
          8,
        )}
        <G transform={`translate(0 ${upper ? upperY : lowerY})`}>{body}</G>
        {stages.slice(0, 3).map((si, k) => {
          const n = Math.min(stages.length, 3);
          const cx = cell.width / 2 + (k - (n - 1) / 2) * (PIP_R * 2 + 0.5);
          return (
            <G key={si}>
              <Circle cx={cx} cy={pipY} r={PIP_R} fill={stageColor(si)} stroke="#ffffff" strokeWidth={1} />
              {text({ x: cx, y: pipY + 2.4, textAnchor: "middle", fill: stageInk(si), fontWeight: "bold" }, String(si + 1), 6.5)}
            </G>
          );
        })}
      </G>
    );
  };

  const height = CHART_HEIGHT;
  const midX = (layout.upper[7].x + layout.upper[7].width + layout.upper[8].x) / 2;
  return (
    <Svg
      width={o.width}
      height={height * scale}
      viewBox={`-2 0 ${layout.width + 4} ${height}`}
      {...(o.pdf ? {} : { role: "img", "aria-label": "Tooth chart of the treatment plan" })}
    >
      <Line x1={0} y1={biteY} x2={layout.width} y2={biteY} stroke="#e2e8f0" strokeWidth={1} />
      <Line x1={midX} y1={6} x2={midX} y2={height - 6} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="3 3" />
      {text({ x: 0, y: biteY - 3, fill: "#94a3b8" }, "R", 7)}
      {text({ x: layout.width, y: biteY - 3, fill: "#94a3b8", textAnchor: "end" }, "L", 7)}
      {layout.upper.map(tooth)}
      {layout.lower.map(tooth)}
    </Svg>
  );
}
