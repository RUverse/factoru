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

export const cityEventPageSchema = z.object({
  items: z.array(cityEventSchema).default([]),
  total: z.number().int().optional(),
  next_cursor: z.string().optional(),
})

/**
 * A cursor Factoru can persist and resume from.
 *
 * Only the sequence number is stored. The supervisor also returns an opaque
 * `next_cursor` token, but Factoru deliberately does not persist that: an
 * opaque token has no defined lifetime across supervisor restarts or version
 * changes, whereas `seq` is a property of the event itself and stays
 * meaningful. The `after_seq` parameter accepts it directly.
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
 * Whether a gap exists between the cursor and the oldest event received.
 *
 * A gap means events were dropped — usually because the city's event log was
 * rotated while Factoru was down. It is not recoverable by reading further, so
 * the caller must reconcile authoritative state instead of pretending its
 * projection is continuous.
 */
export function hasSequenceGap(events: readonly CityEvent[], cursor: EventCursor): boolean {
  if (events.length === 0) return false
  const oldest = Math.min(...events.map((event) => event.seq))
  return oldest > cursor.lastHandledSeq + 1
}
