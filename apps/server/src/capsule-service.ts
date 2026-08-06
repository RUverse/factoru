import { randomUUID } from 'node:crypto'
import { execFile, type ExecFileException } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import type {
  ExecutionReviewPackageRecord,
  ExecutionRunRecord,
  ExecutionUsageRecord,
  ProjectRecord,
} from '@factoru/database'

const execFileAsync = promisify(execFile)
const MAX_EVIDENCE_BYTES = 200_000

export interface CapsuleRecord {
  id: string
  runId: string
  taskId: string
  projectId: string
  rootPath: string
  worktreePath: string
  controlPath: string
  evidencePath: string
  verificationScript: string
  branchName: string
  baseBranch: string
}

interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface CapsuleCommandRunner {
  run(executable: string, args: readonly string[], cwd: string): Promise<CommandResult>
}

export interface ExecutionCapsuleManager {
  prepare(project: ProjectRecord, run: ExecutionRunRecord): Promise<CapsuleRecord>
  readLogs(capsule: CapsuleRecord): readonly string[]
  finalize(
    project: ProjectRecord,
    run: ExecutionRunRecord,
    capsule: CapsuleRecord,
    input: { request: string; plan: string; usage: ExecutionUsageRecord },
  ): Promise<ExecutionReviewPackageRecord>
}

export class CapsuleIntegrationError extends Error {
  readonly kind: 'conflict' | 'checks_failed' | 'dirty_worktree' | 'invalid_capsule'

  constructor(kind: CapsuleIntegrationError['kind'], message: string) {
    super(message)
    this.name = 'CapsuleIntegrationError'
    this.kind = kind
  }
}

const defaultRunner: CapsuleCommandRunner = {
  async run(executable, args, cwd) {
    try {
      const result = await execFileAsync(executable, [...args], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
      })
      return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
    } catch (error) {
      const commandError = error as ExecFileException & { stdout?: string; stderr?: string }
      return {
        exitCode: typeof commandError.code === 'number' ? commandError.code : 1,
        stdout: commandError.stdout ?? '',
        stderr: commandError.stderr ?? commandError.message,
      }
    }
  },
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
}

function boundedRead(file: string): string {
  try {
    const value = fs.readFileSync(file)
    if (value.length <= MAX_EVIDENCE_BYTES) return value.toString('utf8')
    return `${value.subarray(0, MAX_EVIDENCE_BYTES).toString('utf8')}\n… evidence truncated …`
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return ''
    throw error
  }
}

function verificationCommand(repositoryPath: string): readonly string[] | null {
  const configPath = path.join(repositoryPath, 'factoru.project.json')
  if (fs.existsSync(configPath)) {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('verificationCommand' in parsed) ||
      !Array.isArray(parsed.verificationCommand) ||
      parsed.verificationCommand.length === 0 ||
      parsed.verificationCommand.some((part) => typeof part !== 'string' || part.length === 0)
    ) {
      throw new Error('factoru.project.json must define a non-empty verificationCommand array')
    }
    return parsed.verificationCommand as string[]
  }
  const packageJsonPath = path.join(repositoryPath, 'package.json')
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>
    }
    const script = packageJson.scripts?.['check']
      ? 'check'
      : packageJson.scripts?.['test']
        ? 'test'
        : null
    if (script && fs.existsSync(path.join(repositoryPath, 'pnpm-lock.yaml')))
      return ['pnpm', script]
    if (script && fs.existsSync(path.join(repositoryPath, 'yarn.lock'))) return ['yarn', script]
    if (script) return ['npm', 'run', script]
  }
  if (fs.existsSync(path.join(repositoryPath, 'Cargo.toml'))) return ['cargo', 'test']
  if (fs.existsSync(path.join(repositoryPath, 'go.mod'))) return ['go', 'test', './...']
  return null
}

