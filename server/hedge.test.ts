import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hedgedRace, HedgeTimeoutError } from "./hedge";

class Soft extends Error {}
class Hard extends Error {}
const isSoftFailure = (e: unknown) => e instanceof Soft;

/** A fake job: resolves or rejects after `ms`, and rejects early if aborted. */
function job(ms: number, outcome: "ok" | Error, log: string[], name: string) {
  return (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      log.push(`start ${name}`);
      const t = setTimeout(() => (outcome === "ok" ? resolve(name) : reject(outcome)), ms);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        log.push(`abort ${name}`);
        reject(new Error("aborted"));
      });
    });
}

describe("hedgedRace", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const base = { isSoftFailure, hedgeDelayMs: 20_000, budgetMs: 120_000, retryPauseMs: 2000 };

  it("returns the first candidate when it answers in time, without starting others", async () => {
    const log: string[] = [];
    const jobs: Record<string, (s: AbortSignal) => Promise<string>> = { a: job(5000, "ok", log, "a"), b: job(1000, "ok", log, "b") };
    const p = hedgedRace({ ...base, candidates: ["a", "b"], run: (c, s) => jobs[c](s) });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ value: "a", candidate: "a" });
    expect(log).toEqual(["start a"]);
  });

  it("moves to the next candidate immediately after a soft failure", async () => {
    const log: string[] = [];
    const jobs: Record<string, (s: AbortSignal) => Promise<string>> = { a: job(2000, new Soft("503"), log, "a"), b: job(3000, "ok", log, "b") };
    const p = hedgedRace({ ...base, candidates: ["a", "b"], run: (c, s) => jobs[c](s) });
    await vi.advanceTimersByTimeAsync(4000);
    expect(log).toEqual(["start a", "start b"]); // b started right after a failed at 2 s, not at the 20 s hedge
    await vi.advanceTimersByTimeAsync(1100);
    await expect(p).resolves.toEqual({ value: "b", candidate: "b" });
  });

  it("starts the next candidate in parallel when the first is slow, and aborts the loser", async () => {
    const log: string[] = [];
    const jobs: Record<string, (s: AbortSignal) => Promise<string>> = { a: job(90_000, "ok", log, "a"), b: job(8000, "ok", log, "b") };
    const p = hedgedRace({ ...base, candidates: ["a", "b"], run: (c, s) => jobs[c](s) });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(log).toEqual(["start a"]);
    await vi.advanceTimersByTimeAsync(8001);
    await expect(p).resolves.toEqual({ value: "b", candidate: "b" });
    expect(log).toEqual(["start a", "start b", "abort a"]);
  });

  it("lets a slow first candidate still win if it finishes before the hedge", async () => {
    const log: string[] = [];
    const jobs: Record<string, (s: AbortSignal) => Promise<string>> = { a: job(25_000, "ok", log, "a"), b: job(30_000, "ok", log, "b") };
    const p = hedgedRace({ ...base, candidates: ["a", "b"], run: (c, s) => jobs[c](s) });
    await vi.advanceTimersByTimeAsync(25_000);
    await expect(p).resolves.toEqual({ value: "a", candidate: "a" });
    expect(log).toEqual(["start a", "start b", "abort b"]);
  });

  it("tries the list again after a pause when every candidate fails fast", async () => {
    const log: string[] = [];
    let calls = 0;
    const run = (c: string, s: AbortSignal) => {
      calls++;
      // first round: both overloaded; second round: "a" works
      return job(1000, calls <= 2 ? new Soft("503") : "ok", log, c)(s);
    };
    const p = hedgedRace({ ...base, candidates: ["a", "b"], run });
    await vi.advanceTimersByTimeAsync(2100);
    expect(log).toEqual(["start a", "start b"]); // both failed; pausing before the second round
    await vi.advanceTimersByTimeAsync(2000 + 1000);
    await expect(p).resolves.toEqual({ value: "a", candidate: "a" });
    expect(log).toEqual(["start a", "start b", "start a"]);
  });

  it("rejects with the last soft error when all rounds fail", async () => {
    const log: string[] = [];
    const p = hedgedRace({ ...base, candidates: ["a", "b"], rounds: 2, run: (c, s) => job(500, new Soft(`503 ${c}`), log, c)(s) });
    const settled = expect(p).rejects.toThrow("503 b");
    await vi.advanceTimersByTimeAsync(10_000);
    await settled;
    expect(log.filter((l) => l.startsWith("start"))).toHaveLength(4);
  });

  it("stops at once on a hard error and aborts the rest", async () => {
    const log: string[] = [];
    const jobs: Record<string, (s: AbortSignal) => Promise<string>> = { a: job(30_000, "ok", log, "a"), b: job(1000, new Hard("bad key"), log, "b") };
    const p = hedgedRace({ ...base, candidates: ["a", "b"], run: (c, s) => jobs[c](s) });
    const settled = expect(p).rejects.toThrow("bad key");
    await vi.advanceTimersByTimeAsync(21_000);
    await settled;
    expect(log).toEqual(["start a", "start b", "abort a"]);
  });

  it("gives up when the time budget runs out", async () => {
    const log: string[] = [];
    const p = hedgedRace({ ...base, budgetMs: 50_000, candidates: ["a", "b"], run: (c, s) => job(500_000, "ok", log, c)(s) });
    const settled = expect(p).rejects.toBeInstanceOf(HedgeTimeoutError);
    await vi.advanceTimersByTimeAsync(50_000);
    await settled;
    expect(log).toEqual(["start a", "start b", "abort a", "abort b"]);
  });
});
