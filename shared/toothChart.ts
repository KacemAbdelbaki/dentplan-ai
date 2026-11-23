import type { Plan, Procedure, Settings } from "./schema";

/**
 * Stage colours: a muted categorical palette (checked for lightness, chroma, contrast and
 * colour-blind separation), assigned in a fixed order. Stage 9+ reuses the last slot and
 * relies on the stage number label.
 */
export const STAGE_COLORS = ["#24609e", "#c0712f", "#088a70", "#8a62b5", "#9c7f12", "#b04a5e", "#3f86cc", "#64852a"];
export const stageColor = (index: number) => STAGE_COLORS[Math.min(index, STAGE_COLORS.length - 1)];
/** Text on a stage-colour fill. */
export const stageInk = (_index: number) => "#ffffff";

export type ToothKind = "incisor" | "canine" | "premolar" | "molar";
export type Mark = "extraction" | "implant" | "crown" | "endo" | "other";

export interface ToothCell {
  /** Tooth number in the clinic's notation. */
  label: string;
  /** FDI number (used for the anatomy). */
  fdi: number;
  jaw: "upper" | "lower";
  kind: ToothKind;
  x: number;
  width: number;
}

const kindOf = (pos: number): ToothKind => (pos <= 2 ? "incisor" : pos === 3 ? "canine" : pos <= 5 ? "premolar" : "molar");
const WIDTH: Record<ToothKind, number> = { incisor: 24, canine: 26, premolar: 27, molar: 34 };
export const CHART_GAP = 3;
export const MIDLINE_GAP = 10;

/** FDI → Universal (permanent teeth). */
export function fdiToUniversal(fdi: number): number {
  const q = Math.floor(fdi / 10);
  const p = fdi % 10;
  if (q === 1) return 9 - p;
  if (q === 2) return 8 + p;
  if (q === 3) return 25 - p;
  return 24 + p;
}

/**
 * The 32 permanent teeth as seen facing the patient (patient's right on the viewer's left),
 * with x positions. Upper row: 18…11 | 21…28; lower row: 48…41 | 31…38.
 */
export function chartLayout(numbering: Settings["toothNumbering"]): { upper: ToothCell[]; lower: ToothCell[]; width: number } {
  const row = (jaw: "upper" | "lower"): ToothCell[] => {
    const [right, left] = jaw === "upper" ? [1, 2] : [4, 3];
    const order = [...[8, 7, 6, 5, 4, 3, 2, 1].map((p) => right * 10 + p), ...[1, 2, 3, 4, 5, 6, 7, 8].map((p) => left * 10 + p)];
    let x = 0;
    return order.map((fdi, i) => {
      const kind = kindOf(fdi % 10);
      if (i === 8) x += MIDLINE_GAP - CHART_GAP;
      const cell: ToothCell = {
        label: numbering === "FDI" ? String(fdi) : String(fdiToUniversal(fdi)),
        fdi,
        jaw,
        kind,
        x,
        width: WIDTH[kind],
      };
      x += cell.width + CHART_GAP;
      return cell;
    });
  };
  const upper = row("upper");
  const lower = row("lower");
  const last = upper[upper.length - 1];
  return { upper, lower, width: last.x + last.width };
}

/** What a procedure does to a tooth, for the chart symbol. */
export function markOf(p: Procedure): Mark {
  const n = `${p.name} ${p.notes}`.toLowerCase();
  if (/extract|removal of (a )?tooth/.test(n)) return "extraction";
  if (/implant/.test(n) && !/crown|abutment|scan|temporar|prosthe|bridge/.test(n)) return "implant";
  if (/crown|veneer|onlay|inlay|bridge|abutment/.test(n)) return "crown";
  if (/root canal|endo|pulp/.test(n)) return "endo";
  return "other";
}

export interface ToothWork {
  stageIndex: number;
  procedureId: string;
  name: string;
  mark: Mark;
}

