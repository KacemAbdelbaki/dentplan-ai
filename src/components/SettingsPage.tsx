import { useState } from "react";
import type { Settings } from "../../shared/schema";
import { api } from "../api";

const DICTATION_LANGUAGES: [string, string][] = [
  ["en-US", "English (US)"],
  ["en-GB", "English (UK)"],
  ["uk-UA", "Ukrainian"],
  ["pl-PL", "Polish"],
  ["fr-FR", "French"],
  ["ar-DZ", "Arabic (Algeria)"],
  ["ar-SA", "Arabic"],
  ["de-DE", "German"],
  ["es-ES", "Spanish"],
  ["it-IT", "Italian"],
  ["pt-PT", "Portuguese"],
  ["ro-RO", "Romanian"],
  ["tr-TR", "Turkish"],
  ["nl-NL", "Dutch"],
];

interface Props {
  settings: Settings;
  onSaved: (s: Settings) => void;
}

export function SettingsPage({ settings, onSaved }: Props) {
  const [s, setS] = useState<Settings>(settings);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setS({ ...s, [k]: v });
    setStatus(null);
  };

  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) {
      setError("Please use a logo smaller than 1 MB.");
      return;
    }
    if (!/^image\/(png|jpe?g)$/.test(file.type)) {
      setError("The logo must be a PNG or JPG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logoDataUrl", String(reader.result));
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setError(null);
    try {
      const saved = await api.setSettings(s);
      onSaved(saved);
      setStatus("Saved ✓");
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="page narrow">
      <div className="page-head">
        <h1>Settings</h1>
        <div className="row-gap">
          {status && <span className="ok-text">{status}</span>}
          <button type="button" className="primary" onClick={save}>
            Save settings
          </button>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}

      <fieldset>
        <legend>Clinic (shown on the PDF)</legend>
        <label>
          Clinic name
          <input value={s.clinicName} onChange={(e) => set("clinicName", e.target.value)} />
        </label>
        <label>
          Address
          <input value={s.clinicAddress} onChange={(e) => set("clinicAddress", e.target.value)} />
        </label>
        <label>
          Phone / email
          <input value={s.clinicPhone} onChange={(e) => set("clinicPhone", e.target.value)} />
        </label>
        <label>
          Dentist name
          <input value={s.dentistName} onChange={(e) => set("dentistName", e.target.value)} placeholder="Dr. …" />
        </label>
        <label>
          Logo (PNG/JPG)
          <div className="logo-row">
            {s.logoDataUrl && <img src={s.logoDataUrl} alt="Clinic logo" className="logo-preview" />}
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => onLogo(e.target.files?.[0])} />
            {s.logoDataUrl && (
              <button type="button" className="link" onClick={() => set("logoDataUrl", "")}>
                Remove
              </button>
            )}
          </div>
        </label>
      </fieldset>

      <fieldset>
        <legend>Plans</legend>
        <label>
          Currency (symbol or code, e.g. $, €, DZD)
          <input value={s.currency} onChange={(e) => set("currency", e.target.value)} className="short" />
        </label>
        <label>
          Tooth numbering
          <select value={s.toothNumbering} onChange={(e) => set("toothNumbering", e.target.value as Settings["toothNumbering"])}>
            <option value="FDI">FDI (11–48, e.g. 36)</option>
            <option value="Universal">Universal (1–32)</option>
          </select>
        </label>
        <label>
          Dictation language
          <select value={s.dictationLanguage} onChange={(e) => set("dictationLanguage", e.target.value)}>
            {DICTATION_LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <span className="hint">
            The language you speak. The assistant answers and asks questions in it; the patient PDF stays in English.
          </span>
        </label>
        <label>
          Estimate valid for (days)
          <input
            type="number"
            min={1}
            className="short"
            value={s.validityDays}
            onChange={(e) => set("validityDays", Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <label>
          Disclaimer printed on the PDF
          <textarea rows={3} value={s.disclaimer} onChange={(e) => set("disclaimer", e.target.value)} />
        </label>
      </fieldset>
    </div>
  );
}
