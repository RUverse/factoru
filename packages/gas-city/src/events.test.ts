import { describe, expect, it } from 'vitest'

import {
  advanceCursor,
  cityEventPageSchema,
  hasSequenceGap,
  INITIAL_EVENT_CURSOR,
  selectUnhandledEvents,
  type CityEvent,
} from './events.js'

const event = (seq: number, type = 'bead.closed'): CityEvent => ({
  seq,
  type,
  ts: '2026-08-05T09:41:27.159145+02:00',
  actor: 'controller',
})

describe('cityEventPageSchema', () => {
  it('parses a real supervisor event page', () => {
    // Captured verbatim from GET /v0/city/{city}/events on Gas City 1.4.0.
    const page = cityEventPageSchema.parse({
      items: [
        {
          seq: 87,
          type: 'order.completed',
          ts: '2026-08-05T11:41:27.159145+02:00',
          actor: 'controller',
          subject: 'dolt-health',
          payload: {},
        },
      ],
      total: 87,
      next_cursor: 'v1:eyJrIjoic3EiLCJzIjo4M30',
    })

    expect(page.items[0]?.seq).toBe(87)
  })

  it('tolerates a page with no events', () => {
    expect(cityEventPageSchema.parse({}).items).toEqual([])
  })

  it('accepts an explicitly null items array', () => {
    // The 1.4.0 contract types every list as ["array","null"], and a Zod
    // .default() would only cover undefined — an explicit null would throw.
    expect(cityEventPageSchema.parse({ items: null }).items).toEqual([])
  })
})

describe('selectUnhandledEvents', () => {
  it('returns events after the cursor in ascending order', () => {
    // The supervisor returns newest-first; consumers want oldest-first.
    const selected = selectUnhandledEvents([event(9), event(8), event(7)], { lastHandledSeq: 7 })

    expect(selected.map((e) => e.seq)).toEqual([8, 9])
  })

  it('drops redelivered events the cursor has already passed', () => {
    // Delivery is at-least-once, so this is the normal case after a reconnect.
    expect(selectUnhandledEvents([event(5), event(6)], { lastHandledSeq: 6 })).toEqual([])
  })

  it('deduplicates a sequence delivered twice in one batch', () => {
    const selected = selectUnhandledEvents([event(4), event(4), event(5)], INITIAL_EVENT_CURSOR)

    expect(selected.map((e) => e.seq)).toEqual([4, 5])
  })
})

describe('advanceCursor', () => {
  it('moves to the highest handled sequence', () => {
    expect(advanceCursor(INITIAL_EVENT_CURSOR, [event(3), event(7), event(5)])).toEqual({
      lastHandledSeq: 7,
    })
  })

  it('never rewinds on a late duplicate of an older event', () => {
    // Rewinding would replay everything after it, which for a side-effecting
    // reactor is far worse than skipping a redelivery.
    expect(advanceCursor({ lastHandledSeq: 10 }, [event(4)])).toEqual({ lastHandledSeq: 10 })
  })

  it('is unchanged by an empty batch', () => {
    expect(advanceCursor({ lastHandledSeq: 10 }, [])).toEqual({ lastHandledSeq: 10 })
  })
})

describe('hasSequenceGap', () => {
  it('detects events lost between the cursor and the oldest retained event', () => {
    // Seq 5 was handled and the oldest event still available is 9: 6-8 are
    // gone, typically because the city's event log rotated while Factoru was
    // down. This is only a valid conclusion once pagination is exhausted.
    expect(hasSequenceGap(9, { lastHandledSeq: 5 })).toBe(true)
  })

  it('reports no gap for a contiguous resume', () => {
    expect(hasSequenceGap(6, { lastHandledSeq: 5 })).toBe(false)
  })

  it('reports no gap when the oldest available event is already handled', () => {
    expect(hasSequenceGap(3, { lastHandledSeq: 5 })).toBe(false)
  })

  it('reports no gap when nothing is available', () => {
    expect(hasSequenceGap(undefined, { lastHandledSeq: 5 })).toBe(false)
  })
})
