import type { ConversationEntry, Question } from "../../shared/schema";

interface Props {
  conversation: ConversationEntry[];
  questions: Question[];
  answered: Record<string, string>;
  onAnswer: (q: Question, answer: string) => void;
  busy: boolean;
}

export function QuestionsPanel({ conversation, questions, answered, onAnswer, busy }: Props) {
  const lastAgent = [...conversation].reverse().find((c) => c.role === "agent");
  const lastMessage = lastAgent?.text.split("\nQuestions I asked:")[0];

  return (
    <section className="panel questions">
      <h2>Assistant</h2>
      {busy && (
        <div className="agent-msg thinking">
          <span className="spinner dark" /> Updating the plan…
        </div>
      )}
      {!busy && lastMessage && <div className="agent-msg">{lastMessage}</div>}
      {!busy && !lastMessage && (
        <div className="agent-msg muted">
          Dictate the treatment plan: procedures, teeth, order, timing and any prices that differ from your price list.
          I'll build the stages and ask about anything unclear.
        </div>
      )}

      {questions.length > 0 && (
        <>
          <h3>Questions ({questions.length})</h3>
          <ol className="question-list">
            {questions.map((q) => (
              <li key={q.id} className={answered[q.id] ? "answered" : ""}>
                <div className="q-text">{q.question}</div>
                {q.reason && <div className="q-reason">{q.reason}</div>}
                {q.suggestedAnswers.length > 0 && (
                  <div className="chips">
                    {q.suggestedAnswers.map((a) => (
                      <button
                        key={a}
                        type="button"
                        className={`chip ${answered[q.id] === a ? "selected" : ""}`}
                        onClick={() => onAnswer(q, a)}
                        disabled={busy}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="hint">Click an answer or dictate your answers, then press Send.</p>
        </>
      )}
      {!busy && conversation.length > 0 && questions.length === 0 && (
        <div className="all-clear">✓ No open questions. Review the plan and create the PDF.</div>
      )}

      {conversation.length > 0 && (
        <details className="history">
          <summary>Conversation ({Math.ceil(conversation.length / 2)} {Math.ceil(conversation.length / 2) === 1 ? "turn" : "turns"})</summary>
          {conversation.map((c, i) => (
            <div key={i} className={`hist ${c.role}`}>
              <strong>{c.role === "dentist" ? "You" : "Assistant"}:</strong> <span>{c.text}</span>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
