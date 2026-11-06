import { it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const calls = vi.hoisted(() => [] as Array<{ args: string[]; options: any }>);
const outcome = vi.hoisted(() => ({ fail: null as null | { stdout: string; stderr: string }, stdout: '' }));
vi.mock('node:child_process', () => ({ execFile: Object.assign(() => { }, { [Symbol.for('nodejs.util.promisify.custom')]: async (_file: string, args: string[], options: any) => {
    calls.push({ args, options });
    if (outcome.fail) throw Object.assign(new Error('synthetic wrangler failure'), outcome.fail);
    return { stdout: outcome.stdout, stderr: '' };
} }) }));
import { deployWorkspace, main, recordActivation, releaseFingerprint, wranglerDeploy } from '../../tools/setup/cli';
import { hashBytes } from '../../tools/setup/preflight';
import { parseInstanceConfig } from '../../src/config/instance';
import { CHICAGO_OPERATIONS } from '../fixtures/candidates';
const roots: string[] = [];
afterEach(async () => { calls.length = 0; outcome.fail = null; outcome.stdout = ''; for (const r of roots.splice(0))
    await rm(r, { recursive: true, force: true }); });
async function root() { const r = await realpath(await mkdtemp(join(tmpdir(), 'setup-deploy-'))); roots.push(r); await mkdir(join(r, '.setup/generated'), { recursive: true, mode: 0o700 }); return r; }
async function instance() { return parseInstanceConfig(JSON.parse(await readFile(new URL('../../examples/instance.json', import.meta.url), 'utf8'))); }
const RELEASE = async () => 'a'.repeat(64);
// What reviewed activation leaves behind: both configs and the record of their bytes.
async function activated(r: string, i: Awaited<ReturnType<typeof instance>>) {
    const texts = { fixed: 'name = "synthetic-fixed"\n', unbounded: 'name = "synthetic-unbounded"\n' };
    for (const kind of ['fixed', 'unbounded'] as const)
        await writeFile(join(r, `.setup/generated/wrangler.${kind}.operational.toml`), texts[kind], { mode: 0o600 });
    await recordActivation(r, i, 'synthetic-criteria', texts, RELEASE);
}

it('deploys the fixed Worker, then the unbounded one, and records the unbounded URL', async () => {
    const r = await root(); const i = await instance(); await activated(r, i); const order: string[] = [];
    const workers = await deployWorkspace(r, i, 'SYNTHETIC-TOKEN', async (_root, config) => {
        order.push(config.split('/').at(-1)!);
        return config.includes('unbounded') ? `Uploaded\n  https://${i.cloudflare.unboundedWorkerName}.synthetic-sub.workers.dev\n` : 'Uploaded\n';
    }, RELEASE);
    expect(order).toEqual(['wrangler.fixed.operational.toml', 'wrangler.unbounded.operational.toml']);
    expect(workers.unbounded).toEqual({ name: i.cloudflare.unboundedWorkerName, url: `https://${i.cloudflare.unboundedWorkerName}.synthetic-sub.workers.dev` });
    expect(workers.fixed.url).toBeNull();
    const receipt = JSON.parse(await readFile(join(r, '.setup/deployment.json'), 'utf8'));
    expect(receipt).toMatchObject({ schemaVersion: 1, workers });
    expect(JSON.stringify(receipt)).not.toContain('SYNTHETIC-TOKEN');
});

it('refuses to deploy before activation has emitted and recorded both operational configs', async () => {
    const r = await root(); const i = await instance(); const deploy = vi.fn();
    await writeFile(join(r, '.setup/generated/wrangler.fixed.operational.toml'), 'name = "synthetic"\n');
    await expect(deployWorkspace(r, i, 'SYNTHETIC-TOKEN', deploy, RELEASE)).rejects.toThrow('ACTIVATION_REQUIRED');
    await activated(r, i); await rm(join(r, '.setup/generated/wrangler.unbounded.operational.toml'));
    await expect(deployWorkspace(r, i, 'SYNTHETIC-TOKEN', deploy, RELEASE)).rejects.toThrow('ACTIVATION_REQUIRED');
    expect(deploy).not.toHaveBeenCalled();
});

it('refuses an edited config, a changed instance or a different release tree', async () => {
    const i = await instance(); const deploy = vi.fn();
    const edited = await root(); await activated(edited, i);
    await writeFile(join(edited, '.setup/generated/wrangler.unbounded.operational.toml'), 'name = "hand-edited"\n');
    await expect(deployWorkspace(edited, i, 'SYNTHETIC-TOKEN', deploy, RELEASE)).rejects.toThrow('ACTIVATION_STALE');
    const changed = await root(); await activated(changed, i);
    await expect(deployWorkspace(changed, { ...i, shadowMode: true }, 'SYNTHETIC-TOKEN', deploy, RELEASE)).rejects.toThrow('ACTIVATION_STALE');
    const upgraded = await root(); await activated(upgraded, i);
    await expect(deployWorkspace(upgraded, i, 'SYNTHETIC-TOKEN', deploy, async () => 'b'.repeat(64))).rejects.toThrow('ACTIVATION_STALE');
    expect(deploy).not.toHaveBeenCalled();
});

it('fingerprints the shipped release files reproducibly', async () => {
    const first = await releaseFingerprint();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await releaseFingerprint()).toBe(first);
});

