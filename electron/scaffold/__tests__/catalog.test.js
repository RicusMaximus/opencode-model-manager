// Tests for electron/scaffold/catalog.js — spec §12 (catalog invariants).

import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { MCP_CATALOG, SKILLS_CATALOG } = require('../catalog.js')

describe('MCP catalog invariants', () => {
  it('every server has a valid defaultAuthProfile', () => {
    for (const [id, desc] of Object.entries(MCP_CATALOG)) {
      expect(desc.authProfiles[desc.defaultAuthProfile], `${id} default profile`).toBeTruthy()
    }
  })

  it('secret fileNames are unique within each profile', () => {
    for (const desc of Object.values(MCP_CATALOG)) {
      for (const profile of Object.values(desc.authProfiles)) {
        const names = profile.inputs.filter((i) => i.kind === 'secret').map((i) => i.fileName)
        expect(new Set(names).size).toBe(names.length)
      }
    }
  })

  it('every input declares a known kind', () => {
    for (const desc of Object.values(MCP_CATALOG)) {
      for (const profile of Object.values(desc.authProfiles)) {
        for (const input of profile.inputs) {
          expect(['secret', 'config', 'external']).toContain(input.kind)
        }
      }
    }
  })

  it('local servers declare a command; remote declare a url', () => {
    for (const [id, desc] of Object.entries(MCP_CATALOG)) {
      if (desc.transport === 'remote') expect(desc.url, `${id} url`).toBeTruthy()
      else expect(desc.command, `${id} command`).toBeTruthy()
    }
  })
})

describe('skills catalog', () => {
  it('every skill has id, name, description, body', () => {
    for (const [id, s] of Object.entries(SKILLS_CATALOG)) {
      expect(s.id).toBe(id)
      expect(s.name).toBeTruthy()
      expect(s.description).toBeTruthy()
      expect(s.body).toBeTruthy()
    }
  })
})
