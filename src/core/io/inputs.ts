/**
 * Typed GitHub Actions input parsing.
 *
 * Thin, deterministic wrappers over `@actions/core` input getters with explicit
 * defaults and validation. Pure with respect to logic (the only side effect is
 * reading process env that `@actions/core` already owns), so they are easy to
 * unit-test by stubbing `@actions/core`.
 */

import * as core from '@actions/core';

/**
 * Read a string input.
 * @throws when `required` and the input is empty.
 */
export function getString(name: string, opts?: { required?: boolean; default?: string }): string {
  const required = opts?.required ?? false;
  // Do NOT pass {required} to core.getInput: we want our own error wording and
  // the ability to fall back to a default. core trims by default.
  const raw = core.getInput(name);
  if (raw !== '') {
    return raw;
  }
  if (opts?.default !== undefined) {
    return opts.default;
  }
  if (required) {
    throw new Error(`Input '${name}' is required but was not provided.`);
  }
  return '';
}

/**
 * Read a string input, falling back to an environment variable when the input
 * is empty.
 *
 * This lets a one-time `setup` step export a job-wide default (e.g.
 * `NEBIUS_PROJECT_ID`) that every later resource action inherits, so callers
 * need not repeat `project-id` / `service-account-id` on each step. Resolution
 * order: input → env var → `default` → required-error.
 * @throws when `required` and neither the input nor the env var is set.
 */
export function getStringOrEnv(
  name: string,
  envName: string,
  opts?: { required?: boolean; default?: string },
): string {
  const raw = core.getInput(name);
  if (raw !== '') {
    return raw;
  }
  const fromEnv = (process.env[envName] ?? '').trim();
  if (fromEnv !== '') {
    return fromEnv;
  }
  if (opts?.default !== undefined) {
    return opts.default;
  }
  if (opts?.required) {
    throw new Error(
      `Input '${name}' is required (or set ${envName}, e.g. via the setup action), but neither was provided.`,
    );
  }
  return '';
}

/**
 * Read a boolean input (YAML-ish: true/false/yes/no/1/0, case-insensitive).
 * Falls back to `default` (or false) when empty.
 */
export function getBool(name: string, opts?: { default?: boolean }): boolean {
  const raw = core.getInput(name).trim();
  if (raw === '') {
    return opts?.default ?? false;
  }
  const v = raw.toLowerCase();
  if (['true', 'yes', '1', 'on'].includes(v)) {
    return true;
  }
  if (['false', 'no', '0', 'off'].includes(v)) {
    return false;
  }
  throw new Error(`Input '${name}' must be a boolean (got '${raw}').`);
}

/**
 * Read a numeric input. Falls back to `default` when empty.
 * @throws when the value is non-empty and not a finite number.
 */
export function getNumber(name: string, opts?: { default?: number }): number {
  const raw = core.getInput(name).trim();
  if (raw === '') {
    if (opts?.default !== undefined) {
      return opts.default;
    }
    throw new Error(`Input '${name}' is required but was not provided.`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Input '${name}' must be a number (got '${raw}').`);
  }
  return n;
}

/** Read a multiline input as an array of non-empty, trimmed lines. */
export function getMultiline(name: string): string[] {
  return core
    .getMultilineInput(name)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/**
 * Parse a multiline `KEY=VALUE` input into a record.
 *
 * - One pair per line; blank lines and `#`-prefixed comment lines are ignored.
 * - Splits on the FIRST `=` only, so values may contain `=`.
 * - The key must be non-empty; the value may be empty (`KEY=`).
 * @throws on a line without `=` or with an empty key.
 */
export function getKeyValues(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of core.getMultilineInput(name)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      throw new Error(`Input '${name}' line is not KEY=VALUE: '${trimmed}'.`);
    }
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key === '') {
      throw new Error(`Input '${name}' has an empty key: '${trimmed}'.`);
    }
    out[key] = value;
  }
  return out;
}
