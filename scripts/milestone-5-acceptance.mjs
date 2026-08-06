#!/usr/bin/env node
/**
 * Destructive, opt-in Milestone 5 production candidate benchmark.
 *
 * This script operates only on an explicitly supplied disposable repository
 * and acceptance directory. It uses the real Factoru database, capsule
 * service, Gas City adapter, Formula v2 workflow, and configured model
 * providers. It is deliberately excluded from `pnpm test`.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { FactoruDatabase } from '../packages/database/dist/index.js'
import { parseServerId } from '../packages/domain/dist/index.js'
import {
  GasCityAdapter,
  GasCityProjectConfigurator,
  SupervisorClient,
} from '../packages/gas-city/dist/index.js'
import { AgentToolService } from '../apps/server/dist/agent-tool-service.js'
import { buildServer } from '../apps/server/dist/app.js'
import { CapsuleService } from '../apps/server/dist/capsule-service.js'
import { WorkspaceService } from '../apps/server/dist/workspace-service.js'

const execFileAsync = promisify(execFile)
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const taskTitles = [
  'Amber release note',
  'Birch feature flag',
  'Cobalt catalog row',
  'Delta launch marker',
  'Elm capability note',
  'Flint rollout record',
  'Garnet feature entry',
  'Harbor delivery note',
  'Indigo catalog item',
  'Juniper launch record',
]

function usage() {
  return [
    'Usage: node scripts/milestone-5-acceptance.mjs --run',
    '',
    'Required environment:',
    '  FACTORU_ACCEPTANCE_ROOT  Existing disposable acceptance directory',
    '  FACTORU_ACCEPTANCE_REPO  Existing disposable Git repository',
    '  FACTORU_GAS_CITY_PATH    Existing dedicated Gas City city',
    '  FACTORU_GAS_CITY_NAME    City name served by the supervisor',
    '',
    'Optional: FACTORU_GAS_CITY_URL (default http://127.0.0.1:8372)',
  ].join('\n')
}

function requireAbsoluteDirectory(name) {
  const value = process.env[name]
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`)
  const real = fs.realpathSync(value)
  if (!fs.statSync(real).isDirectory()) throw new Error(`${name} must be a directory`)
  return real
}

function reportPath(root) {
  return path.join(root, 'milestone-5-report.json')
}

function saveReport(root, report) {
  const destination = reportPath(root)
  const temporary = `${destination}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, destination)
}

async function command(executable, args, cwd) {
  const result = await execFileAsync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

const expectedGasCityRuntimePaths = new Set([
  '.beads/interactions.jsonl',
  '.codex/config.toml',
  '.codex/hooks.json',
  '.gc/settings.json',
  '.mcp.json',
])

function unexpectedRepositoryChanges(status) {
  return status
    .split('\n')
    .filter(Boolean)
    .filter((line) => !expectedGasCityRuntimePaths.has(line.slice(3)))
}

function settleDirectAcceptancePlanning(database) {
  const now = new Date().toISOString()
  database.connection.transaction(() => {
    database.connection
      .prepare(
        `UPDATE queue_reconciliations SET status = 'cancelled', finished_at = ?
         WHERE status = 'pending'`,
      )
      .run(now)
    database.connection
      .prepare(
        `UPDATE outbox_items SET status = 'completed', lease_expires_at = NULL,
           updated_at = ? WHERE kind = 'queue.reconcile'
           AND status IN ('pending', 'processing')`,
      )
      .run(now)
  })()
}

function createAcceptanceTask(database, projectId, index) {
  const ordinal = String(index + 1).padStart(2, '0')
  const title = taskTitles[index]
  const task = database.tasks.create({
    projectId,
    title: `Add catalog task-${ordinal}`,
    description:
      `Add exactly one object to catalog.json with id "task-${ordinal}", ` +
      `title "${title}", and enabled true. Create features/task-${ordinal}.txt ` +
      `containing exactly "${title}" followed by a newline. Do not change anything else.`,
    status: 'queue',
    source: 'user',
    actorKind: 'user',
    actorId: 'milestone-5-operator',
  })
  database.tasks.update({
    taskId: task.id,
    priority: 100 - index,
    queuePhase: 'ready',
    workerTypeKind: 'software_engineer',
    formulaName: 'software-delivery',
    actorKind: 'system',
    actorId: 'milestone-5-direct-plan',
  })
  settleDirectAcceptancePlanning(database)
  return task
}

function assessRun(run, ordinal) {
  const review = run.reviewPackage
  const expectedId = `task-${ordinal}`
  const reasons = []
  if (run.status !== 'completed') reasons.push(`run status is ${run.status}`)
  if (!review) reasons.push('review package is missing')
  if (review?.checks.status !== 'passed') reasons.push('deterministic checks did not pass')
  if (!review?.internalReview.match(/\bAPPROVE\b/i)) reasons.push('reviewer did not approve')
  if (review && review.unresolvedRisks.length > 0)
    reasons.push('review package has unresolved risks')
  if (!review?.diff.includes(expectedId)) reasons.push(`diff does not mention ${expectedId}`)
  if (!review?.commits.length) reasons.push('implementation commit is missing')
  if (run.usage.inputTokens + run.usage.outputTokens === 0)
    reasons.push('model token usage was not observed')
  if (run.usage.pricing === 'pending') reasons.push('model pricing state is still pending')
  return { acceptedWithoutChanges: reasons.length === 0, reasons }
}

function reportEntry(run, task, ordinal, startedAt, extra = {}) {
  return {
    ordinal,
    taskId: task.id,
    runId: run.id,
    gasCityRunId: run.runId,
    status: run.status,
    durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    formulaHash: run.formulaHash,
    steps: run.steps,
    usage: run.usage,
    checks: run.reviewPackage?.checks.status ?? null,
    commits: run.reviewPackage?.commits ?? [],
    internalReview: run.reviewPackage?.internalReview ?? '',
    unresolvedRisks: run.reviewPackage?.unresolvedRisks ?? [],
    diff: run.reviewPackage?.diff ?? '',
    ...extra,
    ...assessRun(run, ordinal),
  }
}

async function waitForTerminal({ database, serviceRef, projectId, taskId, onStarted }) {
  const deadline = Date.now() + 20 * 60 * 1000
  let lastState = ''
  let started = false
  while (Date.now() < deadline) {
    settleDirectAcceptancePlanning(database)
    await serviceRef.current.process()
    const run = database.tasks
      .listExecutionRuns(projectId, true)
      .find((item) => item.taskId === taskId)
    if (run) {
      if (!started && run.status === 'running') {
        started = true
        await onStarted(run)
      }
      const state = `${run.status}:${run.stage}:${run.steps.map((step) => `${step.id}=${step.status}`).join(',')}`
      if (state !== lastState) {
        console.log(`${new Date().toISOString()} ${taskId} ${state}`)
        lastState = state
      }
      if (['completed', 'failed', 'cancelled'].includes(run.status)) return run
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new Error(`Timed out waiting for ${taskId}`)
}

async function waitForConversationDelivery({ database, serviceRef, projectId, existingTaskIds }) {
  const deadline = Date.now() + 30 * 60 * 1000
  let lastState = ''
  let restarted = false
  while (Date.now() < deadline) {
    await serviceRef.current.process()
    const task = database.tasks
      .listActive(projectId)
      .find(
        (candidate) =>
          !existingTaskIds.has(candidate.id) &&
          candidate.source === 'pm_chat' &&
          candidate.title.toLowerCase().includes('task-11'),
      )
    const run = task
      ? database.tasks
          .listExecutionRuns(projectId, true)
          .find((candidate) => candidate.taskId === task.id)
      : undefined
    const state = task
      ? `${task.status}:${task.queuePhase ?? '-'}:${run?.status ?? 'no-run'}:${run?.stage ?? '-'}`
      : 'waiting-for-pm-task'
    if (state !== lastState) {
      console.log(`${new Date().toISOString()} milestone-6 ${state}`)
      lastState = state
    }
    if (run?.status === 'running' && !restarted) {
      serviceRef.current = serviceRef.make()
      restarted = true
    }
    if (task && run && ['completed', 'failed', 'cancelled'].includes(run.status)) {
      return { task, run, serverRestartObserved: restarted }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new Error('Timed out waiting for the Milestone 6 conversation delivery')
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') throw new Error(usage())
  const root = requireAbsoluteDirectory('FACTORU_ACCEPTANCE_ROOT')
  const repository = requireAbsoluteDirectory('FACTORU_ACCEPTANCE_REPO')
  const cityPath = requireAbsoluteDirectory('FACTORU_GAS_CITY_PATH')
  const cityName = process.env.FACTORU_GAS_CITY_NAME?.trim()
  if (!cityName || !/^[a-zA-Z0-9_-]+$/.test(cityName)) {
    throw new Error('FACTORU_GAS_CITY_NAME must be a safe city name')
  }
  const supervisorUrl = process.env.FACTORU_GAS_CITY_URL ?? 'http://127.0.0.1:8372'
  const repositoryStatus = await command(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    repository,
  )
  const unexpectedChanges = unexpectedRepositoryChanges(repositoryStatus.stdout)
  if (unexpectedChanges.length > 0) {
    throw new Error(
      `Acceptance repository has unexpected changes:\n${unexpectedChanges.join('\n')}`,
    )
  }

  const serverId = parseServerId('srv_56accee0000000000000000000000000')
  const projectId = 'prj_56accee0000000000000000000000000'
  const database = new FactoruDatabase(path.join(root, 'factoru.sqlite'), serverId)
  const operatorDevice =
    database.listDevices()[0] ?? database.createTrustedDevice('Milestone 5 operator').device
  const agentTools = new AgentToolService(database)
  const app = buildServer({ serverId, database, agentToolService: agentTools, logLevel: 'silent' })
  const report = {
    version: 1,
    startedAt: new Date().toISOString(),
    cityName,
    cityPath,
    repository,
    repositoryHeadBefore: (await command('git', ['rev-parse', 'HEAD'], repository)).stdout.trim(),
    serviceRestartObserved: false,
    duplicateReactorPassObserved: false,
    softReloadObserved: false,
    runs: [],
  }
  const projection = path.join(cityPath, '.gc', 'factoru-server.json')
  const previousProjection = fs.existsSync(projection) ? fs.readFileSync(projection) : null

  try {
    await app.listen({ host: '127.0.0.1', port: 0 })
    const address = app.server.address()
    if (!address || typeof address === 'string')
      throw new Error('Acceptance server has no TCP port')
    const serverUrl = `http://127.0.0.1:${address.port}`

    if (!database.getProject(projectId)) {
      database.createProject({
        commandId: 'cmd_56accee0000000000000000000000000',
        deviceId: operatorDevice.id,
        requestHash: 'milestone-5-acceptance-v1',
        projectId,
        name: 'Milestones 5 and 6 acceptance',
        repositoryRootId: 'root_milestone_5_acceptance',
        repositoryRelativePath: '.',
        repositoryRealPath: repository,
        defaultBranch: 'dev',
        cityName,
        rigName: 'acceptance56',
        beadPrefix: 'a56',
      })
      const provision = database.claimDueOutbox()[0]
      if (!provision) throw new Error('Project provisioning outbox was not created')
      database.completeProvisioning(provision.id, projectId)
    }

    const executor = { run: command }
    const configurator = new GasCityProjectConfigurator({
      cityPath,
      factoruServerUrl: serverUrl,
      projectManagerPromptPath: path.join(
        workspaceRoot,
        'packs/factoru-default/agents/project-manager-chat/prompt.template.md',
      ),
      executor,
    })
    await configurator.reconcile(
      database.listProjects().map((project) => {
        const conversation = database.product.getConversation(project.id)
        if (!conversation) throw new Error('Acceptance project conversation is missing')
        const none = { provider: null, model: null }
        return {
          projectId: project.id,
          projectName: project.name,
          rigName: project.rig.rigName,
          chatAgentName: conversation.agentName,
          chat: none,
          planning: none,
          implementation: none,
          review: none,
        }
      }),
    )

    const adapter = new GasCityAdapter({
      client: new SupervisorClient({ baseUrl: supervisorUrl, timeoutMs: 45_000 }),
      cityName,
      probe: async (executable) => {
        try {
          const result = await command(executable, ['--version'], workspaceRoot)
          return { found: true, output: `${result.stdout}${result.stderr}` }
        } catch (error) {
          return { found: false, output: error instanceof Error ? error.message : String(error) }
        }
      },
      formulaSource: async (formulaName) =>
        fs.promises.readFile(
          path.join(workspaceRoot, 'packs/factoru-default/formulas', `${formulaName}.formula.toml`),
          'utf8',
        ),
    })
    const capsules = new CapsuleService(path.join(root, 'capsules'))
    const makeService = () =>
      new WorkspaceService(database, adapter, null, {
        capsules,
        cityName,
        packVersion: '0.3.0',
      })
    const serviceRef = { current: makeService(), make: makeService }

    for (let index = 0; index < taskTitles.length; index += 1) {
      const ordinal = String(index + 1).padStart(2, '0')
      const existing = database.tasks
        .listExecutionRuns(projectId, true)
        .map((run) => ({ run, task: database.tasks.get(run.taskId) }))
        .find(({ task }) => task?.title === `Add catalog task-${ordinal}`)
      if (existing?.run.status === 'completed' && existing.task?.resolution === 'accepted') {
        let run = existing.run
        if (run.runId) {
          const observed = await adapter.readRunUsage(run.runId, run.startingEventCursor)
          run = database.tasks.updateExecutionUsage(run.id, {
            inputTokens: observed.inputTokens,
            outputTokens: observed.outputTokens,
            estimatedCostUsd: observed.estimatedCostUsd,
            pricing: observed.pricing,
          })
        }
        if (!report.runs.some((entry) => entry.ordinal === ordinal)) {
          const startedAt = Date.parse(run.startedAt ?? run.createdAt)
          report.runs.push(reportEntry(run, existing.task, ordinal, startedAt, { resumed: true }))
          saveReport(root, report)
        }
        continue
      }
      if (existing && ['failed', 'cancelled'].includes(existing.run.status)) {
        throw new Error(`Cannot safely resume task-${ordinal} from ${existing.run.status}`)
      }
      const task = existing?.task ?? createAcceptanceTask(database, projectId, index)
      if (!task) throw new Error(`Acceptance task-${ordinal} is missing`)
      const startedAt = existing
        ? Date.parse(existing.run.startedAt ?? existing.run.createdAt)
        : Date.now()
      let restartedThisRun = false
      let run =
        existing?.run.status === 'completed'
          ? existing.run
          : await waitForTerminal({
              database,
              serviceRef,
              projectId,
              taskId: task.id,
              onStarted: async () => {
                if (index === 0) {
                  serviceRef.current = makeService()
                  report.serviceRestartObserved = true
                  restartedThisRun = true
                }
                if (index === 1) {
                  await serviceRef.current.process()
                  report.duplicateReactorPassObserved = true
                }
                if (index === 2) {
                  await command('gc', ['reload', '--soft', '--city', cityPath], workspaceRoot)
                  report.softReloadObserved = true
                }
              },
            })
      if (run.runId) {
        const observed = await adapter.readRunUsage(run.runId, run.startingEventCursor)
        run = database.tasks.updateExecutionUsage(run.id, {
          inputTokens: observed.inputTokens,
          outputTokens: observed.outputTokens,
          estimatedCostUsd: observed.estimatedCostUsd,
          pricing: observed.pricing,
        })
      }
      const assessment = assessRun(run, ordinal)
      const entry = reportEntry(run, task, ordinal, startedAt, {
        resumed: Boolean(existing),
        restartedThisRun,
      })
      report.runs.push(entry)
      saveReport(root, report)
      if (!assessment.acceptedWithoutChanges) {
        throw new Error(`task-${ordinal} did not meet acceptance: ${assessment.reasons.join('; ')}`)
      }
      serviceRef.current.approveExecution(
        projectId,
        run.id,
        `Milestone 5 operator accepted task-${ordinal} after reviewing the package.`,
        'milestone-5-operator',
      )
    }

    const milestone6Title = 'Add catalog task-11'
    let milestone6Task = database.tasks
      .listActive(projectId)
      .find((task) => task.title.toLowerCase().includes('task-11'))
    let milestone6Run = milestone6Task
      ? database.tasks
          .listExecutionRuns(projectId, true)
          .find((run) => run.taskId === milestone6Task.id)
      : undefined
    let milestone6RestartObserved = false
    if (!milestone6Run || milestone6Run.status !== 'completed') {
      const existingTaskIds = new Set(database.tasks.listActive(projectId).map((task) => task.id))
      serviceRef.current.sendMessage(
        projectId,
        `Create and queue exactly one task titled "${milestone6Title}". Its description must say: ` +
          'Add exactly one object to catalog.json with id "task-11", title "Kestrel release marker", ' +
          'and enabled true. Create features/task-11.txt containing exactly "Kestrel release marker" ' +
          'followed by a newline. Do not change anything else. Plan it for the Software Engineer ' +
          'using the software-delivery formula and let Factoru deliver it.',
        'Milestone 6 desktop operator',
      )
      const delivered = await waitForConversationDelivery({
        database,
        serviceRef,
        projectId,
        existingTaskIds,
      })
      milestone6Task = delivered.task
      milestone6Run = delivered.run
      milestone6RestartObserved = delivered.serverRestartObserved
    }
    if (!milestone6Task || !milestone6Run) throw new Error('Milestone 6 task run is missing')
    if (milestone6Run.runId) {
      const observed = await adapter.readRunUsage(
        milestone6Run.runId,
        milestone6Run.startingEventCursor,
      )
      milestone6Run = database.tasks.updateExecutionUsage(milestone6Run.id, {
        inputTokens: observed.inputTokens,
        outputTokens: observed.outputTokens,
        estimatedCostUsd: observed.estimatedCostUsd,
        pricing: observed.pricing,
      })
    }
    const milestone6Assessment = assessRun(milestone6Run, '11')
    report.milestone6 = {
      conversationMessageSent: true,
      taskSource: milestone6Task.source,
      taskStatus: milestone6Task.status,
      queuePhase: milestone6Task.queuePhase,
      serverServiceRestartObserved: milestone6RestartObserved,
      conversationMessages: serviceRef.current.get(projectId).conversation.messages.length,
      run: reportEntry(
        milestone6Run,
        milestone6Task,
        '11',
        Date.parse(milestone6Run.startedAt ?? milestone6Run.createdAt),
      ),
    }
    saveReport(root, report)
    if (!milestone6Assessment.acceptedWithoutChanges) {
      throw new Error(
        `Milestone 6 did not meet acceptance: ${milestone6Assessment.reasons.join('; ')}`,
      )
    }
    if (milestone6Task.resolution !== 'accepted') {
      serviceRef.current.approveExecution(
        projectId,
        milestone6Run.id,
        'Milestone 6 operator accepted the conversation-originated reviewed diff.',
        'milestone-6-operator',
      )
    }

    report.finishedAt = new Date().toISOString()
    report.repositoryHeadAfter = (
      await command('git', ['rev-parse', 'HEAD'], repository)
    ).stdout.trim()
    report.repositoryStatusAfter = (
      await command('git', ['status', '--porcelain=v1', '--untracked-files=all'], repository)
    ).stdout
    report.unexpectedRepositoryChangesAfter = unexpectedRepositoryChanges(
      report.repositoryStatusAfter,
    )
    report.summary = {
      attempted: report.runs.length,
      acceptedWithoutChanges: report.runs.filter((run) => run.acceptedWithoutChanges).length,
      acceptanceRate:
        report.runs.filter((run) => run.acceptedWithoutChanges).length / report.runs.length,
      totalInputTokens: report.runs.reduce((total, run) => total + run.usage.inputTokens, 0),
      totalOutputTokens: report.runs.reduce((total, run) => total + run.usage.outputTokens, 0),
      estimatedCostUsd: report.runs.reduce((total, run) => total + run.usage.estimatedCostUsd, 0),
      milestone6Accepted: milestone6Assessment.acceptedWithoutChanges,
    }
    saveReport(root, report)
    console.log(JSON.stringify(report.summary, null, 2))
  } finally {
    await app.close()
    database.close()
    if (previousProjection) fs.writeFileSync(projection, previousProjection, { mode: 0o600 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
