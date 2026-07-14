/**
 * Run the `nebius` CLI and capture stdout/stderr.
 *
 * - `json:true` appends `--format json` and JSON.parses stdout into `data`.
 * - Nonzero exit throws (with stderr) unless `ignoreReturnCode` is set
 *   (no silent failures; spec §7).
 */

import * as exec from '@actions/exec';
import { spawn } from 'node:child_process';
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

export interface CliStreamOptions {
  /** Called once per complete stdout/stderr line. */
  onLine?: (line: string) => void;
  env?: Record<string, string>;
}

export interface CliStream {
  /** Kill the child. Idempotent; safe after it has already exited. */
  stop(): void;
  /** Settles when the child exits — on its own, via stop(), or on spawn error. */
  done: Promise<void>;
}

/**
 * Spawn `nebius <args>` for an open-ended stream and return a handle to stop it.
 *
 * `getExecOutput` cannot express this: it settles only when the child exits and
 * never exposes the child. `nebius ai job logs --follow` does NOT exit when the
 * job reaches a terminal state, so an unstoppable child keeps Node's event loop
 * alive and hangs the action long after the work is done. Callers MUST stop().
 */
export function streamCli(args: string[], opts: CliStreamOptions = {}): CliStream {
  const onLine = opts.onLine ?? ((): void => {});
  const child = spawn(CLI_BINARY_NAME, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(opts.env ? { env: { ...process.env, ...opts.env } as Record<string, string> } : {}),
  });

  // Chunks split mid-line, so buffer until a newline before emitting.
  const pump = (stream: NodeJS.ReadableStream | null): void => {
    if (!stream) {
      return;
    }
    let buf = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        onLine(line);
      }
    });
    stream.on('end', () => {
      if (buf !== '') {
        onLine(buf);
      }
    });
  };
  pump(child.stdout);
  pump(child.stderr);

  // `error` (e.g. binary missing) must settle `done` too, or callers awaiting it
  // would hang on exactly the failure they are trying to survive.
  const done = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    child.once('error', () => resolve());
  });

  return {
    stop(): void {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
    },
    done,
  };
}
