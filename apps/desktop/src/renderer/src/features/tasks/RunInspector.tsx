import type { ReactElement } from 'react'
import type { ExecutionRun, RunDetail, Task } from '@factoru/protocol'

function label(value: string): string {
  return value.replaceAll('_', ' ')
}

function bounded(value: string, limit = 4_096): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n… excerpt truncated …`
}

export function executionUsageSummary(usage: ExecutionRun['usage']): string {
  const tokens = usage.inputTokens + usage.outputTokens
  if (usage.partial) return `${tokens} observed tokens · usage syncing; totals may be incomplete`
  const cost =
    usage.pricing === 'priced'
      ? `$${usage.estimatedCostUsd.toFixed(4)} estimated`
      : usage.pricing === 'unpriced'
        ? 'cost unpriced by the configured provider'
        : 'cost pending'
  return `${tokens} tokens · ${cost}`
}

export function RunInspector({
  task,
  run,
  detail,
  connected,
  busy,
  onBack,
  onCancel,
  onApprove,
  onRequestChanges,
  onRetry,
  onArchive,
}: {
  task: Task
  run: ExecutionRun
  detail: RunDetail
  connected: boolean
  busy: boolean
  onBack(): void
  onCancel(): void
  onApprove(): void
  onRequestChanges(): void
  onRetry(): void
  onArchive(): void
}): ReactElement {
  const actionable = connected && !busy
  return (
    <section className="run-inspector" aria-labelledby="run-inspector-title">
      <header className="run-inspector-heading">
        <button className="back-button" onClick={onBack} aria-label="Back to task board">
          ← Board
        </button>
        <div>
          <p className="eyebrow">{label(run.formulaName)} run</p>
          <h2 id="run-inspector-title">{task.title}</h2>
        </div>
        <span className={`health-pill ${run.status}`}>{label(run.status)}</span>
      </header>

      <div className="projection-notice" role="status" aria-live="polite">
        Projection {detail.projection.completeness}
        {detail.projection.reason ? ` · ${detail.projection.reason}` : ''}
      </div>

      <section className="run-inspector-section" aria-labelledby="run-overview-heading">
        <h3 id="run-overview-heading">Overview and stage ladder</h3>
        <ol className="stage-ladder">
          {detail.formula.stages.map((stage) => (
            <li className={stage.status} key={stage.id}>
              <strong>{stage.title}</strong>
              <span>
                {label(stage.status)} · attempt {stage.attempt}/{stage.maxAttempts}
              </span>
            </li>
          ))}
        </ol>
        <p>
          Verification {detail.budgets.verification.used}/{detail.budgets.verification.limit} ·
          corrections {detail.budgets.correction.used}/{detail.budgets.correction.limit} · transient
          retries {detail.budgets.transient.used}/{detail.budgets.transient.limit}
        </p>
      </section>

      <details className="run-inspector-section" open>
        <summary>Dependencies and decomposition</summary>
        <ul className="dependency-list" aria-label="Formula dependencies">
          {detail.formula.edges.map((edge) => (
            <li key={`${edge.from}:${edge.to}`}>
              {edge.from} → {edge.to}
            </li>
          ))}
        </ul>
        <p>{detail.convoy.units.length} serial units · same-session · one shared capsule</p>
        <ol className="unit-list">
          {detail.convoy.units.map((unit) => (
            <li key={unit.id}>
              <strong>{unit.title}</strong>
              <span>
                {label(unit.status)}
                {unit.dependencyIds.length ? ` · needs ${unit.dependencyIds.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </details>

      <details className="run-inspector-section">
        <summary>Sessions and bounded transcripts</summary>
        {detail.sessions.map((session) => (
          <article className="session-card" key={session.id}>
            <header>
              <strong>{label(session.purpose)}</strong>
              <span>{label(session.status)}</span>
            </header>
            {session.excerpts.map((excerpt) => (
              <pre key={excerpt.sequence} aria-label={`${excerpt.role} transcript excerpt`}>
                {bounded(excerpt.text)}
                {excerpt.redacted ? '\n[redacted]' : ''}
              </pre>
            ))}
          </article>
        ))}
      </details>

      <details className="run-inspector-section">
        <summary>Checks and opaque artifacts</summary>
        {run.reviewPackage && <pre>{bounded(run.reviewPackage.checks.output)}</pre>}
        <ul>
          {detail.artifacts.map((artifact) => (
            <li key={artifact.id}>
              {artifact.label} · {artifact.mediaType} · {artifact.sizeBytes} bytes
            </li>
          ))}
        </ul>
      </details>

      <details className="run-inspector-section" open>
        <summary>Specialist reports and synthesis</summary>
        <div className="specialist-grid">
          {detail.specialistReports.map((report) => (
            <article key={report.lane}>
              <strong>{label(report.lane)}</strong>
              <span className={`health-pill ${report.status}`}>{label(report.status)}</span>
              <p>{bounded(report.summary, 1_000)}</p>
              <ul>
                {report.findings.map((finding, index) => (
                  <li key={index}>{bounded(finding, 1_000)}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        {detail.synthesis && (
          <article className="synthesis-card">
            <strong>Synthesis · {label(detail.synthesis.status)}</strong>
            <p>{bounded(detail.synthesis.summary)}</p>
          </article>
        )}
      </details>

      <details className="run-inspector-section">
        <summary>Usage, capsule resources, and recovery</summary>
        <p>{executionUsageSummary(detail.usage)}</p>
        <p>
          Capsule: Factoru-managed worktree · convoy {detail.convoy.id ? 'available' : 'pending'}
        </p>
        <p>
          Recovery: {label(detail.recovery.state)}
          {detail.recovery.message ? ` · ${detail.recovery.message}` : ''}
        </p>
      </details>

      <footer className="run-actions" aria-label="Run actions">
        {['pending', 'running', 'cancelling'].includes(run.status) && (
          <button disabled={!actionable || run.status === 'cancelling'} onClick={onCancel}>
            Cancel run
          </button>
        )}
        {run.status === 'completed' && (
          <>
            <button className="primary" disabled={!actionable} onClick={onApprove}>
              Approve
            </button>
            <button disabled={!actionable} onClick={onRequestChanges}>
              Request changes
            </button>
          </>
        )}
        {run.status === 'failed' && (
          <button disabled={!actionable} onClick={onRetry}>
            Retry
          </button>
        )}
        {['completed', 'failed', 'cancelled'].includes(run.status) && (
          <button disabled={!actionable} onClick={onArchive}>
            Archive run
          </button>
        )}
      </footer>
    </section>
  )
}
