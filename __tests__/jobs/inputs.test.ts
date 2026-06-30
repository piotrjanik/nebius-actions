import { describe, it, expect, vi, beforeEach } from 'vitest';

const inputs = new Map<string, string>();
vi.mock('@actions/core', () => ({
  getInput: (name: string) => (inputs.get(name) ?? '').trim(),
  getMultilineInput: (name: string) => {
    const raw = inputs.get(name) ?? '';
    if (raw === '') return [];
    return raw.split('\n').filter((line, i, arr) => !(i === arr.length - 1 && line === ''));
  },
}));

import { buildJobSpecFromInputs } from '../../src/core/jobs/inputs';

function setInput(name: string, value: string): void {
  inputs.set(name, value);
}
beforeEach(() => inputs.clear());

describe('buildJobSpecFromInputs', () => {
  it('maps the demo inputs onto the domain JobSpec', () => {
    setInput('image', 'axolotl:main');
    setInput('name', 'demo');
    setInput('command', 'bash');
    setInput('args', '-c "axolotl train /workspace/data/config.yaml"');
    setInput('preset', '1gpu');
    setInput('platform', 'gpu-l40s-a');
    setInput('mounts', 'bkt-1:/workspace/data:rw');
    setInput('timeout', '1h');
    setInput('disk-size', '250Gi');
    setInput('disk-type', 'network-ssd');
    setInput('preemptible', 'true');
    setInput('project-id', 'proj-1');

    expect(buildJobSpecFromInputs()).toEqual({
      image: 'axolotl:main',
      name: 'demo',
      command: ['bash'],
      args: '-c "axolotl train /workspace/data/config.yaml"',
      preset: '1gpu',
      platform: 'gpu-l40s-a',
      mounts: ['bkt-1:/workspace/data:rw'],
      timeout: '1h',
      diskSizeBytes: 250 * 1024 ** 3,
      diskType: 'network-ssd',
      preemptible: true,
      projectId: 'proj-1',
    });
  });

  it('requires image', () => {
    expect(() => buildJobSpecFromInputs()).toThrow(/image/i);
  });

  it('omits disk-size and defaults preemptible to false when unset', () => {
    setInput('image', 'img');
    const spec = buildJobSpecFromInputs();
    expect(spec.diskSizeBytes).toBeUndefined();
    expect(spec.preemptible).toBe(false);
  });
});
