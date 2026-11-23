/**
 * Runs the same job against several candidates (here: AI models) so that one slow or
 * overloaded candidate does not stall the caller:
 *  - starts with the first candidate
 *  - if it fails with a "soft" error, the next one starts immediately
 *  - if it has not answered after `hedgeDelayMs`, the next one starts in parallel
 *  - the first success wins and everything else is aborted
 *  - when every candidate has failed, the list is tried again (up to `rounds` times in total),
 *    after a pause that grows with each round
 *  - a "hard" error (not specific to one candidate) or the overall budget ends the race
 */
export interface HedgeOptions<T> {
  candidates: string[];
  run: (candidate: string, signal: AbortSignal) => Promise<T>;
  /** true: this candidate failed, try another. false: fail the whole race with this error. */
  isSoftFailure: (err: unknown) => boolean;
  hedgeDelayMs: number;
  budgetMs: number;
  rounds?: number;
  retryPauseMs?: number;
  onFailure?: (candidate: string, err: unknown, elapsedMs: number) => void;
}

export class HedgeTimeoutError extends Error {
  constructor() {
    super("No candidate answered within the time budget");
    this.name = "HedgeTimeoutError";
  }
}

export function hedgedRace<T>(opts: HedgeOptions<T>): Promise<{ value: T; candidate: string }> {
  const { candidates, run, isSoftFailure, hedgeDelayMs, budgetMs, rounds = 6, retryPauseMs = 2000 } = opts;

  return new Promise((resolve, reject) => {
    const order = Array.from({ length: rounds }, () => candidates).flat();
    const inFlight = new Map<string, AbortController>();
    let next = 0;
    let done = false;
    let lastError: unknown = null;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
    let pauseTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (settle: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(hedgeTimer);
      clearTimeout(pauseTimer);
      clearTimeout(budgetTimer);
      for (const c of inFlight.values()) c.abort();
      settle();
    };

    const budgetTimer = setTimeout(() => finish(() => reject(lastError ?? new HedgeTimeoutError())), budgetMs);

    const launch = () => {
      if (done) return;
      clearTimeout(hedgeTimer);
      while (next < order.length && inFlight.has(order[next])) next++; // already running: skip
      if (next >= order.length) {
        if (inFlight.size === 0) finish(() => reject(lastError ?? new Error("No candidates to try")));
        return; // otherwise wait for the ones still running (the budget bounds this)
      }
      const candidate = order[next++];
      const controller = new AbortController();
      const started = Date.now();
      inFlight.set(candidate, controller);
      hedgeTimer = setTimeout(launch, hedgeDelayMs);

      run(candidate, controller.signal).then(
        (value) => {
          inFlight.delete(candidate); // the winner is finished: only abort the others
          finish(() => resolve({ value, candidate }));
        },
        (err) => {
          if (done) return;
          inFlight.delete(candidate);
          opts.onFailure?.(candidate, err, Date.now() - started);
          if (!isSoftFailure(err)) return finish(() => reject(err));
          lastError = err;
          // Next candidate right away. When starting over with the same list, pause first,
          // longer each round (2 s, 4 s, 6 s, …) to give an overloaded service time to recover.
          const startingOver = next >= candidates.length && next < order.length && next % candidates.length === 0;
          const pause = startingOver ? retryPauseMs * (next / candidates.length) : 0;
          clearTimeout(pauseTimer);
          pauseTimer = setTimeout(launch, pause);
        },
      );
    };

    if (candidates.length === 0) return finish(() => reject(new Error("No candidates to try")));
    launch();
  });
}
