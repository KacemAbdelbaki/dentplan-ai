import { describe, expect, it } from "vitest";
import { rowsToPriceItems } from "./priceImport";

describe("rowsToPriceItems", () => {
  const rows = [
    ["Service", "Code", "Price, EUR"],
    ["Restorative dentistry (treatment)", null, null],
    ["Single-use hygiene kit", "1.36.", 3.19],
    ["Additional glass-fibre post", "1.28.", 8.359999999999999],
    ["Local anaesthesia", "1.3.", 4.18],
    [null, null, null],
    ["Implantology", null, null],
    ["Local anaesthesia", null, 4.18],
    ["Temporary crown on implant", "6.22.", 51.37],
    ["Implant prosthetics", null, null],
    ["Temporary crown on implant", "6.22", 50.97],
    ["  Zirconia crown – Osstem  ", null, "360"],
  ];

  it("skips the header row, uses price-less rows as categories, and rounds prices", () => {
    const { items } = rowsToPriceItems(rows);
    expect(items).toHaveLength(7);
    expect(items[0]).toEqual({
      id: "restorative-single-use-hygiene-kit",
      name: "Single-use hygiene kit",
      aliases: [],
      category: "Restorative dentistry (treatment)",
      price: 3.19,
    });
    expect(items[1].price).toBe(8.36);
  });

  it("keeps same-named items from different categories, with unique ids", () => {
    const { items } = rowsToPriceItems(rows);
    const anaesthesia = items.filter((i) => i.name === "Local anaesthesia");
    expect(anaesthesia.map((i) => i.category)).toEqual(["Restorative dentistry (treatment)", "Implantology"]);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    const temp = items.filter((i) => i.name === "Temporary crown on implant");
    expect(temp.map((i) => i.price)).toEqual([51.37, 50.97]);
  });

  it("trims names and accepts numeric strings as prices", () => {
    const { items } = rowsToPriceItems(rows);
    const last = items[items.length - 1];
    expect(last.name).toBe("Zirconia crown – Osstem");
    expect(last.price).toBe(360);
    expect(last.category).toBe("Implant prosthetics");
  });

  it("makes ids unique when the same name repeats inside one category", () => {
    const { items } = rowsToPriceItems([
      ["Surgery", null, null],
      ["Local anaesthesia", null, 4.18],
      ["Local anaesthesia", null, 5],
    ]);
    expect(items.map((i) => i.id)).toEqual(["surgery-local-anaesthesia", "surgery-local-anaesthesia-2"]);
  });

  it("reports rows it could not use", () => {
    const { items, skipped } = rowsToPriceItems([
      ["Surgery", null, null],
      ["Something", null, "ask"],
      ["Membrane placement", null, 120],
    ]);
    expect(items).toHaveLength(1);
    expect(skipped).toEqual([{ row: 2, reason: 'price "ask" is not a number', name: "Something" }]);
  });
});
