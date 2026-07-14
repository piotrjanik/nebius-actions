/**
 * Mount-string parsing shared by the job and endpoint spec builders.
 *
 * Both SDK specs model a bucket mount identically (`source`, `containerPath`,
 * `mode`) but with their OWN mode enums, so this helper stays domain-agnostic
 * and returns the mode as a key each caller maps onto its own enum.
 */

/** Parse `<source>:/path[:rw|ro]`. `source` is a bucket id (or an S3 URI). */
export function parseMountParts(m: string): {
  source: string;
  containerPath: string;
  mode: 'ro' | 'rw';
} {
  const parts = m.split(':');
  if (parts.length < 2 || !parts[0] || !parts[1]) {
    throw new Error(`parseMountParts: malformed mount '${m}' (expected <source>:/path[:rw|ro]).`);
  }
  const [source, containerPath, modeRaw] = parts;
  return {
    source: source!,
    containerPath: containerPath!,
    mode: (modeRaw ?? 'rw').toLowerCase() === 'ro' ? 'ro' : 'rw',
  };
}
