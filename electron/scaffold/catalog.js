// Bundled, curated catalog for the Project Scaffolding Tool.
//
// CommonJS — loaded by the Electron main process and by the vitest suite
// (node environment), neither of which run through Vite/ESM. Mirrors the
// gate modules' module style.
//
// Two registries:
//   MCP_CATALOG    — auth-aware MCP server descriptors (spec §7.1/§7.5)
//   SKILLS_CATALOG — bundled skill templates the form can drop into skill/
//
// The scaffolder reads ONLY this catalog (never free-form user commands), so
// generated output is deterministic and can't be coerced into running an
// arbitrary command (spec §11).

// ── MCP server descriptors ──────────────────────────────────────────────────
// Each input is one of three kinds (spec §7):
//   secret   → git-ignored file in .opencode-secrets/, referenced via {file:...}
//   config   → inline (non-sensitive) value in opencode.jsonc
//   external → nothing generated; registers a doctor check only
const MCP_CATALOG = {
  stitch: {
    id: 'stitch',
    label: 'Stitch',
    transport: 'local',
    command: ['npx', '-y', '@stitch/mcp'],
    defaultAuthProfile: 'oauth-proxy',
    authProfiles: {
      'oauth-proxy': {
        id: 'oauth-proxy',
        label: 'OAuth (gcloud) — no secret file',
        inputs: [
          {
            kind: 'config',
            envVar: 'GOOGLE_CLOUD_PROJECT',
            required: true,
            prompt: 'GCP project ID for this client',
          },
          {
            kind: 'external',
            via: 'gcloud-adc',
            note: 'gcloud auth application-default login',
            check: { type: 'file', target: '%APPDATA%/gcloud/application_default_credentials.json' },
          },
        ],
      },
      'api-key': {
        id: 'api-key',
        label: 'API key — one secret file',
        inputs: [
          {
            kind: 'secret',
            envVar: 'STITCH_API_KEY',
            fileName: 'stitch-api-key',
            required: true,
            placeholder: 'REPLACE_ME__stitch_api_key',
            source: 'Stitch console',
          },
        ],
      },
    },
  },

  figma: {
    id: 'figma',
    label: 'Figma',
    transport: 'local',
    command: ['npx', '-y', 'figma-developer-mcp', '--stdio'],
    defaultAuthProfile: 'local-desktop',
    authProfiles: {
      'local-desktop': {
        id: 'local-desktop',
        label: 'Local desktop (Dev Mode MCP) — no secret file',
        inputs: [
          {
            kind: 'external',
            via: 'local-port',
            note: 'Figma desktop, Dev Mode MCP enabled',
            check: { type: 'port', target: '127.0.0.1:3845' },
          },
        ],
      },
      remote: {
        id: 'remote',
        label: 'Remote (PAT) — one secret file',
        inputs: [
          {
            kind: 'secret',
            envVar: 'FIGMA_ACCESS_TOKEN',
            fileName: 'figma-access-token',
            required: true,
            placeholder: 'REPLACE_ME__figma_PAT',
            source: 'Figma → Settings',
          },
        ],
      },
    },
  },

  mendix: {
    id: 'mendix',
    label: 'Mendix',
    transport: 'local',
    command: ['npx', '-y', '@mendix/mcp'],
    defaultAuthProfile: 'local',
    authProfiles: {
      local: {
        id: 'local',
        label: 'Local (Studio Pro) — no secret file',
        inputs: [
          {
            kind: 'external',
            via: 'local-port',
            note: 'Studio Pro → Preferences → Maia → MCP',
            check: { type: 'port', target: '127.0.0.1:7782' },
          },
        ],
      },
    },
  },

  obsidian: {
    id: 'obsidian',
    label: 'Obsidian',
    transport: 'local',
    command: ['npx', '-y', 'obsidian-mcp'],
    defaultAuthProfile: 'local-rest-api',
    authProfiles: {
      'local-rest-api': {
        id: 'local-rest-api',
        label: 'Local REST API — one secret file',
        inputs: [
          {
            kind: 'config',
            envVar: 'OBSIDIAN_API_URL',
            required: true,
            defaultValue: 'https://127.0.0.1:27124',
          },
          {
            kind: 'secret',
            envVar: 'OBSIDIAN_API_KEY',
            fileName: 'obsidian-api-key',
            required: true,
            placeholder: 'REPLACE_ME__obsidian_key__value_only__no_newline',
            source: 'Obsidian Local REST API plugin',
          },
          {
            kind: 'config',
            envVar: 'OBSIDIAN_VERIFY_SSL',
            required: false,
            defaultValue: 'false',
          },
        ],
      },
    },
  },
}

// ── Skills catalog ──────────────────────────────────────────────────────────
// Each entry generates skill/<id>/SKILL.md from `body` (create-if-missing).
// This is the launch set (spec open question §16.1); add entries here to grow it.
const SKILLS_CATALOG = {
  'design-spec': {
    id: 'design-spec',
    name: 'Design Spec (SDD)',
    description: 'Author an SDD-style design spec before implementation.',
    body: [
      '# Design Spec (SDD)',
      '',
      'Use this skill to produce a Spec-Driven-Development design document before',
      'any implementation begins. A good spec states the goal, the problem, the',
      'concrete design, idempotency/safety rules, edge cases, and a testing strategy.',
      '',
      '## When to use',
      '- A non-trivial feature or refactor that an orchestrator will hand to builders.',
      '',
      '## Output',
      '- A markdown spec in `specs/` matching the house style.',
      '',
    ].join('\n'),
  },
  'commit-scribe': {
    id: 'commit-scribe',
    name: 'Commit Scribe',
    description: 'Write clear, conventional commit messages and PR bodies.',
    body: [
      '# Commit Scribe',
      '',
      'Use this skill to turn a working diff into a clear commit message and PR body.',
      '',
      '## Rules',
      '- Subject in imperative mood, <= 72 chars.',
      '- Body explains the why, not just the what.',
      '',
    ].join('\n'),
  },
}

module.exports = { MCP_CATALOG, SKILLS_CATALOG }
