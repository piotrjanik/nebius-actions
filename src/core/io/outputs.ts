/**
 * GitHub Actions output + failure helpers.
 */

import * as core from '@actions/core';

/** Set an action output, stringifying scalars consistently. */
export function setOutput(name: string, value: string | number | boolean): void {
  core.setOutput(name, typeof value === 'string' ? value : String(value));
}

/** Normalize any thrown value into a human-readable message. */
export function normalizeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Fail the action with a normalized message (no silent failures; spec §7). */
export function fail(err: unknown): void {
  core.setFailed(normalizeError(err));
}
