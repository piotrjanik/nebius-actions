/**
 * Generic polling loop with exponential backoff and an overall timeout.
 *
 * Designed to be deterministic and unit-testable:
 *   - the wait primitive is injectable (`sleep`), so tests use fake timers,
 *   - the clock is injectable (`now`), so timeout logic is testable,
 *   - backoff is a pure function (`nextInterval`).
 *
 * The first `fn()` is evaluated immediately; if non-terminal, it sleeps then
 * re-evaluates, growing the interval geometrically up to `maxIntervalMs`.
 */

import {
  DEFAULT_MAX_POLL_INTERVAL_MS,
  DEFAULT_POLL_BACKOFF_FACTOR,
  MIN_POLL_INTERVAL_MS,
} from '../constants';

export interface PollOptions<T> {
  fn: () => Promise<T>;
  isTerminal: (v: T) => boolean;
  timeoutMs: number;
  intervalMs: number;
  /** Exponential-backoff cap (default 30s). */
  maxIntervalMs?: number;
  /** Progress / log-streaming hook called after every evaluation. */
  onTick?: (v: T) => void;
  /** Backoff growth factor (default 1.5). Mainly an injection point for tests. */
  backoffFactor?: number;
  /** Injectable sleep (ms). Defaults to setTimeout-based wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock. Defaults to Date.now. */
  now?: () => number;
}

export interface PollResult<T> {
  value: T;
  timedOut: boolean;
}

/** Default sleep: a cancel-free setTimeout wrapper. */
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute the next poll interval (pure).
 * Grows `current` by `factor`, capped at `max`, floored at 0.
 */
export function nextInterval(current: number, factor: number, max: number): number {
  const grown = Math.ceil(Math.max(0, current) * factor);
  return Math.min(grown, max);
}

/**
 * Poll `fn` until `isTerminal` is true or `timeoutMs` elapses.
 *
 * @returns `{ value, timedOut }` — the last observed value and whether the loop
 *          ended due to timeout. Never throws on timeout (callers decide).
 *          Exceptions from `fn` propagate (no silent failures).
 */
export async function pollUntil<T>(o: PollOptions<T>): Promise<PollResult<T>> {
  const maxInterval = o.maxIntervalMs ?? DEFAULT_MAX_POLL_INTERVAL_MS;
  const factor = o.backoffFactor ?? DEFAULT_POLL_BACKOFF_FACTOR;
  const sleep = o.sleep ?? defaultSleep;
  const now = o.now ?? Date.now;

  const start = now();
  // Floor a non-positive interval so geometric growth can never stay at 0 and
  // busy-loop the API (see MIN_POLL_INTERVAL_MS).
  let interval = o.intervalMs > 0 ? o.intervalMs : MIN_POLL_INTERVAL_MS;

  // First evaluation is immediate.
  let value = await o.fn();
  o.onTick?.(value);
  if (o.isTerminal(value)) {
    return { value, timedOut: false };
  }

  for (;;) {
    const elapsed = now() - start;
    const remaining = o.timeoutMs - elapsed;
    if (remaining <= 0) {
      return { value, timedOut: true };
    }

    // Never sleep past the deadline.
    await sleep(Math.min(interval, remaining));

    value = await o.fn();
    o.onTick?.(value);
    if (o.isTerminal(value)) {
      return { value, timedOut: false };
    }

    interval = nextInterval(interval, factor, maxInterval);
  }
}
