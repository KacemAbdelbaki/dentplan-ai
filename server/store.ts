import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  defaultPriceList,
  defaultSettings,
  emptyPlan,
  migrateSavedPlan,
  type PriceItem,
  type SavedPlan,
  type Settings,
} from "../shared/schema";

const DATA_DIR = process.env.DENTPLAN_DATA_DIR ?? path.resolve("data");
const PLANS_DIR = path.join(DATA_DIR, "plans");
const PRICES_FILE = path.join(DATA_DIR, "prices.json");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err: any) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

/** Write via temp file + rename so a crash never leaves a half-written file. */
async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, file);
}

const isSafeId = (id: string) => /^[a-zA-Z0-9-]{1,64}$/.test(id);
const planFile = (id: string) => {
  if (!isSafeId(id)) throw new Error("Invalid plan id");
  return path.join(PLANS_DIR, `${id}.json`);
};

export const store = {
  getPrices: () => readJson<PriceItem[]>(PRICES_FILE, defaultPriceList),
  setPrices: (items: PriceItem[]) => writeJson(PRICES_FILE, items),

  getSettings: async () => ({ ...defaultSettings, ...(await readJson<Partial<Settings>>(SETTINGS_FILE, {})) }),
  setSettings: (s: Settings) => writeJson(SETTINGS_FILE, s),

  async listPlans(): Promise<SavedPlan[]> {
    let files: string[] = [];
    try {
      files = (await fs.readdir(PLANS_DIR)).filter((f) => f.endsWith(".json"));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw err;
    }
    const plans = await Promise.all(files.map((f) => readJson<SavedPlan | null>(path.join(PLANS_DIR, f), null)));
    return plans
      .filter((p): p is SavedPlan => !!p)
      .map(migrateSavedPlan)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async getPlan(id: string): Promise<SavedPlan | null> {
    if (!isSafeId(id)) return null;
    const raw = await readJson<SavedPlan | null>(planFile(id), null);
    return raw ? migrateSavedPlan(raw) : null;
  },

  /** New plan; `from` pre-fills it (duplicating a plan, demo data). */
  async createPlan(from: Partial<Omit<SavedPlan, "id">> = {}): Promise<SavedPlan> {
    const now = new Date().toISOString();
    const saved: SavedPlan = {
      status: "draft",
      plan: emptyPlan(),
      questions: [],
      conversation: [],
      versions: [],
      lastChanges: null,
      createdAt: now,
      ...from,
      id: randomUUID(),
      updatedAt: now,
    };
    await writeJson(planFile(saved.id), saved);
    return saved;
  },

  /** Writes a plan with its own timestamps (demo data, imports). */
  async importPlan(data: Omit<SavedPlan, "id">): Promise<SavedPlan> {
    const saved: SavedPlan = { ...data, id: randomUUID() };
    await writeJson(planFile(saved.id), saved);
    return saved;
  },

  async savePlan(saved: SavedPlan): Promise<SavedPlan> {
    const next = { ...saved, updatedAt: new Date().toISOString() };
    await writeJson(planFile(saved.id), next);
    return next;
  },

  async deletePlan(id: string): Promise<void> {
    if (!isSafeId(id)) return;
    await fs.rm(planFile(id), { force: true });
  },
};
