/**
 * Shared mapping from the `disk-type` input key onto the SDK disk-type enum.
 * Used by both the jobs and endpoints spec builders so the accepted keys and
 * the default live in one place. The enum is `nebius.compute.v1.DiskSpec.DiskType`;
 * both `JobSpec.disk` and `EndpointSpec.disk` reference it.
 */
import { DiskSpec_DiskType } from '@nebius/js-sdk/api/nebius/compute/v1/index';

/** Accepted `disk-type` input keys mapped to the SDK enum. */
export const DISK_TYPES: Record<string, DiskSpec_DiskType> = {
  'network-ssd': DiskSpec_DiskType.NETWORK_SSD,
  'network-hdd': DiskSpec_DiskType.NETWORK_HDD,
  'network-ssd-non-replicated': DiskSpec_DiskType.NETWORK_SSD_NON_REPLICATED,
  'network-ssd-io-m3': DiskSpec_DiskType.NETWORK_SSD_IO_M3,
};

/**
 * Resolve a `disk-type` input key to the SDK enum, defaulting to `network-ssd`.
 * @throws when the key is non-empty but unrecognized.
 */
export function resolveDiskType(typeKey?: string): DiskSpec_DiskType {
  const key = (typeKey ?? 'network-ssd').toLowerCase();
  const type = DISK_TYPES[key];
  if (type === undefined) {
    throw new Error(`resolveDiskType: unknown disk type '${typeKey}'.`);
  }
  return type;
}
