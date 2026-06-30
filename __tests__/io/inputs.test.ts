/**
 * Unit tests for typed input parsing (io/inputs.ts).
 *
 * `@actions/core` is mocked so getInput / getMultilineInput are driven from a
 * per-test in-memory map of inputs.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Backing store the mocked @actions/core reads from.
const inputs = new Map<string, string>();

vi.mock('@actions/core', () => ({
  // core.getInput trims by default; our wrappers rely on that.
  getInput: (name: string) => (inputs.get(name) ?? '').trim(),
  // core.getMultilineInput splits on newlines, dropping the trailing empty entry.
  getMultilineInput: (name: string) => {
    const raw = inputs.get(name) ?? '';
    if (raw === '') return [];
    return raw.split('\n').filter((line, i, arr) => !(i === arr.length - 1 && line === ''));
  },
}));

import {
  getString,
  getStringOrEnv,
  getBool,
  getNumber,
  getMultiline,
  getKeyValues,
} from '../../src/core/io/inputs';

function setInput(name: string, value: string): void {
  inputs.set(name, value);
}

beforeEach(() => {
  inputs.clear();
});

describe('getString', () => {
  it('returns the provided value', () => {
    setInput('name', 'my-job');
    expect(getString('name')).toBe('my-job');
  });

  it('returns the default when empty', () => {
    expect(getString('region', { default: 'eu' })).toBe('eu');
  });

  it('returns "" when empty, not required, no default', () => {
    expect(getString('opt')).toBe('');
  });

  it('throws when required and missing', () => {
    expect(() => getString('image', { required: true })).toThrow(/required/);
  });

  it('a present value beats both default and required', () => {
    setInput('image', 'ubuntu');
    expect(getString('image', { required: true, default: 'fallback' })).toBe('ubuntu');
  });
});

describe('getStringOrEnv', () => {
  const ENV = 'NEBIUS_TEST_FALLBACK';

  beforeEach(() => {
    delete process.env[ENV];
  });

  it('prefers the input over the env var', () => {
    setInput('project-id', 'from-input');
    process.env[ENV] = 'from-env';
    expect(getStringOrEnv('project-id', ENV)).toBe('from-input');
  });

  it('falls back to the env var when the input is empty', () => {
    process.env[ENV] = 'from-env';
    expect(getStringOrEnv('project-id', ENV)).toBe('from-env');
  });

  it('trims the env var value', () => {
    process.env[ENV] = '  spaced  ';
    expect(getStringOrEnv('project-id', ENV)).toBe('spaced');
  });

  it('uses the default when both input and env are empty', () => {
    expect(getStringOrEnv('project-id', ENV, { default: 'fallback' })).toBe('fallback');
  });

  it('returns "" when empty, not required, no default', () => {
    expect(getStringOrEnv('project-id', ENV)).toBe('');
  });

  it('throws (naming both the input and the env var) when required and both missing', () => {
    expect(() => getStringOrEnv('project-id', ENV, { required: true })).toThrow(/project-id/);
    expect(() => getStringOrEnv('project-id', ENV, { required: true })).toThrow(ENV);
  });

  it('an empty-string env var does not satisfy required', () => {
    process.env[ENV] = '   ';
    expect(() => getStringOrEnv('project-id', ENV, { required: true })).toThrow(/required/);
  });
});

describe('getBool', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['Yes', true],
    ['1', true],
    ['on', true],
    ['false', false],
    ['No', false],
    ['0', false],
    ['off', false],
  ])('parses %s -> %s', (raw, expected) => {
    setInput('wait', raw);
    expect(getBool('wait')).toBe(expected);
  });

  it('returns the default when empty', () => {
    expect(getBool('wait', { default: true })).toBe(true);
  });

  it('defaults to false when empty and no default', () => {
    expect(getBool('wait')).toBe(false);
  });

  it('throws on an unrecognized value', () => {
    setInput('wait', 'maybe');
    expect(() => getBool('wait')).toThrow(/boolean/);
  });
});

describe('getNumber', () => {
  it('parses an integer', () => {
    setInput('poll-interval', '10');
    expect(getNumber('poll-interval')).toBe(10);
  });

  it('parses a float', () => {
    setInput('factor', '1.5');
    expect(getNumber('factor')).toBe(1.5);
  });

  it('returns the default when empty', () => {
    expect(getNumber('poll-interval', { default: 30 })).toBe(30);
  });

  it('throws when empty and no default (required-missing)', () => {
    expect(() => getNumber('poll-interval')).toThrow(/required/);
  });

  it('throws on a non-numeric value', () => {
    setInput('poll-interval', 'soon');
    expect(() => getNumber('poll-interval')).toThrow(/number/);
  });
});

describe('getMultiline', () => {
  it('returns trimmed, non-empty lines', () => {
    setInput('mounts', '  /a:/a  \n\n /b:/b \n');
    expect(getMultiline('mounts')).toEqual(['/a:/a', '/b:/b']);
  });

  it('returns [] for an empty input', () => {
    expect(getMultiline('mounts')).toEqual([]);
  });
});

describe('getKeyValues', () => {
  it('parses KEY=VALUE pairs per line', () => {
    setInput('env', 'A=1\nB=two');
    expect(getKeyValues('env')).toEqual({ A: '1', B: 'two' });
  });

  it('splits on the first = only (values may contain =)', () => {
    setInput('env', 'URL=https://x?a=b&c=d');
    expect(getKeyValues('env')).toEqual({ URL: 'https://x?a=b&c=d' });
  });

  it('allows empty values (KEY=)', () => {
    setInput('env', 'EMPTY=');
    expect(getKeyValues('env')).toEqual({ EMPTY: '' });
  });

  it('ignores blank lines and #-comments', () => {
    setInput('env', '# comment\n\nA=1\n  # indented comment\nB=2');
    expect(getKeyValues('env')).toEqual({ A: '1', B: '2' });
  });

  it('trims surrounding whitespace on keys and values', () => {
    setInput('env', '  A  =  1  ');
    expect(getKeyValues('env')).toEqual({ A: '1' });
  });

  it('returns {} for an empty input', () => {
    expect(getKeyValues('env')).toEqual({});
  });

  it('throws on a line without =', () => {
    setInput('env', 'NOPE');
    expect(() => getKeyValues('env')).toThrow(/KEY=VALUE/);
  });

  it('throws on an empty key', () => {
    setInput('env', '=value');
    expect(() => getKeyValues('env')).toThrow(/empty key/);
  });
});
