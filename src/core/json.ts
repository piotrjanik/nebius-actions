/**
 * Small, dependency-free helpers for safely reading values out of the
 * loosely-typed JSON the `nebius` CLI emits. Shared by the jobs and endpoints
 * mappers so the field-probing logic lives in exactly one place.
 */

/** Read a dot-notation path from an unknown object (safe; returns undefined). */
export function readPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * First defined, non-empty string among the given candidate field paths.
 * Numbers are coerced to strings so numeric ids/ports are accepted.
 */
export function firstString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = readPath(obj, k);
    if (typeof v === 'string' && v !== '') {
      return v;
    }
    if (typeof v === 'number') {
      return String(v);
    }
  }
  return undefined;
}
