import { readFile } from "node:fs/promises";
import { defaultSettings, type Plan, type PlanStatus, type PriceItem, type Question, type ConversationEntry } from "../shared/schema";
import { reconcilePrices } from "../shared/pricing";
import { store } from "./store";

/** One seeded case: a plan the assistant built from the sample dictations, at some point of the sales pipeline. */
interface DemoCase {
  status: PlanStatus;
  /** How long ago the case was created / last changed, so the dashboard looks lived-in. */
  createdDaysAgo: number;
  updatedDaysAgo: number;
  plan: Plan;
  questions: Question[];
  conversation: { role: ConversationEntry["role"]; text: string }[];
}

const DEMO_DIR = new URL("./demo/", import.meta.url);
const readDemo = async <T>(file: string): Promise<T> => JSON.parse(await readFile(new URL(file, DEMO_DIR), "utf8")) as T;

const daysAgo = (d: number, base = Date.now()) => new Date(base - d * 86_400_000).toISOString();

/**
 * Loads a demo clinic so the app can be shown without typing anything:
 *  - the sample price list, if the clinic has not priced its own list yet
 *  - demo clinic details, if the settings are still the defaults
 *  - a handful of patient cases at different stages (draft, presented, accepted…)
 * Existing plans are never touched.
 */
export async function loadDemo(): Promise<{ plansCreated: number; pricesLoaded: boolean; settingsLoaded: boolean }> {
  let priceList = await store.getPrices();
  const pricesLoaded = priceList.every((p) => p.price === null);
  if (pricesLoaded) {
    priceList = await readDemo<PriceItem[]>("prices.json");
    await store.setPrices(priceList);
  }

  const settings = await store.getSettings();
  const settingsLoaded = settings.clinicName === defaultSettings.clinicName && !settings.currency;
  if (settingsLoaded) {
    await store.setSettings({
      ...settings,
      clinicName: "Bright Smile Dental Clinic",
      clinicAddress: "12 Harbour Street, Old Town",
      clinicPhone: "+00 123 456 789 · hello@brightsmile.example",
      dentistName: "Dr. A. Demo",
      currency: "€",
    });
  }

  const cases = await readDemo<DemoCase[]>("plans.json");
  for (const c of cases) {
    const created = daysAgo(c.createdDaysAgo);
    await store.importPlan({
      status: c.status,
      createdAt: created,
      updatedAt: daysAgo(c.updatedDaysAgo),
      plan: reconcilePrices(c.plan, priceList),
      questions: c.questions,
      conversation: c.conversation.map((e) => ({ ...e, at: created })),
      versions: [],
      lastChanges: null,
    });
  }
  return { plansCreated: cases.length, pricesLoaded, settingsLoaded };
}
