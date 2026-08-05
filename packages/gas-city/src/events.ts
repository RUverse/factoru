import { z } from 'zod'

/**
 * City event consumption with a durable cursor.
 *
 * Gas City events are immutable and carry a monotonically increasing `seq`.
 * That sequence is the entire recovery story: Factoru persists the last
 * sequence it has fully handled, and after any restart — its own, the
 * supervisor's, or the machine's — it resumes from that number instead of
 * replaying history or silently skipping the gap.
 *
 * Delivery is at-least-once. The stream may re-send an event Factoru already
 * handled, so consumers must be idempotent and the cursor must only advance
 * past an event once its effect is durable.
 */

export const cityEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.string(),
  ts: z.string(),
  actor: z.string().optional(),
  subject: z.string().optional(),
  payload: z.unknown().optional(),
})

/** One observation from a Gas City city, validated at the adapter boundary. */
export type CityEvent = z.infer<typeof cityEventSchema>

/**
 * One page from `GET /v0/city/{city}/events`.
 *
 * `items` is nullable in the 1.4.0 contract (`type: ["array","null"]`), not
 * merely absent, so it is coerced rather than defaulted — a Zod `.default()`
 * only fires for `undefined` and would reject an explicit `null`.
 */
export const cityEventPageSchema = z.object({
  items: z
    .array(cityEventSchema)
    .nullish()
    .transform((items) => items ?? []),
  total: z.number().int().optional(),
  /**
   * Opaque pagination token. Used only to walk further back within a single
   * read; never persisted as Factoru's resume point.
   */
  next_cursor: z.string().optional(),
})

/**
 * A cursor Factoru can persist and resume from.
 *
 * Only the sequence number is stored. The supervisor also returns an opaque
 * `next_cursor` token, but Factoru deliberately does not persist that: an
 * opaque token has no defined lifetime across supervisor restarts or version
 * changes, whereas `seq` is a property of the event itself and stays
 * meaningful.
 *
 * Note that the paginated `GET /events` endpoint has **no `after_seq`
 * parameter** — only `/events/stream` does. Backfill therefore pages backwards
 * from the head using `next_cursor` until it reaches this sequence; see
 * `GasCityAdapter.readEvents`.
 */
export interface EventCursor {
  /** Highest sequence whose effects are durably applied. */
  readonly lastHandledSeq: number
}

/** The starting cursor for a city Factoru has never observed. */
export const INITIAL_EVENT_CURSOR: EventCursor = { lastHandledSeq: 0 }

/**
 * Drop events at or below the cursor and return the events still to handle,
 * in ascending sequence order.
 *
 * The supervisor returns events newest-first, and may redeliver. Both are
 * handled here so consumers see a simple ascending, already-deduplicated list.
 */
export function selectUnhandledEvents(
  events: readonly CityEvent[],
  cursor: EventCursor,
): CityEvent[] {
  const seen = new Set<number>()
  return events
    .filter((event) => {
      if (event.seq <= cursor.lastHandledSeq) return false
      if (seen.has(event.seq)) return false
      seen.add(event.seq)
      return true
    })
    .sort((a, b) => a.seq - b.seq)
}

/**
 * Advance a cursor past a batch of handled events.
 *
 * The cursor never moves backwards. A late duplicate of an older event must not
 * rewind progress and cause everything after it to be replayed.
 */
export function advanceCursor(cursor: EventCursor, handled: readonly CityEvent[]): EventCursor {
  let next = cursor.lastHandledSeq
  for (const event of handled) {
    if (event.seq > next) next = event.seq
  }
  return { lastHandledSeq: next }
}

/**
 * Whether the oldest event available is newer than the cursor expects.
 *
 * This is only meaningful once the caller has exhausted pagination. Mid-read it
 * is simply a page boundary: more history exists, it just has not been fetched
 * yet. Calling this on one page and treating the answer as a gap would report a
 * dropped-history emergency every time a backlog exceeded one page.
 *
 * A true gap means events were lost — usually because the city's event log was
 * rotated while Factoru was down. It is not recoverable by reading further, so
 * the caller must reconcile authoritative state rather than pretend its
 * projection is continuous.
 */
export function hasSequenceGap(
  oldestAvailableSeq: number | undefined,
  cursor: EventCursor,
): boolean {
  if (oldestAvailableSeq === undefined) return false
  return oldestAvailableSeq > cursor.lastHandledSeq + 1
}
