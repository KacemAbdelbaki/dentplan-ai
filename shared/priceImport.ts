import type { PriceItem } from "./schema";

export interface SkippedRow {
  row: number; // 1-based row number in the sheet
  name: string;
  reason: string;
}

const slug = (s: string, max: number) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, max)
    .replace(/-$/, "");

function toPrice(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.trim().replace(/\s/g, "").replace(",", "."));
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Converts the rows of a price-list sheet (columns: Service | Code | Price) into price items.
 *  - a row with a name but no price starts a new category
 *  - the header row ("Service", "Code", "Price …") is ignored
 *  - prices are rounded to 2 decimals (Excel stores 8.36 as 8.359999…)
 *  - ids are "<category>-<name>" slugs, so re-importing the same list keeps the same ids
 *    and existing plans stay linked to their price-list items
 */
export function rowsToPriceItems(rows: unknown[][]): { items: PriceItem[]; skipped: SkippedRow[] } {
  const items: PriceItem[] = [];
  const skipped: SkippedRow[] = [];
  const used = new Set<string>();
  let category = "";

  rows.forEach((row, index) => {
    const name = typeof row[0] === "string" ? row[0].trim() : "";
    if (!name) return;
    const rawPrice = row[2];
    const hasPriceCell = rawPrice !== null && rawPrice !== undefined && String(rawPrice).trim() !== "";

    if (!hasPriceCell) {
      category = name; // section heading
      return;
    }
    const price = toPrice(rawPrice);
    if (price === null) {
      if (index === 0) return; // header row: "Price, EUR"
      skipped.push({ row: index + 1, name, reason: `price "${String(rawPrice)}" is not a number` });
      return;
    }

    const base = `${slug(category.split(/[\s(]/)[0] || "item", 14)}-${slug(name, 60)}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);

    items.push({ id, name, aliases: [], category, price: Math.round(price * 100) / 100 });
  });

  return { items, skipped };
}
