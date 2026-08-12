# `@factoru/database`

Factoru Server's SQLite boundary. It owns forward-only migrations,
WAL/foreign-key connection policy, transactional command
receipts/events/outbox writes, trusted devices, durable projects, Factory
settings, Blueprint/project/task workflow selection, Team model slots,
immutable Formula Run snapshots, rich Project Manager turns/content parts and
stream cursors, non-destructive context revisions and durable chat-history
entries with context-scoped paging, opaque artifact
metadata/delivery grants, provenance-aware
memory, and serialized planner probes. Binary artifact bytes remain outside
SQLite. Only server-side code may import this package.
