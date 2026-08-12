# `@factoru/database`

Factoru Server's SQLite boundary. It owns forward-only migrations,
WAL/foreign-key connection policy, transactional command
receipts/events/outbox writes, trusted devices, durable projects, Factory
settings, Blueprint/project/task workflow selection, Team model slots,
immutable Formula Run snapshots, rich Project Manager turns/content parts and
stream cursors, non-destructive context revisions and durable chat-history
entries with context-scoped paging, opaque artifact
metadata/delivery grants, provenance-aware
memory, and serialized planner probes. Migration 0012 adds recoverable native
run projections with independent Gas City and Factoru cursors, normalized
stages/dependencies/convoy units/sessions/transcripts/reviews, bounded artifact
storage, projection completeness and retry budgets, task evidence and
supersession/split history, validated resource intent, duplicate-decision
audits, approval-gated memory proposals, and immutable admitted-run memory
snapshots. Conversation artifact bytes remain outside SQLite; bounded run
artifact bytes are stored as opaque project/run-scoped records. Only server-side
code may import this package.
