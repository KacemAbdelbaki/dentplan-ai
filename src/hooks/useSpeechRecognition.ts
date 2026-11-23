import { useCallback, useEffect, useRef, useState } from "react";

// Minimal typings for the (non-standard) Web Speech API.
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function getRecognitionCtor(): (new () => Recognition) | null {
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow the microphone in the browser's address bar and try again.",
  "service-not-allowed": "Speech recognition is not allowed in this browser. Use Chrome or Edge.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs an internet connection.",
};

/**
 * Continuous dictation. Final phrases are passed to `onFinal`; the in-progress phrase is
 * exposed as `interim`. Chrome stops recognition after a pause, so we restart it
 * automatically while the user still wants to listen.
 */
export function useSpeechRecognition(onFinal: (text: string) => void, lang = "en-US") {
  const Ctor = typeof window !== "undefined" ? getRecognitionCtor() : null;
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  onFinalRef.current = onFinal;

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    setError(null);
    wantRef.current = true;
    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript;
        if (r.isFinal) onFinalRef.current(text.trim());
        else interimText += text;
      }
      setInterim(interimText);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // harmless; onend restarts
      setError(ERRORS[e.error] ?? `Speech recognition error: ${e.error}`);
      wantRef.current = false;
    };
    rec.onend = () => {
      setInterim("");
      if (wantRef.current) {
        try {
          rec.start();
          return;
        } catch {
          /* fall through */
        }
      }
      setListening(false);
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch (err) {
      setError(String(err));
    }
  }, [Ctor, lang]);

  useEffect(() => () => {
    wantRef.current = false;
    recRef.current?.abort();
  }, []);

  return { supported: !!Ctor, listening, interim, error, start, stop };
}
