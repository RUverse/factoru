import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { resolveWorktreeRoot } from './worktree-env.mjs'

describe('portable Factoru agent contracts', () => {
  it('leave concrete provider and model choices to Worker Type deployment bindings', () => {
    const agents = path.join(resolveWorktreeRoot(), 'packs', 'factoru-default', 'agents')
    for (const entry of fs.readdirSync(agents, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const source = fs.readFileSync(path.join(agents, entry.name, 'agent.toml'), 'utf8')
      assert.doesNotMatch(source, /^provider\s*=/m, `${entry.name} hard-codes a provider`)
      assert.doesNotMatch(source, /^model\s*=/m, `${entry.name} hard-codes a model`)
    }
  })
})
