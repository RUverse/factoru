import { z } from 'zod'

/**
 * Gas City reports failures as RFC 9457 Problem Details with a stable machine
 * identifier: a `type` URN of the form `urn:gascity:error:<code>` plus a
 * convenience `code` member. Factoru branches on the code, never on the title
 * or detail text, both of which are prose that may be reworded.
 */
export const gasCityProblemSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().int().optional(),
  detail: z.string().optional(),
  code: z.string().optional(),
  errors: z
    .array(
      z.object({
        message: z.string().optional(),
        location: z.string().optional(),
      }),
    )
    .optional(),
})

export type GasCityProblem = z.infer<typeof gasCityProblemSchema>

/**
 * How Factoru should react to a failure, decided at the adapter boundary so
 * product code never re-derives it from HTTP status codes.
 */
export type GasCityFailureKind =
  /** The request itself is wrong. Retrying it unchanged cannot help. */
  | 'invalid_request'
  /** Gas City rejected the caller. Configuration or credentials must change. */
  | 'unauthorized'
  /** The named city, rig, formula, run, or bead does not exist. */
  | 'not_found'
  /** State moved underneath the request. Re-read, then decide again. */
  | 'conflict'
  /** Gas City is reachable but not ready. Retrying later is reasonable. */
  | 'unavailable'
  /** The transport failed. Retrying is reasonable. */
  | 'transport'
  /** Gas City failed in a way Factoru has no specific handling for. */
  | 'internal'

/** A failure from Gas City, normalised into Factoru's vocabulary. */
export class GasCityError extends Error {
  readonly kind: GasCityFailureKind
  /** Stable Gas City error code, when it supplied one. */
  readonly code: string | undefined
  readonly status: number | undefined
  /** Gas City's request identifier, captured for diagnostics. */
  readonly requestId: string | undefined
  /** Whether Factoru may retry the identical request. */
  readonly retryable: boolean

  constructor(
    message: string,
    options: {
      kind: GasCityFailureKind
      code?: string | undefined
      status?: number | undefined
      requestId?: string | undefined
      cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'GasCityError'
    this.kind = options.kind
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.retryable = options.kind === 'unavailable' || options.kind === 'transport'
  }
}

/**
 * Map an HTTP status onto a failure kind.
 *
 * 409 is deliberately not retryable. Gas City returns it when something already
 * exists or has moved on, and repeating the same request just produces the same
 * conflict; the caller has to re-read and decide.
 */
export function failureKindForStatus(status: number): GasCityFailureKind {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not_found'
  if (status === 409) return 'conflict'
  if (status === 422 || status === 400) return 'invalid_request'
  if (status === 503) return 'unavailable'
  if (status >= 500) return 'internal'
  if (status >= 400) return 'invalid_request'
  return 'internal'
}

/** Build a `GasCityError` from a supervisor response body and status. */
export function problemToError(
  status: number,
  body: unknown,
  requestId?: string | undefined,
): GasCityError {
  const parsed = gasCityProblemSchema.safeParse(body)
  const problem = parsed.success ? parsed.data : undefined

  // Prefer the explicit `code`; fall back to the URN suffix when only `type`
  // is present, since both carry the same stable identifier.
  const code = problem?.code ?? extractCodeFromType(problem?.type)

  const detail = problem?.detail ?? problem?.title
  const fieldErrors = (problem?.errors ?? [])
    .map((e) => e.message)
    .filter((m): m is string => Boolean(m))

  const message = [detail ?? `Gas City request failed with status ${status}`, ...fieldErrors].join(
    '; ',
  )

  return new GasCityError(message, {
    kind: failureKindForStatus(status),
    code,
    status,
    requestId,
  })
}

function extractCodeFromType(type: string | undefined): string | undefined {
  if (!type) return undefined
  const prefix = 'urn:gascity:error:'
  return type.startsWith(prefix) ? type.slice(prefix.length) : undefined
}
