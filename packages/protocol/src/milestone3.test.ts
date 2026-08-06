import { describe, expect, it } from 'vitest'
import {
  factorySettingsSchema,
  memoryAddParamsSchema,
  modelBindingSchema,
  modelBindingUpdateParamsSchema,
  workspaceSchema,
} from './milestone3.js'

describe('Milestone 3 protocol', () => {
  it('keeps Factory capacity locked to one', () => {
    expect(
      factorySettingsSchema.safeParse({
        templateId: 'software-project',
        templateVersion: 1,
        maxParallelImplementationWorkers: 2,
      }).success,
    ).toBe(false)
  })

  it('requires provider and model to be configured together', () => {
    expect(
      modelBindingSchema.safeParse({
        slot: 'chat',
        provider: 'anthropic',
        model: null,
        version: 1,
      }).success,
    ).toBe(false)
    expect(
      modelBindingUpdateParamsSchema.parse({
        projectId: 'prj_1',
        workerTypeKind: 'project_manager',
        slot: 'chat',
        provider: null,
        model: null,
      }),
    ).toBeDefined()
  })

  it('requires explicit provenance for a memory write', () => {
    expect(
      memoryAddParamsSchema.safeParse({
        projectId: 'prj_1',
        scope: 'project',
        content: 'Use pnpm.',
      }).success,
    ).toBe(false)
  })

  it('rejects an incomplete workspace projection', () => {
    expect(workspaceSchema.safeParse({ projectId: 'prj_1' }).success).toBe(false)
  })
})
