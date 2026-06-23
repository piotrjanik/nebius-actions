/**
 * Unit tests for the CLI installer (cli/install.ts).
 *
 * The heavy I/O boundaries (@actions/exec, @actions/tool-cache, @actions/core)
 * are mocked so the test is hermetic — no network, no real install. The focus
 * here is the "already on PATH" short-circuit: when `setup` has already
 * installed + PATH-added the CLI in an earlier step, later resource actions
 * (which call `ensureCli({ version: 'latest' })`) must NOT reinstall it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const getExecOutput = vi.fn();
vi.mock('@actions/exec', () => ({
  getExecOutput: (...args: unknown[]) => getExecOutput(...args),
}));

const tcFind = vi.fn();
const tcCacheDir = vi.fn();
vi.mock('@actions/tool-cache', () => ({
  find: (...args: unknown[]) => tcFind(...args),
  cacheDir: (...args: unknown[]) => tcCacheDir(...args),
}));

vi.mock('@actions/core', () => ({
  addPath: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
}));

import { ensureCli } from '../../src/core/cli/install';

beforeEach(() => {
  getExecOutput.mockReset();
  tcFind.mockReset();
  tcCacheDir.mockReset();
});

describe('ensureCli', () => {
  it('short-circuits without installing when the CLI is already on PATH (latest)', async () => {
    const dir = await ensureCli({
      version: 'latest',
      findExisting: () => Promise.resolve('/opt/hostedtoolcache/nebius-cli/1.2.3/bin'),
    });

    expect(dir).toBe('/opt/hostedtoolcache/nebius-cli/1.2.3/bin');
    // Crucially: no install script was run.
    expect(getExecOutput).not.toHaveBeenCalled();
    expect(tcFind).not.toHaveBeenCalled();
  });

  it('does not short-circuit on PATH for a pinned version (cache/install stays authoritative)', async () => {
    // Pinned version: prefer the tool-cache, ignore whatever is ambiently on PATH.
    tcFind.mockReturnValue('/opt/hostedtoolcache/nebius-cli/9.9.9/bin');
    const findExisting = vi.fn(() => Promise.resolve('/usr/local/bin'));

    const dir = await ensureCli({ version: '9.9.9', findExisting });

    expect(findExisting).not.toHaveBeenCalled();
    expect(tcFind).toHaveBeenCalledWith('nebius-cli', '9.9.9');
    expect(dir).toBe('/opt/hostedtoolcache/nebius-cli/9.9.9/bin');
    expect(getExecOutput).not.toHaveBeenCalled();
  });
});
