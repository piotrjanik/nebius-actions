/**
 * Run the `nebius` CLI and capture stdout/stderr.
 *
 * - `json:true` appends `--format json` and JSON.parses stdout into `data`.
 * - Nonzero exit throws (with stderr) unless `ignoreReturnCode` is set
 *   (no silent failures; spec §7).
 */

import * as exec from '@actions/exec';
import { CLI_BINARY_NAME, CLI_FORMAT_FLAG, CLI_FORMAT_JSON } from '../constants';

export interface CliRunOptions {
  json?: boolean;
  env?: Record<string, string>;
  ignoreReturnCode?: boolean;
  silent?: boolean;
}

export interface CliResult<T = unknown> {
  exitCode: number;
  stdout: string;
  stderr: string;
  data?: T;
}

/**
 * Append `--format json` only when the caller asked for JSON and didn't already
 * specify a `--format`. It ensures `--format json` is placed BEFORE the variadic
 * `--args` flag if present, so it isn't swallowed by the CLI.
 * Pure — exported for unit tests.
 */
export function withJsonFormat(args: string[]): string[] {
  if (args.includes(CLI_FORMAT_FLAG)) {
    return args;
  }
  const argsIndex = args.indexOf('--args');
  if (argsIndex !== -1) {
    const head = args.slice(0, argsIndex);
    const tail = args.slice(argsIndex);
    return [...head, CLI_FORMAT_FLAG, CLI_FORMAT_JSON, ...tail];
  }
  return [...args, CLI_FORMAT_FLAG, CLI_FORMAT_JSON];
}

/**
 * Execute `nebius <args>`.
 *
 * @typeParam T shape of the parsed JSON (only populated when `json:true`).
 * @throws on nonzero exit (unless `ignoreReturnCode`) or unparseable JSON.
 */
export async function runCli<T = unknown>(
  args: string[],
  opts: CliRunOptions = {},
): Promise<CliResult<T>> {
  const finalArgs = opts.json ? withJsonFormat(args) : args;

  const res = await exec.getExecOutput(CLI_BINARY_NAME, finalArgs, {
    ignoreReturnCode: true, // we inspect the code ourselves for richer errors
    silent: opts.silent ?? false,
    ...(opts.env ? { env: { ...process.env, ...opts.env } as Record<string, string> } : {}),
  });

  const result: CliResult<T> = {
    exitCode: res.exitCode,
    stdout: res.stdout,
    stderr: res.stderr,
  };

  if (res.exitCode !== 0 && !opts.ignoreReturnCode) {
    throw new Error(
      `nebius ${finalArgs.join(' ')} failed (exit ${res.exitCode}): ` +
        `${res.stderr.trim() || res.stdout.trim() || '<no output>'}`,
    );
  }

  if (opts.json && res.exitCode === 0) {
    const trimmed = res.stdout.trim();
    if (trimmed === '') {
      // Empty body on success: leave `data` undefined rather than guessing.
      return result;
    }
    try {
      result.data = JSON.parse(trimmed) as T;
    } catch {
      throw new Error(
        `nebius ${finalArgs.join(' ')} did not return valid JSON. Output: ${trimmed}`,
      );
    }
  }

  return result;
}
