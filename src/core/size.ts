/**
 * Parse a binary size string (Ki/Mi/Gi/Ti) or a plain byte count into bytes.
 *
 * Used to map the `disk-size` action input (e.g. `250Gi`) onto the SDK
 * `JobSpec.disk.sizeBytes` field. Binary units only (1Ki = 1024), matching how
 * Nebius disk sizes are expressed. Throws on anything it cannot parse — no
 * silent default.
 */
const UNITS: Record<string, number> = {
  '': 1,
  ki: 1024,
  mi: 1024 ** 2,
  gi: 1024 ** 3,
  ti: 1024 ** 4,
};

export function parseSizeBytes(input: string): number {
  const raw = (input ?? '').trim();
  if (raw === '') {
    throw new Error('parseSizeBytes: size is required.');
  }
  const m = /^(\d+)\s*(Ki|Mi|Gi|Ti)?$/i.exec(raw);
  if (!m) {
    throw new Error(`parseSizeBytes: unparseable size '${input}'.`);
  }
  const value = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  const factor = UNITS[unit];
  if (factor === undefined) {
    // Unreachable: the regex only matches the known unit suffixes. Guarded
    // explicitly so the lookup is type-safe without a silent fallback.
    throw new Error(`parseSizeBytes: unparseable size '${input}'.`);
  }
  return value * factor;
}