function bridgeScript(): string {
  return `#!/bin/sh
set -eu

if [ -z "\${GC_BEAD_ID:-}" ]; then
  echo "GC_BEAD_ID is required" >&2
  exit 2
fi

step_json="$(bd show "$GC_BEAD_ID" --json)"
root_id="$(printf '%s' "$step_json" | jq -r '(if type == "array" then .[0] else . end).metadata["gc.root_bead_id"] // empty')"
if [ -z "$root_id" ]; then
  echo "workflow root metadata is missing" >&2
  exit 2
fi
root_json="$(bd show "$root_id" --json)"
vars_json="$(printf '%s' "$root_json" | jq -c '(if type == "array" then .[0] else . end).metadata["gc.graphv2_vars.v1"] // empty')"
if [ -z "$vars_json" ] || [ "$vars_json" = "null" ]; then
  echo "workflow variable snapshot is missing" >&2
  exit 2
fi
if printf '%s' "$vars_json" | jq -e 'type == "string"' >/dev/null 2>&1; then
  vars_json="$(printf '%s' "$vars_json" | jq -r '.' )"
fi
verify_script="$(printf '%s' "$vars_json" | jq -r '.verification_script // empty')"
run_id="$(printf '%s' "$vars_json" | jq -r '.run_id // empty')"
if [ -z "$verify_script" ] || [ -z "$run_id" ] || [ ! -x "$verify_script" ]; then
  echo "trusted verification script is unavailable" >&2
  exit 2
fi
manifest="$(dirname "$verify_script")/capsule.json"
if [ ! -f "$manifest" ] || ! jq -e --arg run "$run_id" '.runId == $run' "$manifest" >/dev/null; then
  echo "verification script does not belong to this Factoru run" >&2
  exit 2
fi
exec "$verify_script"
`
}

export class CapsuleService {
  readonly #root: string
  readonly #runner: CapsuleCommandRunner

  constructor(root: string, runner: CapsuleCommandRunner = defaultRunner) {
    if (!path.isAbsolute(root)) throw new Error('Capsule root must be absolute')
    this.#root = path.resolve(root)
    this.#runner = runner
  }

