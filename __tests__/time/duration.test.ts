import { describe, it, expect } from 'vitest';
import { parseDurationMs } from '../../src/core/time';

describe('parseDurationMs', () => {
  it('parses bare numbers as seconds', () => {
    expect(parseDurationMs('45')).toBe(45_000);
    expect(parseDurationMs('0')).toBe(0);
    expect(parseDurationMs('1.5')).toBe(1_500);
  });

  it('parses single-unit durations', () => {
    expect(parseDurationMs('90s')).toBe(90_000);
    expect(parseDurationMs('30m')).toBe(30 * 60_000);
    expect(parseDurationMs('1h')).toBe(60 * 60_000);
    expect(parseDurationMs('2d')).toBe(2 * 24 * 60 * 60_000);
  });

  it('parses compound durations', () => {
    expect(parseDurationMs('1h30m')).toBe(90 * 60_000);
    expect(parseDurationMs('1h30m15s')).toBe(90 * 60_000 + 15_000);
    expect(parseDurationMs('6h')).toBe(6 * 60 * 60_000);
  });

  it('is case-insensitive and tolerates internal whitespace', () => {
    expect(parseDurationMs('1H30M')).toBe(90 * 60_000);
    expect(parseDurationMs('1h 30m')).toBe(90 * 60_000);
  });

  it('returns undefined for empty or undefined input', () => {
    expect(parseDurationMs(undefined)).toBeUndefined();
    expect(parseDurationMs('')).toBeUndefined();
    expect(parseDurationMs('   ')).toBeUndefined();
  });

  it('returns undefined for unparseable strings', () => {
    expect(parseDurationMs('abc')).toBeUndefined();
    expect(parseDurationMs('1h?')).toBeUndefined();
    expect(parseDurationMs('1y')).toBeUndefined();
    expect(parseDurationMs('h30m')).toBeUndefined();
  });
});
