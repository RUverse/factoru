import { describe, expect, it } from 'vitest'
import { provisioningHeading, provisioningMessage } from './provisioning'

const pending = {
  setupState: 'setting_up' as const,
  setupError: null,
  repositories: [{ rig: { error: null, retry: null } }],
}

describe('repository provisioning presentation', () => {
  it('distinguishes ordinary work from scheduled and active retries', () => {
    expect(provisioningHeading(pending)).toBe('Preparing project repositories…')
    expect(provisioningMessage(pending, 'Raspberry Pi')).toContain('Raspberry Pi is cloning')

    const retrying = {
      ...pending,
      repositories: [
        {
          rig: {
            error: { code: 'gas_city_registration_failed', message: 'Gas City is unavailable.' },
            retry: { attemptCount: 2, nextAttemptAt: '2026-08-12T10:00:00.000Z' },
          },
        },
      ],
    }
    expect(provisioningHeading(retrying)).toBe('Repository setup will retry automatically')
    expect(provisioningMessage(retrying, 'Raspberry Pi')).toBe('Gas City is unavailable.')

    expect(
      provisioningHeading({
        ...retrying,
        repositories: [{ rig: { ...retrying.repositories[0]!.rig, retry: null } }],
      }),
    ).toBe('Retrying repository setup…')
  })

  it('uses the terminal setup error after retries are exhausted', () => {
    const failed = {
      setupState: 'needs_attention' as const,
      setupError: { code: 'repository_index_dirty', message: 'Review the staged files.' },
      repositories: [
        {
          rig: {
            error: { code: 'repository_index_dirty', message: 'Review the staged files.' },
            retry: null,
          },
        },
      ],
    }
    expect(provisioningHeading(failed)).toBe('Repository setup needs attention')
    expect(provisioningMessage(failed, 'Raspberry Pi')).toBe('Review the staged files.')
  })
})
