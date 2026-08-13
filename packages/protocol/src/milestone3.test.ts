import { describe, expect, it } from 'vitest'
import {
  factorySettingsSchema,
  memoryAddParamsSchema,
  modelBindingSchema,
  modelBindingUpdateParamsSchema,
  modelCatalogSchema,
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

  it('normalizes a safe provider-backed model catalog', () => {
    expect(
      modelCatalogSchema.parse({
        status: 'ready',
        providers: [
          {
            id: 'codex',
            name: 'Codex',
            defaultModelId: 'gpt-5.5',
            models: [
              { id: 'gpt-5.5', name: 'GPT-5.5' },
              { id: 'gpt-5.4', name: 'GPT-5.4' },
            ],
          },
        ],
        message: null,
      }),
    ).toMatchObject({
      status: 'ready',
      providers: [expect.objectContaining({ id: 'codex', defaultModelId: 'gpt-5.5' })],
    })
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
