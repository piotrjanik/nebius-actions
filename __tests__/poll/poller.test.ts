/**
 * Unit tests for the polling loop (poll/poller.ts).
 *
 * Determinism comes from two angles:
 *  - the pure backoff function (`nextInterval`),
 *  - the loop driven with injectable `sleep` + `now` (a manual virtual clock),
 *  - plus one fake-timers test exercising the DEFAULT setTimeout-based sleep.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { pollUntil, nextInterval } from '../../src/core/poll/poller';
import {
  DEFAULT_MAX_POLL_INTERVAL_MS,
  DEFAULT_POLL_BACKOFF_FACTOR,
} from '../../src/core/constants';

/**
 * A virtual clock: `now()` advances only when `sleep(ms)` is called. This makes
 * timeout logic fully deterministic without real time or fake timers.
 */
function virtualClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

describe('nextInterval (pure)', () => {
  it('grows current by factor', () => {
    expect(nextInterval(1000, 1.5, 30_000)).toBe(1500);
  });

  it('caps at max', () => {
    expect(nextInterval(25_000, 1.5, 30_000)).toBe(30_000);
  });

  it('never exceeds the cap on repeated growth', () => {
    let v = 1000;
    for (let i = 0; i < 50; i++) {
      v = nextInterval(v, 1.5, 30_000);
    }
    expect(v).toBe(30_000);
  });

  it('floors negative current at 0', () => {
    expect(nextInterval(-100, 1.5, 30_000)).toBe(0);
  });
});

describe('pollUntil', () => {
  it('short-circuits when the first evaluation is already terminal', async () => {
    const fn = vi.fn().mockResolvedValue('DONE');
    const clock = virtualClock();
    const res = await pollUntil({
      fn,
      isTerminal: (v) => v === 'DONE',
      timeoutMs: 10_000,
      intervalMs: 1000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(res).toEqual({ value: 'DONE', timedOut: false });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(clock.sleeps).toEqual([]); // never slept
  });

  it('polls until terminal, returning timedOut:false', async () => {
    const values = ['PENDING', 'RUNNING', 'COMPLETED'];
    const fn = vi.fn(() => Promise.resolve(values.shift()!));
    const clock = virtualClock();
    const res = await pollUntil({
      fn,
      isTerminal: (v) => v === 'COMPLETED',
      timeoutMs: 1_000_000,
      intervalMs: 1000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(res).toEqual({ value: 'COMPLETED', timedOut: false });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('grows the sleep interval geometrically, capped at maxIntervalMs', async () => {
    // Never terminal until forced out by timeout; capture the sleep durations.
    const clock = virtualClock();
    const fn = vi.fn().mockResolvedValue('RUNNING');
    await pollUntil({
      fn,
      isTerminal: () => false,
      timeoutMs: 1_000_000,
      intervalMs: 1000,
      maxIntervalMs: 5000,
      backoffFactor: 2,
      sleep: clock.sleep,
      now: clock.now,
    });
    // 1000, 2000, 4000, then capped at 5000, 5000, ...
    expect(clock.sleeps.slice(0, 5)).toEqual([1000, 2000, 4000, 5000, 5000]);
    // The cap is never exceeded.
    expect(Math.max(...clock.sleeps)).toBe(5000);
  });

  it('uses the default cap (30s) when maxIntervalMs is omitted', async () => {
    const clock = virtualClock();
    await pollUntil({
      fn: () => Promise.resolve('RUNNING'),
      isTerminal: () => false,
      timeoutMs: 1_000_000,
      intervalMs: 20_000,
      backoffFactor: DEFAULT_POLL_BACKOFF_FACTOR,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(Math.max(...clock.sleeps)).toBe(DEFAULT_MAX_POLL_INTERVAL_MS);
  });

  it('floors a non-positive interval so the loop always makes progress', async () => {
    // A 0ms interval must not produce 0ms sleeps (which, with a virtual clock,
    // never advance time and busy-loop the API). Every sleep must be > 0.
    const values = ['RUNNING', 'RUNNING', 'DONE'];
    const fn = vi.fn(() => Promise.resolve(values.shift() ?? 'DONE'));
    const clock = virtualClock();
    await pollUntil({
      fn,
      isTerminal: (v) => v === 'DONE',
      timeoutMs: 1_000_000,
      intervalMs: 0,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(clock.sleeps.length).toBeGreaterThan(0);
    expect(clock.sleeps.every((s) => s > 0)).toBe(true);
  });

  it('returns timedOut:true with the last observed value on timeout', async () => {
    const clock = virtualClock();
    const fn = vi.fn().mockResolvedValue('RUNNING');
    const res = await pollUntil({
      fn,
      isTerminal: () => false,
      timeoutMs: 2500,
      intervalMs: 1000,
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(res.timedOut).toBe(true);
    expect(res.value).toBe('RUNNING');
  });

  it('never sleeps past the deadline', async () => {
    const clock = virtualClock();
    await pollUntil({
      fn: () => Promise.resolve('RUNNING'),
      isTerminal: () => false,
      timeoutMs: 2500,
      intervalMs: 1000,
      sleep: clock.sleep,
      now: clock.now,
    });
    // total slept must not exceed the timeout
    const total = clock.sleeps.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(2500);
  });

  it('calls onTick after every evaluation, including terminal', async () => {
    const values = ['A', 'B', 'C'];
    const fn = vi.fn(() => Promise.resolve(values.shift()!));
    const ticks: string[] = [];
    const clock = virtualClock();
    await pollUntil({
      fn,
      isTerminal: (v) => v === 'C',
      timeoutMs: 1_000_000,
      intervalMs: 1,
      onTick: (v) => ticks.push(v),
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(ticks).toEqual(['A', 'B', 'C']);
  });

  it('propagates exceptions thrown by fn (no silent failure)', async () => {
    const clock = virtualClock();
    const fn = vi.fn().mockRejectedValue(new Error('cli blew up'));
    await expect(
      pollUntil({
        fn,
        isTerminal: () => false,
        timeoutMs: 1000,
        intervalMs: 10,
        sleep: clock.sleep,
        now: clock.now,
      }),
    ).rejects.toThrow(/cli blew up/);
  });

  describe('with fake timers (default setTimeout sleep)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('drives the default sleep via the timer queue to reach terminal', async () => {
      const values = ['PENDING', 'RUNNING', 'COMPLETED'];
      const fn = vi.fn(() => Promise.resolve(values.shift()!));
      const promise = pollUntil({
        fn,
        isTerminal: (v) => v === 'COMPLETED',
        timeoutMs: 1_000_000,
        intervalMs: 1000,
        // sleep + now intentionally omitted -> default setTimeout + Date.now
      });
      // Flush microtasks + advance through both backoff sleeps.
      await vi.advanceTimersByTimeAsync(5000);
      const res = await promise;
      expect(res).toEqual({ value: 'COMPLETED', timedOut: false });
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });
});
