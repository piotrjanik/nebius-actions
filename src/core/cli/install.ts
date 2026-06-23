/**
 * Install + cache the `nebius` CLI for CI.
 *
 * The official install mechanism is a curl|bash script (CONFIRMED 2026-06-22):
 *   curl -sSL https://storage.eu-north1.nebius.cloud/cli/install.sh | bash
 * which drops the binary under `~/.nebius/bin`. We run it, then register the
 * resulting binary with `@actions/tool-cache` so repeat runs are ~instant and
 * the directory is added to PATH.
 *
 * // VERIFY: the install script does not expose a documented "specific version"
 * flag. We pass the requested version via the NEBIUS_CLI_VERSION env hint and
 * cache under that version key; for `latest` the cache is keyed by the resolved
 * `nebius version` string. If/when a version flag is documented, only this file
 * changes.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import { CLI_BINARY_NAME, CLI_INSTALL_SCRIPT_URL, CLI_TOOL_CACHE_NAME } from '../constants';

/** Default install directory used by the Nebius install script. */
function defaultInstallDir(): string {
  return path.join(os.homedir(), '.nebius', 'bin');
}

/** Query the installed CLI's version string (best-effort; trimmed). */
async function resolveInstalledVersion(binDir: string): Promise<string> {
  try {
    const res = await exec.getExecOutput(path.join(binDir, CLI_BINARY_NAME), ['version'], {
      silent: true,
      ignoreReturnCode: true,
    });
    const out = `${res.stdout}\n${res.stderr}`.trim();
    return out.split(/\s+/).pop() ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find an already-installed `nebius` binary on `PATH` and return its directory,
 * or `undefined` if not found. The `setup` action installs the CLI and calls
 * `core.addPath`, which makes it resolvable in subsequent steps' `PATH`; this
 * lets later resource actions skip a redundant reinstall.
 */
async function findCliOnPath(): Promise<string | undefined> {
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    if (await fileExists(path.join(dir, CLI_BINARY_NAME))) {
      return dir;
    }
  }
  return undefined;
}

/**
 * Ensure the `nebius` CLI is installed and on PATH.
 *
 * @param opts.version requested version; `latest` (or empty) installs newest.
 * @returns absolute path to the directory containing the `nebius` binary.
 * @throws when the install script fails or the binary is not produced.
 */
export async function ensureCli(opts: {
  version: string;
  /** Detector for an already-installed CLI dir; injectable for tests. */
  findExisting?: () => Promise<string | undefined>;
}): Promise<string> {
  const requested = opts.version?.trim() || 'latest';

  if (requested !== 'latest') {
    // Pinned version: the tool-cache is authoritative — prefer it over whatever
    // happens to be ambiently on PATH (which may be a different version).
    const cached = tc.find(CLI_TOOL_CACHE_NAME, requested);
    if (cached) {
      core.addPath(cached);
      core.debug(`nebius CLI cache hit (${requested}) at ${cached}`);
      return cached;
    }
  } else {
    // `latest`: if a `nebius` is already on PATH (e.g. installed by the `setup`
    // action earlier in the job), reuse it instead of reinstalling per step.
    const existing = await (opts.findExisting ?? findCliOnPath)();
    if (existing) {
      core.debug(`nebius CLI already on PATH at ${existing}; skipping install.`);
      return existing;
    }
  }

  // Install via the official curl|bash script.
  core.debug(`Installing nebius CLI (${requested}) via ${CLI_INSTALL_SCRIPT_URL}`);
  const installCmd = `curl -sSL ${CLI_INSTALL_SCRIPT_URL} | bash`;
  const res = await exec.getExecOutput('bash', ['-c', installCmd], {
    ignoreReturnCode: true,
    env: {
      ...process.env,
      // VERIFY: surfaced as a hint in case the script honors it for pinning.
      NEBIUS_CLI_VERSION: requested === 'latest' ? '' : requested,
    } as Record<string, string>,
  });
  if (res.exitCode !== 0) {
    throw new Error(
      `nebius CLI install script failed (exit ${res.exitCode}). stderr: ${res.stderr.trim()}`,
    );
  }

  const binDir = defaultInstallDir();
  if (!(await fileExists(path.join(binDir, CLI_BINARY_NAME)))) {
    throw new Error(
      `nebius CLI install completed but binary not found at ${binDir}/${CLI_BINARY_NAME}.`,
    );
  }

  // Cache the install dir under the resolved version so future runs are instant.
  const resolvedVersion =
    requested === 'latest' ? await resolveInstalledVersion(binDir) : requested;
  const cachedDir = await tc.cacheDir(binDir, CLI_TOOL_CACHE_NAME, resolvedVersion);
  core.addPath(cachedDir);
  core.debug(`nebius CLI installed (${resolvedVersion}) and cached at ${cachedDir}`);
  return cachedDir;
}
