/**
 * Replaces the clinic price list with the contents of an Excel file
 * (first sheet; columns: Service | Code | Price; rows without a price are category headings).
 *   npm run import-prices -- "provided resources/Dental_Price_List_EUR.xlsx"
 * Aliases already typed in the app are kept for items whose id is unchanged.
 * Restart the app afterwards if it is running.
 */
import { readSheet } from "read-excel-file/node";
import { rowsToPriceItems } from "../shared/priceImport";
import { store } from "../server/store";

const file = process.argv[2];
if (!file) {
  console.error('Usage: npm run import-prices -- "path/to/price-list.xlsx"');
  process.exit(1);
}

const rows = (await readSheet(file)) as unknown[][];
const { items, skipped } = rowsToPriceItems(rows);
if (items.length === 0) {
  console.error("No price items found in the first sheet. Nothing was changed.");
  process.exit(1);
}

const existing = new Map((await store.getPrices()).map((p) => [p.id, p]));
const merged = items.map((it) => ({ ...it, aliases: existing.get(it.id)?.aliases ?? [] }));
await store.setPrices(merged);

const byCategory = new Map<string, number>();
for (const it of merged) byCategory.set(it.category, (byCategory.get(it.category) ?? 0) + 1);
console.log(`Imported ${merged.length} price items from ${file}:`);
for (const [c, n] of byCategory) console.log(`  ${String(n).padStart(4)}  ${c}`);
for (const s of skipped) console.log(`  skipped row ${s.row} (${s.name}): ${s.reason}`);

const sameName = new Map<string, Set<number>>();
for (const it of merged) sameName.set(it.name, (sameName.get(it.name) ?? new Set()).add(it.price ?? -1));
const conflicts = [...sameName].filter(([, prices]) => prices.size > 1);
if (conflicts.length) {
  console.log("Same name with different prices (the assistant will ask which one applies):");
  for (const [name, prices] of conflicts) console.log(`  ${name}: ${[...prices].join(" / ")}`);
}