  async prepare(project: ProjectRecord, run: ExecutionRunRecord): Promise<CapsuleRecord> {
    const repositoryPath = fs.realpathSync(project.repositoryRealPath)
    if (!fs.statSync(repositoryPath).isDirectory())
      throw new Error('Project repository is unavailable')
    const rootPath = path.resolve(this.#root, project.id, run.id)
    if (!inside(this.#root, rootPath)) throw new Error('Capsule path escaped the configured root')
    const worktreePath = path.join(rootPath, 'worktree')
    const controlPath = path.join(rootPath, 'control')
    const evidencePath = path.join(controlPath, 'evidence')
    const verificationScript = path.join(controlPath, 'verify.sh')
    const manifestPath = path.join(controlPath, 'capsule.json')
    const branchName = `factoru/${project.id.slice(-8)}/${run.taskId.slice(-8)}/${run.id.slice(-8)}`
    const capsule: CapsuleRecord = {
      id: `capsule_${run.id.slice(4)}`,
      runId: run.id,
      taskId: run.taskId,
      projectId: project.id,
      rootPath,
      worktreePath,
      controlPath,
      evidencePath,
      verificationScript,
      branchName,
      baseBranch: project.defaultBranch,
    }

    if (fs.existsSync(manifestPath)) {
      const existing = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as CapsuleRecord
      if (
        existing.runId !== run.id ||
        existing.projectId !== project.id ||
        fs.realpathSync(existing.worktreePath) !== fs.realpathSync(worktreePath)
      ) {
        throw new CapsuleIntegrationError(
          'invalid_capsule',
          'Existing capsule identity does not match',
        )
      }
      this.#installBridge(repositoryPath)
      return existing
    }

    fs.mkdirSync(rootPath, { recursive: true, mode: 0o700 })
    const worktree = await this.#runner.run(
      'git',
      [
        '-C',
        repositoryPath,
        'worktree',
        'add',
        '-b',
        branchName,
        worktreePath,
        project.defaultBranch,
      ],
      repositoryPath,
    )
    if (worktree.exitCode !== 0) {
      throw new Error(`Could not create capsule worktree: ${worktree.stderr || worktree.stdout}`)
    }

    fs.mkdirSync(evidencePath, { recursive: true, mode: 0o700 })
    const command = verificationCommand(worktreePath)
    const logPath = path.join(evidencePath, 'checks.log')
    const commandLine = command?.map(shellQuote).join(' ')
    const commandDisplay = command?.join(' ') ?? ''
    const script = commandLine
      ? `#!/bin/sh
set -u
cd ${shellQuote(worktreePath)}
log=${shellQuote(logPath)}
printf 'verification: %s\\n' ${shellQuote(commandDisplay)} > "$log"
set +e
${commandLine} >> "$log" 2>&1
status=$?
set -e
printf '\\nexit_status: %s\\n' "$status" >> "$log"
exit "$status"
`
      : `#!/bin/sh
set -eu
printf 'No verification command is configured. Add factoru.project.json with a verificationCommand array.\\n' > ${shellQuote(logPath)}
exit 2
`
    fs.writeFileSync(verificationScript, script, { mode: 0o700, flag: 'wx' })
    fs.writeFileSync(manifestPath, `${JSON.stringify(capsule, null, 2)}\n`, {
      mode: 0o600,
      flag: 'wx',
    })
    this.#installBridge(repositoryPath)
    return capsule
  }

  readLogs(capsule: CapsuleRecord): readonly string[] {
    const files = [
      ['Implementation', 'implementation.md'],
      ['Checks', 'checks.log'],
      ['Review', 'review.md'],
      ['Finalization', 'final.md'],
    ] as const
    return files.flatMap(([label, file]) => {
      const content = boundedRead(path.join(capsule.evidencePath, file)).trim()
      return content ? [`${label}\n${content}`] : []
    })
  }

  async finalize(
    _project: ProjectRecord,
    run: ExecutionRunRecord,
    capsule: CapsuleRecord,
    input: { request: string; plan: string; usage: ExecutionUsageRecord },
  ): Promise<ExecutionReviewPackageRecord> {
    this.#validateCapsule(run, capsule)
    const status = await this.#runner.run('git', ['status', '--porcelain'], capsule.worktreePath)
    if (status.exitCode !== 0 || status.stdout.trim()) {
      throw new CapsuleIntegrationError(
        'dirty_worktree',
        'The implementation left uncommitted source changes in its capsule.',
      )
    }

    const rebase = await this.#runner.run(
      'git',
      ['rebase', capsule.baseBranch],
      capsule.worktreePath,
    )
    if (rebase.exitCode !== 0) {
      await this.#runner.run('git', ['rebase', '--abort'], capsule.worktreePath)
      throw new CapsuleIntegrationError(
        'conflict',
        `The capsule conflicts with the latest ${capsule.baseBranch}: ${rebase.stderr || rebase.stdout}`,
      )
    }

    const checks = await this.#runner.run(capsule.verificationScript, [], capsule.worktreePath)
    const checkOutput = boundedRead(path.join(capsule.evidencePath, 'checks.log'))
    if (checks.exitCode !== 0) {
      throw new CapsuleIntegrationError(
        'checks_failed',
        `Verification failed after integration: ${checkOutput || checks.stderr}`,
      )
    }

    const [diff, commits] = await Promise.all([
      this.#runner.run('git', ['diff', `${capsule.baseBranch}...HEAD`], capsule.worktreePath),
      this.#runner.run(
        'git',
        ['log', '--format=%H%x09%s', `${capsule.baseBranch}..HEAD`],
        capsule.worktreePath,
      ),
    ])
    if (diff.exitCode !== 0 || commits.exitCode !== 0) {
      throw new CapsuleIntegrationError('invalid_capsule', 'Could not read integrated Git evidence')
    }
    const internalReview = boundedRead(path.join(capsule.evidencePath, 'review.md'))
    const finalSummary = boundedRead(path.join(capsule.evidencePath, 'final.md'))
    const unresolvedRisks = /REQUEST_CHANGES/i.test(internalReview)
      ? ['The independent reviewer requested changes.']
      : finalSummary
          .split('\n')
          .filter((line) => /^risk:/i.test(line.trim()))
          .map((line) => line.replace(/^risk:\s*/i, '').trim())

    return {
      request: input.request,
      plan: input.plan,
      diff:
        diff.stdout.length <= MAX_EVIDENCE_BYTES
          ? diff.stdout
          : `${diff.stdout.slice(0, MAX_EVIDENCE_BYTES)}\n… diff truncated …`,
      commits: commits.stdout.trim().split('\n').filter(Boolean),
      checks: { status: 'passed', output: checkOutput },
      internalReview,
      unresolvedRisks,
      usage: input.usage,
      capsulePath: capsule.worktreePath,
      branchName: capsule.branchName,
    }
  }

  #validateCapsule(run: ExecutionRunRecord, capsule: CapsuleRecord): void {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(capsule.controlPath, 'capsule.json'), 'utf8'),
    ) as CapsuleRecord
    if (manifest.runId !== run.id || manifest.worktreePath !== capsule.worktreePath) {
      throw new CapsuleIntegrationError(
        'invalid_capsule',
        'Capsule manifest does not match the run',
      )
    }
  }

  #installBridge(repositoryPath: string): void {
    const beads = path.join(repositoryPath, '.beads')
    const beadsStat = fs.lstatSync(beads)
    if (!beadsStat.isDirectory() || beadsStat.isSymbolicLink()) {
      throw new Error('Gas City .beads runtime must be a real directory')
    }
    const directory = path.join(beads, 'factoru')
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const directoryStat = fs.lstatSync(directory)
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
      throw new Error('Factoru Gas City bridge directory must be a real directory')
    }
    const target = path.join(directory, 'run-delivery-check.sh')
    const temporary = path.join(directory, `.run-delivery-check.${process.pid}.${randomUUID()}`)
    fs.writeFileSync(temporary, bridgeScript(), { mode: 0o700, flag: 'wx' })
    fs.renameSync(temporary, target)
  }
}
