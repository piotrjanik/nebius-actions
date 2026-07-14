import { describe, it, expect } from 'vitest';
import { parseMountParts } from '../../src/core/sdk/mount';

describe('parseMountParts', () => {
  it('defaults to rw when no mode is given', () => {
    expect(parseMountParts('bucket-1:/data')).toEqual({
      source: 'bucket-1',
      containerPath: '/data',
      mode: 'rw',
    });
  });

  it('parses an explicit ro mode case-insensitively', () => {
    expect(parseMountParts('bucket-1:/data:RO')).toEqual({
      source: 'bucket-1',
      containerPath: '/data',
      mode: 'ro',
    });
  });

  it.each(['', 'bucket-only', ':/data', 'bucket:'])('rejects malformed mount %j', (m) => {
    expect(() => parseMountParts(m)).toThrow(/malformed mount/);
  });
});
