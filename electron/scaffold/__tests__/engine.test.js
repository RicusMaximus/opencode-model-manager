// Tests for electron/scaffold/engine.js — spec §12 matrix.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import os from 'os'
import path from 'path'
import fs from 'fs/promises'

const require = createRequire(import.meta.url)
const engine = require('../engine.js')
const { MCP_CATALOG, SKILLS_CATALOG } = require('../catalog.js')

const catalog = { MCP_CATALOG, SKILLS_CATALOG }

async function makeTempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'scaffold-test-'))
}

async function exists(p) {
  try { await fs.access(p); return true } catch { return false }
}

let tmpDir
beforeEach(async () => { tmpDir = await makeTempDir() })
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }) })

// ── computePlan — per-profile generation (spec §12) ─────────────────────────
describe('computePlan per-profile generation', () => {
  it('Stitch oauth-proxy emits NO secret (config + external only)', () => {
    const plan = engine.computePlan(
      { mcpServers: ['stitch'], authProfile: { stitch: 'oauth-proxy' }, configValues: { GOOGLE_CLOUD_PROJECT: 'p1' } },
      catalog,
    )
    expect(plan.secretFiles).toHaveLength(0)
    expect(plan.configInline.map((c) => c.envVar)).toEqual(['GOOGLE_CLOUD_PROJECT'])
    expect(plan.external).toHaveLength(1)
    expect(plan.needsSecretsFolder).toBe(false)
  })

  it('Stitch api-key emits exactly one secret', () => {
    const plan = engine.computePlan(
      { mcpServers: ['stitch'], authProfile: { stitch: 'api-key' } },
      catalog,
    )
    expect(plan.secretFiles).toHaveLength(1)
    expect(plan.secretFiles[0].fileName).toBe('stitch-api-key')
    expect(plan.needsSecretsFolder).toBe(true)
  })

  it('Figma local-desktop none; remote one', () => {
    const local = engine.computePlan({ mcpServers: ['figma'], authProfile: { figma: 'local-desktop' } }, catalog)
    expect(local.secretFiles).toHaveLength(0)
    const remote = engine.computePlan({ mcpServers: ['figma'], authProfile: { figma: 'remote' } }, catalog)
    expect(remote.secretFiles).toHaveLength(1)
    expect(remote.secretFiles[0].fileName).toBe('figma-access-token')
  })

  it('Obsidian emits 2 config + 1 secret', () => {
    const plan = engine.computePlan({ mcpServers: ['obsidian'] }, catalog)
    expect(plan.configInline).toHaveLength(2)
    expect(plan.secretFiles).toHaveLength(1)
    expect(plan.secretFiles[0].fileName).toBe('obsidian-api-key')
  })

  it('flags required config left blank', () => {
    const plan = engine.computePlan({ mcpServers: ['stitch'], authProfile: { stitch: 'oauth-proxy' } }, catalog)
    expect(plan.missingConfigValues).toEqual([{ serverId: 'stitch', envVar: 'GOOGLE_CLOUD_PROJECT' }])
  })
})

// ── mergeConfig — preserve $schema + unknown fields (spec §7.4.2) ────────────
describe('mergeConfig', () => {
  it('preserves $schema, unknown top-level fields, and sibling mcp entries', () => {
    const existing = {
      $schema: 'https://opencode.ai/config.json',
      model: 'anthropic/claude-sonnet-4-6',
      agent: { builder: { model: 'x' } },
      mcp: { gate: { type: 'local', command: ['node', 'g.js'], enabled: true } },
      somethingUnknown: { keep: true },
    }
    const plan = engine.computePlan({ mcpServers: ['obsidian'] }, catalog)
    const merged = engine.mergeConfig(existing, plan)
    expect(merged.$schema).toBe('https://opencode.ai/config.json')
    expect(merged.model).toBe('anthropic/claude-sonnet-4-6')
    expect(merged.agent.builder.model).toBe('x')
    expect(merged.mcp.gate).toBeTruthy()
    expect(merged.somethingUnknown.keep).toBe(true)
    // new entry wired
    expect(merged.mcp.obsidian.type).toBe('local')
    expect(merged.mcp.obsidian.environment.OBSIDIAN_API_KEY).toBe('{file:./.opencode-secrets/obsidian-api-key}')
    expect(merged.mcp.obsidian.environment.OBSIDIAN_API_URL).toBe('https://127.0.0.1:27124')
  })
})

