import { useEffect, useLayoutEffect, useRef } from "react";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";

interface Props {
  draft: string;
  setDraft: (updater: (prev: string) => string) => void;
  onSend: () => void;
  busy: boolean;
  placeholder?: string;
  /** BCP-47 dictation language, e.g. "en-US". */
  lang: string;
}

export function DictationBar({ draft, setDraft, onSend, busy, placeholder, lang }: Props) {
  const speech = useSpeechRecognition((text) => {
    if (!text) return;
    setDraft((prev) => (prev && !/\s$/.test(prev) ? `${prev} ${text}` : prev + text));
  }, lang || "en-US");
  const textRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const interim = speech.interim.trim();
  const sep = draft && !/\s$/.test(draft) ? " " : "";

  // The words still being recognised are drawn in a copy of the text that sits behind the
  // textarea, so they appear in grey exactly where they will land. Grow the box to fit.
  useLayoutEffect(() => {
    const ta = textRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    ta.style.height = "";
    const base = ta.offsetHeight;
    ta.style.height = `${Math.min(Math.max(base, mirror.scrollHeight + 2), 220)}px`;
    if (interim) ta.scrollTop = ta.scrollHeight;
    mirror.scrollTop = ta.scrollTop;
  }, [draft, interim]);

  // Stop listening while the agent works, so nothing is lost or sent twice.
  useEffect(() => {
    if (busy && speech.listening) speech.stop();
  }, [busy, speech]);

  const send = () => {
    if (speech.listening) speech.stop();
    onSend();
  };

  return (
    <div className={`dictation ${speech.listening ? "listening" : ""}`}>
      <div className="dictation-row">
        <button
          type="button"
          className={`mic ${speech.listening ? "on" : ""}`}
          onClick={speech.listening ? speech.stop : speech.start}
          disabled={!speech.supported || busy}
          title={speech.supported ? (speech.listening ? "Stop dictating" : "Start dictating") : "Voice needs Chrome or Edge"}
          aria-pressed={speech.listening}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
            />
          </svg>
          <span>{speech.listening ? "Listening…" : "Dictate"}</span>
        </button>
        <div className="draft-wrap">
          <div className="draft-mirror" ref={mirrorRef} aria-hidden="true">
            {draft}
            {interim && (
              <span className="draft-interim">
                {sep}
                {interim}
              </span>
            )}
            {"\u200b"}
          </div>
          <textarea
            ref={textRef}
            onScroll={(e) => {
              if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            value={draft}
            onChange={(e) => setDraft(() => e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!busy && draft.trim()) send();
              }
            }}
            placeholder={placeholder}
            rows={2}
            disabled={busy}
          />
        </div>
        <button type="button" className="primary send" onClick={send} disabled={busy || !draft.trim()}>
          {busy ? <span className="spinner" /> : "Send"}
        </button>
      </div>
      <div className="dictation-hint">
        {speech.error ? (
          <span className="error-text">{speech.error}</span>
        ) : !speech.supported ? (
          <span className="error-text">Voice dictation needs Chrome or Edge. You can still type.</span>
        ) : (
          <span>Speak naturally — you can correct the text before sending. Ctrl+Enter sends.</span>
        )}
      </div>
    </div>
  );
}
