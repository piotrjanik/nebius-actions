import { describe, it, expect } from 'vitest';
import { parseSizeBytes } from '../../src/core/size';

describe('parseSizeBytes', () => {
  it('parses binary suffixes (Ki/Mi/Gi/Ti)', () => {
    expect(parseSizeBytes('1Ki')).toBe(1024);
    expect(parseSizeBytes('2Mi')).toBe(2 * 1024 ** 2);
    expect(parseSizeBytes('250Gi')).toBe(250 * 1024 ** 3);
    expect(parseSizeBytes('1Ti')).toBe(1024 ** 4);
  });

  it('parses a plain byte count', () => {
    expect(parseSizeBytes('1073741824')).toBe(1073741824);
  });

  it('tolerates surrounding whitespace and is case-insensitive on the suffix', () => {
    expect(parseSizeBytes('  10gi ')).toBe(10 * 1024 ** 3);
  });

  it('throws on empty input', () => {
    expect(() => parseSizeBytes('')).toThrow(/size/i);
  });

  it('throws on an unparseable value', () => {
    expect(() => parseSizeBytes('big')).toThrow(/size/i);
    expect(() => parseSizeBytes('10Gb')).toThrow(/size/i);
  });
});