// ── sync — filesystem (spec §7.3, §7.4) ─────────────────────────────────────
describe('sync', () => {
  const fullSelections = {
    mcpServers: ['obsidian', 'stitch', 'figma', 'mendix'],
    authProfile: { obsidian: 'local-rest-api', stitch: 'oauth-proxy', figma: 'local-desktop', mendix: 'local' },
    configValues: { GOOGLE_CLOUD_PROJECT: 'north-sea-portal-mcp-7' },
    skills: ['design-spec'],
    projectMemory: false, // no template available in unit env
    specsFolder: true,
  }

  it('North Sea Portal: exactly one secret file', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'))
    const res = await engine.sync(tmpDir, fullSelections, catalog)
    expect(await exists(path.join(tmpDir, '.opencode-secrets', 'obsidian-api-key'))).toBe(true)
    const secretFiles = (await fs.readdir(path.join(tmpDir, '.opencode-secrets')))
      .filter((f) => !f.endsWith('.example') && f !== 'README.md')
    expect(secretFiles).toEqual(['obsidian-api-key'])
    expect(res.created).toContain('opencode.jsonc')
    expect(await exists(path.join(tmpDir, 'specs', 'README.md'))).toBe(true)
    expect(await exists(path.join(tmpDir, 'skill', 'design-spec', 'SKILL.md'))).toBe(true)
  })

  it('secret + .example have NO trailing newline; real file create-if-missing', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'))
    await engine.sync(tmpDir, { mcpServers: ['obsidian'] }, catalog)
    const secretPath = path.join(tmpDir, '.opencode-secrets', 'obsidian-api-key')
    const secret = await fs.readFile(secretPath, 'utf8')
    expect(secret.endsWith('\n')).toBe(false)
    const example = await fs.readFile(secretPath + '.example', 'utf8')
    expect(example.endsWith('\n')).toBe(false)

    // Fill with a real value and re-run — must NOT be clobbered.
    await fs.writeFile(secretPath, 'REAL_VALUE', 'utf8')
    const res = await engine.sync(tmpDir, { mcpServers: ['obsidian'] }, catalog)
    expect(await fs.readFile(secretPath, 'utf8')).toBe('REAL_VALUE')
    expect(res.skipped).toContain('.opencode-secrets/obsidian-api-key')
  })

  it('unfilled required secret is reported in needsFill', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'))
    const res = await engine.sync(tmpDir, { mcpServers: ['obsidian'] }, catalog)
    expect(res.needsFill.some((n) => n.file === '.opencode-secrets/obsidian-api-key')).toBe(true)
  })

  it('gitignore block is authoritative and idempotent', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'))
    await engine.sync(tmpDir, { mcpServers: ['obsidian'] }, catalog)
    const gi1 = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8')
    expect(gi1).toContain('/.opencode-secrets/*')
    expect(gi1).toContain('!/.opencode-secrets/*.example')
    await engine.sync(tmpDir, { mcpServers: ['obsidian'] }, catalog)
    const gi2 = await fs.readFile(path.join(tmpDir, '.gitignore'), 'utf8')
    // Block appears exactly once.
    expect(gi2.split(engine.GITIGNORE_BEGIN).length - 1).toBe(1)
  })

  it('non-git project warns and skips gitignore', async () => {
    const res = await engine.sync(tmpDir, { mcpServers: ['obsidian'] }, catalog)
    expect(await exists(path.join(tmpDir, '.gitignore'))).toBe(false)
    expect(res.warnings.some((w) => /git/i.test(w))).toBe(true)
  })

  it('re-run is additive — opencode.jsonc preserved, entries survive', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'))
    await engine.sync(tmpDir, { mcpServers: ['obsidian'] }, catalog)
    // add a sibling field by hand
    const cfgPath = path.join(tmpDir, 'opencode.jsonc')
    const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8'))
    cfg.model = 'anthropic/claude-opus-4-8'
    await fs.writeFile(cfgPath, JSON.stringify(cfg, null, 2))
    await engine.sync(tmpDir, { mcpServers: ['stitch'], authProfile: { stitch: 'api-key' } }, catalog)
    const after = JSON.parse(await fs.readFile(cfgPath, 'utf8'))
    expect(after.model).toBe('anthropic/claude-opus-4-8')
    expect(after.mcp.obsidian).toBeTruthy()
    expect(after.mcp.stitch).toBeTruthy()
  })
})

// ── preview parity (spec §12) ───────────────────────────────────────────────
describe('preview', () => {
  it('matches what sync creates (fresh project)', async () => {
    await fs.mkdir(path.join(tmpDir, '.git'))
    const selections = { mcpServers: ['obsidian'], specsFolder: true }
    const pv = await engine.preview(tmpDir, selections, catalog)
    expect(pv.willCreate).toContain('.opencode-secrets/obsidian-api-key')
    expect(pv.willCreate).toContain('opencode.jsonc')
    expect(pv.willCreate).toContain('specs/README.md')

    await engine.sync(tmpDir, selections, catalog)
    // After sync, a second preview should report those as skip.
    const pv2 = await engine.preview(tmpDir, selections, catalog)
    expect(pv2.willSkip).toContain('opencode.jsonc')
    expect(pv2.willSkip).toContain('.opencode-secrets/obsidian-api-key')
  })
})

// ── shared secret dedupe (spec §7.4.5) ──────────────────────────────────────
describe('dedupe by fileName', () => {
  it('one file per fileName even across inputs', () => {
    // Synthesize a catalog where two servers share a secret fileName.
    const shared = {
      MCP_CATALOG: {
        a: { id: 'a', transport: 'local', command: ['a'], defaultAuthProfile: 'k',
          authProfiles: { k: { id: 'k', inputs: [{ kind: 'secret', envVar: 'TOK', fileName: 'shared-tok', required: true, placeholder: 'PH' }] } } },
        b: { id: 'b', transport: 'local', command: ['b'], defaultAuthProfile: 'k',
          authProfiles: { k: { id: 'k', inputs: [{ kind: 'secret', envVar: 'TOK', fileName: 'shared-tok', required: true, placeholder: 'PH' }] } } },
      },
      SKILLS_CATALOG: {},
    }
    const plan = engine.computePlan({ mcpServers: ['a', 'b'] }, shared)
    expect(plan.secretFiles).toHaveLength(1)
    expect(plan.secretInputs).toHaveLength(2) // both env refs kept
  })
})
