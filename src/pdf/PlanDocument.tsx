import { Circle, Document, Ellipse, Font, G, Image, Line, Page, Path, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { Plan, Settings, Totals } from "../../shared/schema";
import {
  estimatedStartLabels,
  formatDuration,
  formatMoney,
  planDurationDays,
  stageStartDays,
  stageTimingLabel,
  teethLabel,
} from "../../shared/format";
import { lineTotal } from "../../shared/pricing";
import { chartLayout, MARK_LABEL, stageColor, stageInk, teethWork, toothMarks, type Mark } from "../../shared/toothChart";
import { renderMarkIcon, renderToothChart } from "../chart/renderToothChart";

// No automatic hyphenation: stage names in narrow columns broke as "Diagnos-tics".
Font.registerHyphenationCallback((word) => [word]);

const ACCENT = "#0f766e";
const MUTED = "#64748b";
const LINE = "#e2e8f0";
const INK = "#0f172a";

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 54, paddingHorizontal: 40, fontSize: 9.5, fontFamily: "Helvetica", color: INK },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  clinicBlock: { flexDirection: "row", alignItems: "center", maxWidth: "60%" },
  logo: { width: 48, height: 48, objectFit: "contain", marginRight: 10 },
  clinicName: { fontSize: 14, fontWeight: "bold", color: ACCENT },
  clinicLine: { color: MUTED, marginTop: 2 },
  docTitle: { fontSize: 18, fontWeight: "bold", textAlign: "right" },
  docMeta: { textAlign: "right", color: MUTED, marginTop: 3 },
  patientBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#f1f5f9",
    borderRadius: 4,
    padding: 10,
    marginBottom: 14,
  },
  label: { color: MUTED, fontSize: 7.5, textTransform: "uppercase", marginBottom: 2, letterSpacing: 0.4 },
  bold: { fontWeight: "bold" },
  big: { fontSize: 12, fontWeight: "bold" },
  sectionTitle: { fontSize: 11, fontWeight: "bold", marginBottom: 6, color: INK },
  overview: { borderWidth: 0.75, borderColor: LINE, borderRadius: 4, padding: 10, marginBottom: 16 },
  chartRow: { flexDirection: "row", alignItems: "center" },
  legendCol: { marginLeft: 12, flex: 1 },
  legendRow: { flexDirection: "row", alignItems: "center", marginBottom: 3, fontSize: 8.5 },
  swatch: { width: 9, height: 9, borderRadius: 4.5, marginRight: 5 },
  symbolKey: { color: MUTED, fontSize: 7, marginTop: 4, lineHeight: 1.35 },
  markKey: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  markItem: { flexDirection: "row", alignItems: "center", marginRight: 8, marginBottom: 3 },
  markText: { fontSize: 7.5, color: MUTED, marginLeft: 3 },
  tl: { flexDirection: "row", marginTop: 10 },
  tlSeg: { flexDirection: "column", minWidth: 70 },
  tlWhen: { fontSize: 7.5, color: MUTED, marginBottom: 2 },
  tlTrack: { flexDirection: "row", alignItems: "center", height: 16 },
  tlNode: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  tlNodeText: { fontSize: 8, fontWeight: "bold" },
  tlLine: { flex: 1, height: 1.5, backgroundColor: "#cbd5e1", marginHorizontal: 2 },
  tlTitle: { fontSize: 7.5, marginTop: 3, paddingRight: 6 },
  stage: { marginBottom: 14 },
  stageHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1.5, paddingBottom: 3, marginBottom: 4 },
  stageTitleRow: { flexDirection: "row", alignItems: "center" },
  stageBadge: { width: 15, height: 15, borderRadius: 7.5, alignItems: "center", justifyContent: "center", marginRight: 6 },
  stageTitle: { fontSize: 11.5, fontWeight: "bold" },
  stageTiming: { color: MUTED, fontSize: 8.5 },
  goal: { color: MUTED, fontStyle: "italic", marginBottom: 4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4 },
  th: { fontWeight: "bold", color: MUTED, fontSize: 7.5, textTransform: "uppercase" },
  cName: { flex: 1, paddingRight: 6 },
  cTeeth: { width: 66 },
  cQty: { width: 28, textAlign: "right" },
  cPrice: { width: 66, textAlign: "right" },
  cDisc: { width: 38, textAlign: "right" },
  cTotal: { width: 72, textAlign: "right" },
  note: { color: MUTED, fontSize: 7.5, marginTop: 1 },
  was: { color: MUTED, fontSize: 7.5, textDecoration: "line-through" },
  subtotalRow: { flexDirection: "row", justifyContent: "flex-end", paddingTop: 4 },
  summary: { marginTop: 6, alignSelf: "flex-end", width: 260 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grand: { borderTopWidth: 1.5, borderTopColor: INK, marginTop: 3, paddingTop: 5, fontSize: 12, fontWeight: "bold" },
  savings: { marginTop: 4, padding: 5, backgroundColor: "#ecfdf5", color: "#047857", borderRadius: 3, textAlign: "center", fontSize: 8.5 },
  notes: { marginTop: 16, padding: 10, borderWidth: 0.5, borderColor: LINE, borderRadius: 4 },
  disclaimer: { marginTop: 10, color: MUTED, fontSize: 8 },
  signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 40 },
  sigBox: { width: "42%", borderTopWidth: 0.75, borderTopColor: INK, paddingTop: 4, color: MUTED },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", color: MUTED, fontSize: 7.5 },
});

