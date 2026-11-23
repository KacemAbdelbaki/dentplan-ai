import { useState } from "react";
import type { Interval, Plan, PlanChanges, PriceItem, Procedure, Settings, Stage, Totals } from "../../shared/schema";
import { estimatedStartLabels, formatMoney, stageTimingLabel } from "../../shared/format";
import { isPriceMissing, lineTotal } from "../../shared/pricing";
import { normTooth, stageColor, stageInk } from "../../shared/toothChart";

interface Props {
  plan: Plan;
  totals: Totals;
  priceList: PriceItem[];
  settings: Settings;
  onChange: (plan: Plan) => void;
  disabled: boolean;
  /** What the last assistant turn changed (highlighted). */
  changes: PlanChanges | null;
  /** Tooth selected in the chart: other rows are dimmed. */
  toothFilter: string | null;
}

type RowMark = "added" | "changed" | null;

const SOURCE_LABEL: Record<Procedure["priceSource"], string> = {
  list: "price list",
  dictated: "dictated",
  manual: "edited",
  missing: "missing",
};

let idCounter = 0;
const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export function PlanEditor({ plan, totals, priceList, settings, onChange, disabled, changes, toothFilter }: Props) {
  const added = new Set(changes?.addedProcedureIds ?? []);
  const changed = new Set(changes?.changedProcedureIds ?? []);
  const stageMark = (id: string): RowMark =>
    changes?.addedStageIds.includes(id) ? "added" : changes?.changedStageIds.includes(id) ? "changed" : null;
  const matchesFilter = (p: Procedure) => !toothFilter || p.teeth.some((t) => normTooth(t) === toothFilter);
  const starts = estimatedStartLabels(plan);
  const money = (n: number | null) => formatMoney(n, settings);

  const updateStage = (si: number, patch: Partial<Stage>) =>
    onChange({ ...plan, stages: plan.stages.map((s, i) => (i === si ? { ...s, ...patch } : s)) });

  const updateProc = (si: number, pi: number, patch: Partial<Procedure>) =>
    updateStage(si, {
      procedures: plan.stages[si].procedures.map((p, i) => (i === pi ? { ...p, ...patch } : p)),
    });

  const moveStage = (si: number, dir: -1 | 1) => {
    const stages = [...plan.stages];
    const j = si + dir;
    if (j < 0 || j >= stages.length) return;
    [stages[si], stages[j]] = [stages[j], stages[si]];
    onChange({ ...plan, stages });
  };

  const addStage = () =>
    onChange({
      ...plan,
      stages: [
        ...plan.stages,
        {
          id: newId("s"),
          title: `Stage ${plan.stages.length + 1}`,
          goal: "",
          intervalBeforeStage: null,
          visits: null,
          procedures: [],
        },
      ],
    });

  const addProc = (si: number) =>
    updateStage(si, {
      procedures: [
        ...plan.stages[si].procedures,
        {
          id: newId("p"),
          name: "",
          teeth: [],
          quantity: 1,
          priceSource: "missing",
          priceListId: null,
          unitPrice: null,
          discountPercent: 0,
          notes: "",
        },
      ],
    });

  if (plan.stages.length === 0) {
    return (
      <section className="panel plan empty">
        <h2>Treatment plan</h2>
        <p className="muted">The plan will appear here after your first dictation.</p>
        <button type="button" className="ghost" onClick={addStage} disabled={disabled}>
          + Add a stage manually
        </button>
      </section>
    );
  }

  return (
    <section className="panel plan">
      <div className="plan-head">
        <h2>Treatment plan</h2>
        {totals.missingCount > 0 && (
          <span className="badge warn">
            {totals.missingCount} missing price{totals.missingCount > 1 ? "s" : ""}
          </span>
        )}
      </div>

      {plan.stages.map((stage, si) => {
        const st = totals.stages[si];
        const mark = stageMark(stage.id);
        const visible = stage.procedures.filter(matchesFilter).length;
        return (
          <div
            className={`stage ${mark ?? ""} ${toothFilter && !visible ? "filtered-out" : ""}`}
            key={stage.id}
            style={{ borderLeftColor: stageColor(si) }}
          >
            <div className="stage-head">
              <span className="stage-num" style={{ background: stageColor(si), color: stageInk(si) }}>
                {si + 1}
              </span>
              <input
                className="stage-title"
                value={stage.title}
                onChange={(e) => updateStage(si, { title: e.target.value })}
                disabled={disabled}
                aria-label="Stage title"
              />
              <div className="stage-actions">
                <button type="button" className="icon" onClick={() => moveStage(si, -1)} disabled={disabled || si === 0} title="Move up">
                  ↑
                </button>
                <button
                  type="button"
                  className="icon"
                  onClick={() => moveStage(si, 1)}
                  disabled={disabled || si === plan.stages.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon danger"
                  onClick={() => onChange({ ...plan, stages: plan.stages.filter((_, i) => i !== si) })}
                  disabled={disabled}
                  title="Delete stage"
                >
                  ✕
                </button>
              </div>
            </div>
            <input
              className="stage-goal"
              value={stage.goal}
              placeholder="Goal of this stage"
              onChange={(e) => updateStage(si, { goal: e.target.value })}
              disabled={disabled}
            />
            <div className="stage-timing">
              <IntervalInput
                value={stage.intervalBeforeStage}
                onChange={(intervalBeforeStage) => updateStage(si, { intervalBeforeStage })}
                disabled={disabled}
              />
              <span className="timing-label">
                {stageTimingLabel(plan, si)} · starts <strong>{starts[si]}</strong>
              </span>
              <label className="visits">
                Visits
                <input
                  type="number"
                  min={1}
                  value={stage.visits ?? ""}
                  onChange={(e) => updateStage(si, { visits: e.target.value ? Number(e.target.value) : null })}
                  disabled={disabled}
                />
              </label>
            </div>

            <table className="procs">
              <colgroup>
                <col />
                <col className="c-teeth" />
                <col className="c-qty" />
                <col className="c-price" />
                <col className="c-disc" />
                <col className="c-total" />
                <col className="c-act" />
              </colgroup>
              <thead>
                <tr>
                  <th>Procedure</th>
                  <th>Teeth</th>
                  <th className="num">Qty</th>
                  <th className="num">Unit price</th>
                  <th className="num" title="Discount on this item only">Disc.</th>
                  <th className="num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {stage.procedures.map((p, pi) => (
                  <ProcedureRow
                    key={p.id}
                    proc={p}
                    mark={added.has(p.id) ? "added" : changed.has(p.id) ? "changed" : null}
                    dimmed={!matchesFilter(p)}
                    priceList={priceList}
                    money={money}
                    disabled={disabled}
                    onChange={(patch) => updateProc(si, pi, patch)}
                    onDelete={() => updateStage(si, { procedures: stage.procedures.filter((_, i) => i !== pi) })}
                  />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>
                    <button type="button" className="link" onClick={() => addProc(si)} disabled={disabled}>
                      + Add procedure
                    </button>
                  </td>
                  <td className="num subtotal">{money(st?.subtotal ?? 0)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        );
      })}

      <button type="button" className="ghost add-stage" onClick={addStage} disabled={disabled}>
        + Add stage
      </button>

      <div className="plan-footer">
        <label>
          General notes
          <textarea
            rows={2}
            value={plan.generalNotes}
            onChange={(e) => onChange({ ...plan, generalNotes: e.target.value })}
            disabled={disabled}
          />
        </label>
        <div className="totals">
          {totals.itemDiscount > 0 && (
            <>
              <div className="muted">
                <span>Before discounts</span>
                <span>{money(totals.gross)}</span>
              </div>
              <div className="muted">
                <span>Item discounts</span>
                <span>−{money(totals.itemDiscount)}</span>
              </div>
            </>
          )}
          <div>
            <span>Subtotal</span>
            <span>{money(totals.subtotal)}</span>
          </div>
          <div>
            <span>
              Discount{" "}
              <input
                type="number"
                min={0}
                max={100}
                value={plan.discountPercent}
                onChange={(e) => onChange({ ...plan, discountPercent: Number(e.target.value) || 0 })}
                disabled={disabled}
                className="pct"
              />
              %
            </span>
            <span>−{money(totals.discount)}</span>
          </div>
          <div className="grand">
            <span>Total</span>
            <span>{money(totals.total)}</span>
          </div>
        </div>
      </div>

      {plan.assumptions.length > 0 && (
        <div className="assumptions">
          <strong>Assistant's assumptions</strong>
          <ul>
            {plan.assumptions.map((a, i) => (
              <li key={i}>
                {a}
                <button
                  type="button"
                  className="icon small"
                  title="Dismiss"
                  onClick={() => onChange({ ...plan, assumptions: plan.assumptions.filter((_, j) => j !== i) })}
                  disabled={disabled}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function IntervalInput({
  value,
  onChange,
  disabled,
}: {
  value: Interval | null;
  onChange: (v: Interval | null) => void;
  disabled: boolean;
}) {
  return (
    <span className="interval">
      Wait
      <input
        className="wait-num"
        type="number"
        min={0}
        value={value?.value ?? ""}
        placeholder="0"
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(e.target.value === "" || n <= 0 ? null : { value: n, unit: value?.unit ?? "weeks" });
        }}
        disabled={disabled}
      />
      <select
        value={value?.unit ?? "weeks"}
        onChange={(e) => value && onChange({ ...value, unit: e.target.value as Interval["unit"] })}
        disabled={disabled || !value}
      >
        <option value="days">days</option>
        <option value="weeks">weeks</option>
        <option value="months">months</option>
      </select>
    </span>
  );
}

function ProcedureRow({
  proc,
  mark,
  dimmed,
  priceList,
  money,
  disabled,
  onChange,
  onDelete,
}: {
  proc: Procedure;
  mark: RowMark;
  dimmed: boolean;
  priceList: PriceItem[];
  money: (n: number | null) => string;
  disabled: boolean;
  onChange: (patch: Partial<Procedure>) => void;
  onDelete: () => void;
}) {
  const [teethText, setTeethText] = useState(proc.teeth.join(", "));
  const [teethFocused, setTeethFocused] = useState(false);
  const shownTeeth = teethFocused ? teethText : proc.teeth.join(", ");
  const missing = isPriceMissing(proc);
  const amount = lineTotal(proc);

  return (
    <tr className={[missing && "missing", mark, dimmed && "dimmed"].filter(Boolean).join(" ")}>
      <td>
        {mark && (
          <span className={`change-tag ${mark}`} title="Changed by the assistant in its last update">
            {mark === "added" ? "new" : "updated"}
          </span>
        )}
        <input
          value={proc.name}
          placeholder="Procedure"
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
        />
        <input
          className="notes"
          value={proc.notes}
          placeholder="+ note"
          onChange={(e) => onChange({ notes: e.target.value })}
          disabled={disabled}
        />
      </td>
      <td>
        <input
          className="teeth"
          value={shownTeeth}
          placeholder="—"
          onFocus={() => {
            setTeethText(proc.teeth.join(", "));
            setTeethFocused(true);
          }}
          onBlur={() => setTeethFocused(false)}
          onChange={(e) => {
            setTeethText(e.target.value);
            onChange({
              teeth: e.target.value
                .split(/[,\s]+/)
                .map((t) => t.trim())
                .filter(Boolean),
            });
          }}
          disabled={disabled}
        />
      </td>
      <td className="num">
        <input
          type="number"
          min={1}
          className="qty"
          value={proc.quantity}
          onChange={(e) => onChange({ quantity: Math.max(1, Number(e.target.value) || 1) })}
          disabled={disabled}
        />
      </td>
      <td className="num">
        <input
          type="number"
          min={0}
          step="any"
          className="price"
          value={proc.unitPrice ?? ""}
          placeholder="?"
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? { unitPrice: null, priceSource: "missing" }
                : { unitPrice: Number(e.target.value), priceSource: "manual" },
            )
          }
          disabled={disabled}
        />
        <select
          className={`source ${proc.priceSource}`}
          value=""
          onChange={(e) => {
            const item = priceList.find((p) => p.id === e.target.value);
            if (item) onChange({ priceSource: "list", priceListId: item.id, unitPrice: item.price });
          }}
          disabled={disabled}
          title={
            proc.priceSource === "list"
              ? `From the price list: ${priceList.find((p) => p.id === proc.priceListId)?.name ?? "?"} (pick another item to change)`
              : "Price source. Pick a price-list item to use its price."
          }
        >
          <option value="">{SOURCE_LABEL[proc.priceSource]}</option>
          {priceList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.price === null ? "not set" : money(p.price)})
            </option>
          ))}
        </select>
      </td>
      <td className="num">
        <input
          type="number"
          min={0}
          max={100}
          className={`disc ${proc.discountPercent ? "on" : ""}`}
          value={proc.discountPercent || ""}
          placeholder="—"
          onChange={(e) => onChange({ discountPercent: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })}
          disabled={disabled}
          aria-label="Item discount percent"
        />
      </td>
      <td className="num">
        {proc.discountPercent > 0 && amount !== null && (
          <s className="was">{money((proc.unitPrice as number) * proc.quantity)}</s>
        )}
        {money(amount)}
      </td>
      <td>
        <button type="button" className="icon danger" onClick={onDelete} disabled={disabled} title="Delete procedure">
          ✕
        </button>
      </td>
    </tr>
  );
}
