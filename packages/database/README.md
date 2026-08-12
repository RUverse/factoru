# `@factoru/database`

Factoru Server's SQLite boundary. It owns forward-only migrations,
WAL/foreign-key connection policy, transactional command
receipts/events/outbox writes, trusted devices, durable projects, Factory
settings, Blueprint/project/task workflow selection, Team model slots,
immutable Formula Run snapshots, Project Manager conversations/messages,
provenance-aware memory, and serialized planner probes. Only server-side code
may import this package.