const PDF_SVG = { Svg, G, Path, Circle, Ellipse, Line, Text };
const MARK_ORDER: Mark[] = ["other", "endo", "crown", "extraction", "implant"];
const CHART_WIDTH = 340;

interface Props {
  plan: Plan;
  totals: Totals;
  settings: Settings;
  date: Date;
}

const cleanTitle = (t: string, i: number) => t.replace(/^stage\s*\d+\s*[–:-]\s*/i, "") || `Stage ${i + 1}`;

export function PlanDocument({ plan, totals, settings, date }: Props) {
  const money = (n: number | null) => (n === null ? "TBC" : formatMoney(n, settings));
  const starts = estimatedStartLabels(plan);
  const startDays = stageStartDays(plan);
  const duration = planDurationDays(plan);
  const fmtDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const dateStr = fmtDate(date);
  const validUntil = fmtDate(new Date(date.getTime() + settings.validityDays * 86400000));
  const anyItemDiscount = plan.stages.some((st) => st.procedures.some((p) => p.discountPercent > 0));
  const savings = totals.itemDiscount + totals.discount;

  // Tooth chart only when work is planned on numbered teeth that appear on the chart.
  const work = teethWork(plan);
  const layout = chartLayout(settings.toothNumbering);
  const charted = [...layout.upper, ...layout.lower].filter((c) => work.has(c.label));
  const marksUsedSet = new Set(charted.flatMap((c) => [...toothMarks(work.get(c.label)!)]));
  const marksUsed = MARK_ORDER.filter((m) => marksUsedSet.has(m));
  const minShare = Math.max(1, duration * 0.12);

  return (
    <Document title={`Treatment plan – ${plan.patient.name || "patient"}`} author={settings.clinicName}>
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={s.clinicBlock}>
            {settings.logoDataUrl ? <Image src={settings.logoDataUrl} style={s.logo} /> : null}
            <View>
              <Text style={s.clinicName}>{settings.clinicName}</Text>
              {settings.clinicAddress ? <Text style={s.clinicLine}>{settings.clinicAddress}</Text> : null}
              {settings.clinicPhone ? <Text style={s.clinicLine}>{settings.clinicPhone}</Text> : null}
            </View>
          </View>
          <View>
            <Text style={s.docTitle}>Treatment Plan</Text>
            <Text style={s.docMeta}>{dateStr}</Text>
          </View>
        </View>

        <View style={s.patientBox}>
          <View>
            <Text style={s.label}>Patient</Text>
            <Text style={s.bold}>{plan.patient.name || "—"}</Text>
          </View>
          <View>
            <Text style={s.label}>Dentist</Text>
            <Text>{settings.dentistName || "—"}</Text>
          </View>
          <View>
            <Text style={s.label}>Treatment</Text>
            <Text>
              {plan.stages.length} stage{plan.stages.length === 1 ? "" : "s"} · {formatDuration(duration)}
            </Text>
          </View>
          <View>
            <Text style={s.label}>Estimated total</Text>
            <Text style={s.big}>{formatMoney(totals.total, settings)}</Text>
          </View>
        </View>

        {plan.stages.length > 0 && (
          <View style={s.overview} wrap={false}>
            <Text style={s.sectionTitle}>Your treatment at a glance</Text>
            {charted.length > 0 && (
              <View style={s.chartRow}>
                {renderToothChart(PDF_SVG, { plan, numbering: settings.toothNumbering, width: CHART_WIDTH, pdf: true }) as any}
                <View style={s.legendCol}>
                  {plan.stages.map((st, i) => (
                    <View key={st.id} style={s.legendRow}>
                      <View style={[s.swatch, { backgroundColor: stageColor(i) }]} />
                      <Text style={{ flex: 1 }}>
                        Stage {i + 1}: {cleanTitle(st.title, i)}
                      </Text>
                    </View>
                  ))}
                  <View style={s.markKey}>
                    {marksUsed.map((m) => (
                      <View key={m} style={s.markItem}>
                        {renderMarkIcon(PDF_SVG, m, "#475569", 16, true) as any}
                        <Text style={s.markText}>{MARK_LABEL[m]}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={s.symbolKey}>Colour = stage that first treats the tooth; numbers = every stage involving it.</Text>
                </View>
              </View>
            )}
            <View style={s.tl}>
              {plan.stages.map((st, i) => {
                const last = i === plan.stages.length - 1;
                const until = last ? 0 : startDays[i + 1] - startDays[i];
                return (
                  <View key={st.id} style={[s.tlSeg, { flexGrow: last ? minShare * 0.8 : Math.max(until, minShare), flexBasis: 0 }]}>
                    <Text style={s.tlWhen}>{starts[i]}</Text>
                    <View style={s.tlTrack}>
                      <View style={[s.tlNode, { backgroundColor: stageColor(i) }]}>
                        <Text style={[s.tlNodeText, { color: stageInk(i) }]}>{i + 1}</Text>
                      </View>
                      {!last && <View style={s.tlLine} />}
                    </View>
                    <Text style={s.tlTitle}>{cleanTitle(st.title, i)}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {plan.stages.map((stage, i) => (
          <View key={stage.id} style={s.stage} wrap={stage.procedures.length > 8}>
            <View style={[s.stageHead, { borderBottomColor: stageColor(i) }]} minPresenceAhead={60}>
              <View style={s.stageTitleRow}>
                <View style={[s.stageBadge, { backgroundColor: stageColor(i) }]}>
                  <Text style={{ color: stageInk(i), fontSize: 8, fontWeight: "bold" }}>{i + 1}</Text>
                </View>
                <Text style={s.stageTitle}>{cleanTitle(stage.title, i)}</Text>
              </View>
              <Text style={s.stageTiming}>
                {stageTimingLabel(plan, i)} · est. {starts[i]}
                {stage.visits ? ` · ${stage.visits} visit${stage.visits > 1 ? "s" : ""}` : ""}
              </Text>
            </View>
            {stage.goal ? <Text style={s.goal}>{stage.goal}</Text> : null}
            <View style={s.row}>
              <Text style={[s.cName, s.th]}>Procedure</Text>
              <Text style={[s.cTeeth, s.th]}>Teeth</Text>
              <Text style={[s.cQty, s.th]}>Qty</Text>
              <Text style={[s.cPrice, s.th]}>Unit price</Text>
              {anyItemDiscount && <Text style={[s.cDisc, s.th]}>Disc.</Text>}
              <Text style={[s.cTotal, s.th]}>Amount</Text>
            </View>
            {stage.procedures.map((p) => {
              const unit = p.priceSource === "missing" ? null : p.unitPrice;
              const amount = lineTotal(p);
              return (
                <View key={p.id} style={s.row} wrap={false}>
                  <View style={s.cName}>
                    <Text>{p.name}</Text>
                    {p.notes ? <Text style={s.note}>{p.notes}</Text> : null}
                  </View>
                  <Text style={s.cTeeth}>{teethLabel(p.teeth) || "—"}</Text>
                  <Text style={s.cQty}>{p.quantity}</Text>
                  <Text style={s.cPrice}>{money(unit)}</Text>
                  {anyItemDiscount && <Text style={s.cDisc}>{p.discountPercent ? `-${p.discountPercent}%` : ""}</Text>}
                  <View style={s.cTotal}>
                    {p.discountPercent > 0 && amount !== null ? (
                      <Text style={s.was}>{formatMoney((unit as number) * p.quantity, settings)}</Text>
                    ) : null}
                    <Text>{amount === null ? "—" : formatMoney(amount, settings)}</Text>
                  </View>
                </View>
              );
            })}
            <View style={s.subtotalRow}>
              <Text style={s.bold}>Stage subtotal: {formatMoney(totals.stages[i]?.subtotal ?? 0, settings)}</Text>
            </View>
          </View>
        ))}

        <View style={s.summary} wrap={false}>
          {plan.stages.map((stage, i) => (
            <View key={stage.id} style={s.sumRow}>
              <Text>
                Stage {i + 1} ({starts[i]})
              </Text>
              <Text>{formatMoney(totals.stages[i]?.subtotal ?? 0, settings)}</Text>
            </View>
          ))}
          {totals.discount > 0 && (
            <>
              <View style={[s.sumRow, { borderTopWidth: 0.5, borderTopColor: LINE }]}>
                <Text>Subtotal</Text>
                <Text>{formatMoney(totals.subtotal, settings)}</Text>
              </View>
              <View style={s.sumRow}>
                <Text>Discount ({plan.discountPercent}%)</Text>
                <Text>-{formatMoney(totals.discount, settings)}</Text>
              </View>
            </>
          )}
          <View style={[s.sumRow, s.grand]}>
            <Text>Total</Text>
            <Text>{formatMoney(totals.total, settings)}</Text>
          </View>
          {savings > 0 && <Text style={s.savings}>Your savings on this plan: {formatMoney(savings, settings)}</Text>}
          {totals.missingCount > 0 && (
            <Text style={s.note}>
              {totals.missingCount} item{totals.missingCount > 1 ? "s" : ""} to be confirmed (TBC), not included in the total.
            </Text>
          )}
        </View>

        {plan.generalNotes ? (
          <View style={s.notes} wrap={false}>
            <Text style={s.label}>Notes</Text>
            <Text>{plan.generalNotes}</Text>
          </View>
        ) : null}

        <Text style={s.disclaimer}>
          This estimate is valid until {validUntil}. {settings.disclaimer}
        </Text>

        <View style={s.signatures} wrap={false}>
          <Text style={s.sigBox}>Dentist{settings.dentistName ? ` – ${settings.dentistName}` : ""}</Text>
          <Text style={s.sigBox}>Patient – read and approved</Text>
        </View>

        <View style={s.footer} fixed>
          <Text>
            {settings.clinicName} · Treatment plan for {plan.patient.name || "patient"} · {dateStr}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
