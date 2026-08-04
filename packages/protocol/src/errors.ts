import { z } from 'zod'

/**
 * Structured error codes distinguish retryable transport problems from blocked
 * authentication, configuration, and compatibility states so the client's
 * connection runtime can choose between retrying and surfacing a decision.
 */
export const problemCodeSchema = z.enum([
  'invalid_request',
  'unsupported_protocol_version',
  'unauthorized',
  'not_found',
  'unavailable',
  'internal_error',
])

export type ProblemCode = z.infer<typeof problemCodeSchema>

export const problemSchema = z.object({
  error: z.object({
    code: problemCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
})

export type Problem = z.infer<typeof problemSchema>

/** Codes that only exist client-side, produced while talking to the server. */
export type ClientErrorCode = 'transport_error' | 'invalid_response' | 'timeout'

export type FactoruErrorCode = ProblemCode | ClientErrorCode

export class FactoruProtocolError extends Error {
  readonly code: FactoruErrorCode
  readonly status: number | undefined
  readonly details: unknown

  constructor(
    code: FactoruErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'FactoruProtocolError'
    this.code = code
    this.status = options.status
    this.details = options.details
  }

  /** Transport failures are worth retrying; the rest need a decision or a fix. */
  get retryable(): boolean {
    return this.code === 'transport_error' || this.code === 'timeout' || this.code === 'unavailable'
  }
}

export function problem(code: ProblemCode, message: string, details?: unknown): Problem {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } }
}
