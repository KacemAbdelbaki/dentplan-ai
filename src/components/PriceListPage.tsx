import { useEffect, useState } from "react";
import type { PriceItem, Settings } from "../../shared/schema";
import { api } from "../api";

interface Props {
  settings: Settings;
  onSaved: (items: PriceItem[]) => void;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "item";

export function PriceListPage({ settings, onSaved }: Props) {
  const [items, setItems] = useState<PriceItem[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    api.getPrices().then(setItems).catch((e) => setError(e.message));
  }, []);

  if (!items) return <div className="page">{error ? <div className="error-box">{error}</div> : "Loading…"}</div>;

  const update = (i: number, patch: Partial<PriceItem>) => {
    setItems(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
    setStatus(null);
  };

  const add = () => {
    setItems([...items, { id: `item-${Date.now().toString(36)}`, name: "", aliases: [], category: "", price: null }]);
    setStatus(null);
  };

  const save = async () => {
    setError(null);
    // Give new items a readable id derived from the name, keeping ids unique.
    const used = new Set<string>();
    const cleaned = items
      .filter((it) => it.name.trim())
      .map((it) => {
        let id = it.id.startsWith("item-") ? slug(it.name) : it.id;
        let n = 2;
        const base = id;
        while (used.has(id)) id = `${base}-${n++}`;
        used.add(id);
        return { ...it, id, name: it.name.trim(), category: it.category.trim() };
      });
    try {
      const saved = await api.setPrices(cleaned);
      setItems(saved);
      onSaved(saved);
      setStatus("Saved ✓");
    } catch (e: any) {
      setError(e.message);
    }
  };

  const unset = items.filter((i) => i.price === null).length;
  const q = filter.toLowerCase();

  return (
    <div className="page">
      <div className="page-head">
        <h1>Price list</h1>
        <div className="row-gap">
          {status && <span className="ok-text">{status}</span>}
          <button type="button" className="primary" onClick={save}>
            Save price list
          </button>
        </div>
      </div>
      <p className="muted">
        The assistant uses these prices automatically. A price you dictate always overrides the list. Aliases help the
        assistant recognise what you say (e.g. "cleaning" → Scaling &amp; polishing). Prices in{" "}
        <strong>{settings.currency || "(set a currency in Settings)"}</strong>.
      </p>
      {unset > 0 && <div className="warn-box">{unset} item(s) have no price yet. They will be asked about when used.</div>}
      {error && <div className="error-box">{error}</div>}
      <input className="filter" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <table className="list prices">
        <thead>
          <tr>
            <th>Procedure</th>
            <th>Also called (comma-separated)</th>
            <th>Category</th>
            <th className="num">Price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) =>
            q && !`${it.name} ${it.aliases.join(" ")} ${it.category}`.toLowerCase().includes(q) ? null : (
              <tr key={it.id + i}>
                <td>
                  <input value={it.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Name" />
                </td>
                <td>
                  <input
                    defaultValue={it.aliases.join(", ")}
                    onBlur={(e) =>
                      update(i, {
                        aliases: e.target.value
                          .split(",")
                          .map((a) => a.trim())
                          .filter(Boolean),
                      })
                    }
                    placeholder={i === 0 ? "e.g. cleaning, hygiene" : "+ add aliases"}
                  />
                </td>
                <td>
                  <input value={it.category} onChange={(e) => update(i, { category: e.target.value })} />
                </td>
                <td className="num">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    className={`price ${it.price === null ? "unset" : ""}`}
                    value={it.price ?? ""}
                    placeholder="not set"
                    onChange={(e) => update(i, { price: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon danger"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                    title="Remove"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      <button type="button" className="ghost" onClick={add}>
        + Add item
      </button>
    </div>
  );
}
