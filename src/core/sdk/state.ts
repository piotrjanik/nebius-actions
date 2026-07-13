/**
 * Shared SDK status-state reader.
 *
 * SDK resources expose their state as `status.state`, an enum instance whose
 * `.name` is the status string (e.g. `RUNNING`); plain objects (tests, tolerant
 * inputs) may carry a bare string instead. Normalizes both to a string.
 */

/** Read the status string from an SDK status (enum `.name`) or a plain object. */
export function readState(status: unknown): string {
  const st = (status as { state?: unknown } | undefined)?.state;
  if (st == null) return 'UNKNOWN';
  if (typeof st === 'string') return st;
  const name = (st as { name?: unknown }).name;
  if (typeof name === 'string') return name;
  return String(st);
}
