/**
 * Duration parsing for action inputs.
 *
 * Accepts either a Nebius-style compound duration string (`1h`, `30m`, `90s`,
 * `1h30m`, `2d`) or a plain number interpreted as seconds. Returns milliseconds,
 * or `undefined` when the value is empty or unparseable (callers fall back to a
 * default rather than guessing).
 */

const UNIT_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
};

const COMPOUND = /(\d+(?:\.\d+)?)\s*([dhms])/gi;

/**
 * Parse a duration string into milliseconds (pure).
 *
 * @example parseDurationMs('1h30m') // 5_400_000
 * @example parseDurationMs('45')    // 45_000  (bare number => seconds)
 * @returns milliseconds, or `undefined` if empty/unparseable.
 */
export function parseDurationMs(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return undefined;
  }

  // Bare number => seconds.
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : undefined;
  }

  // Compound units (d/h/m/s), e.g. "1h30m".
  let total = 0;
  let matched = false;
  let consumed = 0;
  for (const m of trimmed.matchAll(COMPOUND)) {
    matched = true;
    consumed += m[0].length;
    const amount = Number(m[1]);
    const unit = (m[2] ?? '').toLowerCase();
    const unitMs = UNIT_MS[unit];
    if (!Number.isFinite(amount) || unitMs === undefined) {
      return undefined;
    }
    total += amount * unitMs;
  }

  // Reject strings with stray non-duration characters (e.g. "1h?" or "abc").
  if (!matched || consumed !== trimmed.replace(/\s+/g, '').length) {
    return undefined;
  }
  return Math.round(total);
}