/** Normalises a tooth reference ("tooth 36", " 36 ") to the bare number. */
export const normTooth = (t: string) => t.trim().replace(/^(tooth|site|#)\s*/i, "");

/** For each tooth number, the work planned on it, in stage order. */
export function teethWork(plan: Plan): Map<string, ToothWork[]> {
  const map = new Map<string, ToothWork[]>();
  plan.stages.forEach((stage, stageIndex) => {
    for (const p of stage.procedures) {
      for (const t of p.teeth) {
        const key = normTooth(t);
        if (!key) continue;
        const list = map.get(key) ?? [];
        list.push({ stageIndex, procedureId: p.id, name: p.name, mark: markOf(p) });
        map.set(key, list);
      }
    }
  });
  return map;
}

/** The symbol that best sums up the work on one tooth (final state wins: implant over extraction). */
export function dominantMark(work: ToothWork[]): Mark {
  const marks = new Set(work.map((w) => w.mark));
  if (marks.has("implant")) return "implant";
  if (marks.has("extraction")) return marks.has("crown") ? "implant" : "extraction";
  if (marks.has("crown")) return "crown";
  if (marks.has("endo")) return "endo";
  return "other";
}

export const MARK_LABEL: Record<Mark, string> = {
  extraction: "Extraction",
  implant: "Implant",
  crown: "Crown / prosthesis",
  endo: "Root canal",
  other: "Other treatment",
};

/** Height of the crown and of the tallest root, in chart units. */
export const CROWN_H = 24;
export const ROOT_H = 40;
export const TOOTH_H = CROWN_H + ROOT_H;

const ROOT_LEN: Record<ToothKind, number> = { incisor: 34, canine: 40, premolar: 34, molar: 30 };

export interface ToothShape {
  /** Whole silhouette (crown + roots). */
  outline: string;
  /** Crown only (closed along the gum line). */
  crown: string;
  /** Gum line (cemento-enamel junction). */
  gumLine: [number, number, number, number];
  /** Root canals, one per root. */
  canals: [number, number, number, number][];
  /** Where an implant screw goes (replaces the roots). */
  implant: { body: string; threads: [number, number, number, number][] };
  /** A spot on the biting surface, for fillings. */
  filling: { cx: number; cy: number; rx: number; ry: number };
}

/**
 * Anatomical tooth (side view) inside a box `w` wide and TOOTH_H high, as SVG paths
 * shared by the web chart and the PDF. Drawn for the lower jaw (crown on top, roots
 * pointing down); `upper` mirrors it so upper crowns face the bite line too.
 */
export function toothShape(kind: ToothKind, w: number, upper: boolean): ToothShape {
  const Y = (y: number) => +(upper ? TOOTH_H - y : y).toFixed(2);
  const X = (f: number) => +(f * w).toFixed(2);
  const p = (x: number, y: number) => `${x.toFixed(2)} ${Y(y)}`;
  const ch = CROWN_H;
  const rl = ROOT_LEN[kind];
  const apex = ch + rl;
  const L: [number, number] = [X(0.17), ch];
  const R: [number, number] = [X(0.83), ch];

  // Crown edge, from the left gum line over the biting surface to the right gum line.
  let crownEdge: string;
  if (kind === "molar") {
    crownEdge = `M ${p(...L)} Q ${p(0, ch * 0.55)} ${p(1.2, 5)} Q ${p(X(0.27), -1.5)} ${p(X(0.5), 3)} Q ${p(X(0.73), -1.5)} ${p(w - 1.2, 5)} Q ${p(w, ch * 0.55)} ${p(...R)}`;
  } else if (kind === "premolar") {
    crownEdge = `M ${p(...L)} Q ${p(0, ch * 0.5)} ${p(1.4, 6)} Q ${p(X(0.5), -3)} ${p(w - 1.4, 6)} Q ${p(w, ch * 0.5)} ${p(...R)}`;
  } else if (kind === "canine") {
    crownEdge = `M ${p(...L)} Q ${p(0, ch * 0.5)} ${p(1.6, 8)} Q ${p(X(0.3), 2)} ${p(X(0.5), -2)} Q ${p(X(0.7), 2)} ${p(w - 1.6, 8)} Q ${p(w, ch * 0.5)} ${p(...R)}`;
  } else {
    crownEdge = `M ${p(...L)} Q ${p(0.4, ch * 0.5)} ${p(1.4, 2.5)} Q ${p(X(0.5), 0.5)} ${p(w - 1.4, 2.5)} Q ${p(w - 0.4, ch * 0.5)} ${p(...R)}`;
  }

  // Root edge, from the right gum line around the apex(es) back to the left.
  let rootEdge: string;
  let canals: ToothShape["canals"];
  if (kind === "molar") {
    rootEdge =
      `Q ${p(X(0.88), ch + rl * 0.55)} ${p(X(0.74), apex)} Q ${p(X(0.66), apex + 1.5)} ${p(X(0.6), apex - 4)} ` +
      `Q ${p(X(0.54), ch + rl * 0.3)} ${p(X(0.5), ch + rl * 0.28)} Q ${p(X(0.46), ch + rl * 0.3)} ${p(X(0.4), apex - 4)} ` +
      `Q ${p(X(0.34), apex + 1.5)} ${p(X(0.26), apex)} Q ${p(X(0.12), ch + rl * 0.55)} ${p(...L)}`;
    canals = [
      [X(0.4), Y(ch - 6), X(0.3), Y(apex - 3)],
      [X(0.6), Y(ch - 6), X(0.7), Y(apex - 3)],
    ];
  } else {
    rootEdge =
      `Q ${p(X(0.84), ch + rl * 0.6)} ${p(X(0.56), apex)} Q ${p(X(0.5), apex + 1.5)} ${p(X(0.44), apex)} ` +
      `Q ${p(X(0.16), ch + rl * 0.6)} ${p(...L)}`;
    canals = [[X(0.5), Y(ch - 6), X(0.5), Y(apex - 3)]];
  }

  // Implant fixture: a tapered screw where the roots were.
  const top = ch + 1;
  const bottom = ch + ROOT_LEN.canine - 6;
  const body = `M ${p(X(0.3), top)} L ${p(X(0.7), top)} L ${p(X(0.62), bottom)} Q ${p(X(0.5), bottom + 3)} ${p(X(0.38), bottom)} Z`;
  const threads: ToothShape["implant"]["threads"] = [];
  for (let y = top + 4; y < bottom - 1; y += 4.5) {
    const t = (y - top) / (bottom - top);
    const half = 0.2 - 0.08 * t + 0.07;
    threads.push([X(0.5 - half), Y(y), X(0.5 + half), Y(y + 1.6)]);
  }

  return {
    outline: `${crownEdge} ${rootEdge} Z`,
    crown: `${crownEdge} Z`,
    gumLine: [L[0], Y(ch), R[0], Y(ch)],
    canals,
    implant: { body, threads },
    filling: { cx: X(0.5), cy: Y(7.5), rx: Math.max(3, w * 0.17), ry: 3.2 },
  };
}

/** What to draw on one tooth, from all the work planned on it. */
export function toothMarks(work: ToothWork[]): Set<Mark> {
  const marks = new Set(work.map((w) => w.mark));
  // An extraction followed by an implant ends as an implant.
  if (marks.has("implant")) marks.delete("extraction");
  return marks;
}

/** Mixes a hex colour with white: amount 0 = colour, 1 = white. */
export function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(mix);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

/** Timeline geometry: each stage's position (0–1) along a track, by start day. */
export function timelinePositions(startDays: number[]): number[] {
  const end = startDays.at(-1) ?? 0;
  if (end <= 0) return startDays.map((_, i) => (startDays.length > 1 ? i / (startDays.length - 1) : 0));
  // Keep stages that start on the same day visibly apart.
  const raw = startDays.map((d) => d / end);
  const minGap = Math.min(0.08, 1 / Math.max(1, startDays.length));
  const out: number[] = [];
  raw.forEach((v, i) => out.push(i === 0 ? v : Math.max(v, out[i - 1] + minGap)));
  const max = out.at(-1) ?? 1;
  return max > 1 ? out.map((v) => v / max) : out;
}
