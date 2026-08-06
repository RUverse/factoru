import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExecutionRunRecord, ProjectRecord } from '@factoru/database'
import { CapsuleIntegrationError, CapsuleService } from './capsule-service.js'

const directories: string[] = []

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'factoru-capsule-'))
  directories.push(root)
  const repository = path.join(root, 'repository')
  fs.mkdirSync(repository)
  execFileSync('git', ['init', '-b', 'dev'], { cwd: repository })
  execFileSync('git', ['config', 'user.email', 'factoru@example.test'], { cwd: repository })
  execFileSync('git', ['config', 'user.name', 'Factoru Test'], { cwd: repository })
  fs.mkdirSync(path.join(repository, '.beads'))
  fs.writeFileSync(
    path.join(repository, 'factoru.project.json'),
    '{"verificationCommand":["sh","verify.sh"]}\n',
  )
  fs.writeFileSync(path.join(repository, 'verify.sh'), '#!/bin/sh\ntest -f delivered.txt\n', {
    mode: 0o755,
  })
  fs.writeFileSync(path.join(repository, 'README.md'), '# Fixture\n')
  execFileSync('git', ['add', '.'], { cwd: repository })
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repository })
  const project = {
    id: 'prj_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'Fixture',
    repositoryRealPath: repository,
    defaultBranch: 'dev',
  } as ProjectRecord
  const run = {
    id: 'run_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    taskId: 'task_cccccccccccccccccccccccccccccccc',
    projectId: project.id,
  } as ExecutionRunRecord
  return { root, repository, project, run }
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})

describe('CapsuleService', () => {
  it('creates and re-adopts one Factoru-owned worktree per run', async () => {
    const { root, repository, project, run } = fixture()
    const service = new CapsuleService(path.join(root, 'capsules'))
    const capsule = await service.prepare(project, run)
    expect(fs.existsSync(path.join(capsule.worktreePath, '.git'))).toBe(true)
    expect(fs.statSync(capsule.verificationScript).mode & 0o777).toBe(0o700)
    expect(
      fs.readFileSync(path.join(repository, '.beads/factoru/run-delivery-check.sh'), 'utf8'),
    ).toContain('gc.graphv2_vars.v1')
    expect(await service.prepare(project, run)).toEqual(capsule)
  })

  it('rebases, reruns checks, and assembles bounded review evidence', async () => {
    const { root, project, run } = fixture()
    const service = new CapsuleService(path.join(root, 'capsules'))
    const capsule = await service.prepare(project, run)
    fs.writeFileSync(path.join(capsule.worktreePath, 'delivered.txt'), 'done\n')
    execFileSync('git', ['add', 'delivered.txt'], { cwd: capsule.worktreePath })
    execFileSync('git', ['commit', '-m', 'deliver task'], { cwd: capsule.worktreePath })
    fs.writeFileSync(path.join(capsule.evidencePath, 'review.md'), 'APPROVE\n')
    fs.writeFileSync(path.join(capsule.evidencePath, 'final.md'), 'Ready.\n')

    const review = await service.finalize(project, run, capsule, {
      request: 'Deliver it',
      plan: 'Add delivered.txt',
      usage: { inputTokens: 10, outputTokens: 5, estimatedCostUsd: 0.01 },
    })
    expect(review.commits[0]).toContain('deliver task')
    expect(review.diff).toContain('delivered.txt')
    expect(review.checks.status).toBe('passed')
    expect(review.internalReview).toContain('APPROVE')
  }, 15_000)

  it('fails closed when the implementation leaves source changes uncommitted', async () => {
    const { root, project, run } = fixture()
    const service = new CapsuleService(path.join(root, 'capsules'))
    const capsule = await service.prepare(project, run)
    fs.writeFileSync(path.join(capsule.worktreePath, 'dirty.txt'), 'dirty\n')
    await expect(
      service.finalize(project, run, capsule, {
        request: 'x',
        plan: 'x',
        usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 },
      }),
    ).rejects.toBeInstanceOf(CapsuleIntegrationError)
  })
})
