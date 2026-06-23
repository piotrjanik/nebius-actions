/**
 * Logging + secret-masking helpers over `@actions/core`.
 */

import * as core from '@actions/core';

export const log = {
  info(m: string): void {
    core.info(m);
  },
  debug(m: string): void {
    core.debug(m);
  },
  warn(m: string): void {
    core.warning(m);
  },
  error(m: string): void {
    core.error(m);
  },
  /**
   * Run `fn` inside a collapsible log group. The group is always closed, even
   * if `fn` throws, so the runner's group nesting never leaks.
   */
  group<T>(name: string, fn: () => Promise<T>): Promise<T> {
    return core.group(name, fn);
  },
} as const;

/** Register a secret so the runner masks it in all subsequent logs. */
export function mask(secret: string): void {
  if (secret) {
    core.setSecret(secret);
  }
}
