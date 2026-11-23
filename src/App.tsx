import { useEffect, useState } from "react";
import type { PriceItem, Settings } from "../shared/schema";
import { api, type Health } from "./api";
import { PlansList } from "./components/PlansList";
import { PlanWorkspace } from "./components/PlanWorkspace";
import { PriceListPage } from "./components/PriceListPage";
import { SettingsPage } from "./components/SettingsPage";

type View = { name: "plans" } | { name: "plan"; id: string } | { name: "prices" } | { name: "settings" };

function viewFromHash(): View {
  const h = window.location.hash.replace(/^#\/?/, "");
  if (h.startsWith("plan/")) return { name: "plan", id: h.slice(5) };
  if (h === "prices") return { name: "prices" };
  if (h === "settings") return { name: "settings" };
  return { name: "plans" };
}

function hashFor(v: View) {
  return v.name === "plan" ? `#/plan/${v.id}` : v.name === "plans" ? "#/" : `#/${v.name}`;
}

export function App() {
  const [view, setView] = useState<View>(viewFromHash);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prices, setPrices] = useState<PriceItem[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getSettings(), api.getPrices(), api.health()])
      .then(([s, p, h]) => {
        setSettings(s);
        setPrices(p);
        setHealth(h);
      })
      .catch((e) => setFatal(e.message));
    const onHash = () => setView(viewFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (v: View) => {
    window.location.hash = hashFor(v);
    setView(v);
  };

  const newPlan = async () => {
    const p = await api.createPlan();
    go({ name: "plan", id: p.id });
  };

  if (fatal) return <div className="page"><div className="error-box">{fatal}</div></div>;
  if (!settings || !health) return <div className="page muted">Loading…</div>;

  return (
    <>
      <header className="topbar">
        <button type="button" className="brand" onClick={() => go({ name: "plans" })}>
          <span className="tooth">🦷</span>
          <span>
            Dent<em>Plan</em>
          </span>
        </button>
        <nav>
          <button type="button" className={view.name === "plans" || view.name === "plan" ? "active" : ""} onClick={() => go({ name: "plans" })}>
            Plans
          </button>
          <button type="button" className={view.name === "prices" ? "active" : ""} onClick={() => go({ name: "prices" })}>
            Price list
          </button>
          <button type="button" className={view.name === "settings" ? "active" : ""} onClick={() => go({ name: "settings" })}>
            Settings
          </button>
        </nav>
        <span
          className={`ai-state ${health.apiKeyConfigured ? "" : "off"}`}
          title={health.models.length ? `Models: ${health.models.join(", ")}` : "Add an API key to .env"}
        >
          <i /> {health.apiKeyConfigured ? "AI assistant ready" : "AI assistant not configured"}
        </span>
      </header>
      <main>
        {view.name === "plans" && (
          <PlansList
            settings={settings}
            onOpen={(id) => go({ name: "plan", id })}
            onNew={newPlan}
            onDemoLoaded={async () => {
              const [s, p] = await Promise.all([api.getSettings(), api.getPrices()]);
              setSettings(s);
              setPrices(p);
            }}
          />
        )}
        {view.name === "plan" && (
          <PlanWorkspace
            key={view.id}
            planId={view.id}
            settings={settings}
            priceList={prices}
            apiKeyConfigured={health.apiKeyConfigured}
            onBack={() => go({ name: "plans" })}
            onOpen={(id) => go({ name: "plan", id })}
          />
        )}
        {view.name === "prices" && <PriceListPage settings={settings} onSaved={setPrices} />}
        {view.name === "settings" && <SettingsPage settings={settings} onSaved={setSettings} />}
      </main>
    </>
  );
}
