import { describe, it, expect } from 'vitest';
import { DiskSpec_DiskType } from '@nebius/js-sdk/api/nebius/compute/v1/index';
import { resolveDiskType } from '../../src/core/sdk/disk';

describe('resolveDiskType', () => {
  it('maps known keys to SDK enum members', () => {
    expect(resolveDiskType('network-ssd')).toBe(DiskSpec_DiskType.NETWORK_SSD);
    expect(resolveDiskType('network-hdd')).toBe(DiskSpec_DiskType.NETWORK_HDD);
    expect(resolveDiskType('network-ssd-io-m3')).toBe(DiskSpec_DiskType.NETWORK_SSD_IO_M3);
  });

  it('defaults to network-ssd when the key is undefined', () => {
    expect(resolveDiskType()).toBe(DiskSpec_DiskType.NETWORK_SSD);
  });

  it('is case-insensitive', () => {
    expect(resolveDiskType('Network-SSD')).toBe(DiskSpec_DiskType.NETWORK_SSD);
  });

  it('throws on an unknown disk type', () => {
    expect(() => resolveDiskType('nvme')).toThrow(/disk type/i);
  });
});