it('runs a real Wrangler deploy with the explicit token, private config, preserved HOME and a timeout', async () => {
    const r = await root(); const config = join(r, '.setup/generated/wrangler.fixed.operational.toml'); await writeFile(config, 'synthetic');
    outcome.stdout = 'Deployed synthetic';
    expect(await wranglerDeploy(r, config, 'SYNTHETIC-TOKEN')).toBe('Deployed synthetic');
    const { args, options } = calls[0];
    expect(args).toContain('deploy'); expect(args).not.toContain('--dry-run');
    expect(args).toContain(config);
    expect(options.env.CLOUDFLARE_API_TOKEN).toBe('SYNTHETIC-TOKEN');
    expect(options.env.HOME).toBe(process.env.HOME);
    expect(options.env.XDG_CONFIG_HOME).toBe(join(r, '.setup/xdg'));
    expect(options.timeout).toBeGreaterThan(0);
});

it('names a missing workers.dev subdomain and redacts any other Wrangler failure', async () => {
    const r = await root(); const config = join(r, '.setup/generated/wrangler.fixed.operational.toml'); await writeFile(config, 'synthetic');
    outcome.fail = { stdout: '', stderr: 'You need to register a workers.dev subdomain before publishing' };
    await expect(wranglerDeploy(r, config, 'SYNTHETIC-TOKEN')).rejects.toThrow('WORKERS_DEV_SUBDOMAIN_REQUIRED');
    outcome.fail = { stdout: 'SYNTHETIC-PRIVATE-OUTPUT', stderr: 'boom' };
    const error = await wranglerDeploy(r, config, 'SYNTHETIC-TOKEN').catch(e => e);
    expect(error.message).toBe('DEPLOY_FAILED'); expect(error.message).not.toContain('SYNTHETIC-PRIVATE-OUTPUT');
});

it.each(['preview', 'activate', 'deploy'])('%s on an unprovisioned instance names the resources step', async command => {
    const r = await root(); const candidate = structuredClone(CHICAGO_OPERATIONS); const readable = 'Synthetic criteria; not human approval.\n';
    candidate.approval.readableSha256 = hashBytes(readable);
    await writeFile(join(r, 'candidate.json'), JSON.stringify(candidate)); await writeFile(join(r, 'criteria.md'), readable);
    await writeFile(join(r, 'instance.json'), await readFile(new URL('../../examples/instance.draft.json', import.meta.url), 'utf8'));
    await expect(main([command, '--workspace', r, '--instance', join(r, 'instance.json'), '--provider-writes', 'approved'])).rejects.toThrow('RESOURCES_REQUIRED');
    expect(calls).toHaveLength(0);
    expect(JSON.parse(await main(['status', '--workspace', r, '--instance', join(r, 'instance.json')]))).toContainEqual({ stage: command === 'activate' ? 'activation' : command === 'deploy' ? 'deployment' : 'preview', status: 'blocked', errorCode: 'RESOURCES_REQUIRED' });
});

it('requires an explicit token before any subprocess', async () => {
    const r = await root(); const config = join(r, '.setup/generated/wrangler.fixed.operational.toml'); await writeFile(config, 'synthetic');
    await expect(wranglerDeploy(r, config, '')).rejects.toThrow('EXPLICIT_PROVIDER_TOKEN_REQUIRED');
    expect(calls).toHaveLength(0);
});
