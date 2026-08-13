interface ProvisioningIssue {
  readonly error: { readonly code: string; readonly message: string } | null
  readonly retry: { readonly attemptCount: number; readonly nextAttemptAt: string } | null
}

interface ProvisioningProject {
  readonly setupState: 'setting_up' | 'ready' | 'needs_attention'
  readonly setupError: { readonly code: string; readonly message: string } | null
  readonly repositories: ReadonlyArray<{ readonly rig: ProvisioningIssue }>
}

export function provisioningIssue(project: ProvisioningProject) {
  return project.repositories.find((repository) => repository.rig.error) ?? null
}

export function provisioningHeading(project: ProvisioningProject): string {
  if (project.setupState === 'needs_attention') return 'Repository setup needs attention'
  const issue = provisioningIssue(project)
  if (issue?.rig.retry) return 'Repository setup will retry automatically'
  if (issue) return 'Retrying repository setup…'
  return 'Preparing project repositories…'
}

export function provisioningMessage(project: ProvisioningProject, factoryName: string): string {
  const issue = provisioningIssue(project)
  if (project.setupState === 'setting_up') {
    return (
      issue?.rig.error?.message ??
      `${factoryName} is cloning remote sources and registering execution rigs.`
    )
  }
  return project.setupError?.message ?? 'Fix the repository setup on the home factory, then retry.'
}
