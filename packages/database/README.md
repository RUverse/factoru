# `@factoru/database`

Factoru Server's SQLite boundary. It owns forward-only migrations, WAL/foreign-key
connection policy, transactional command receipts/events/outbox writes, trusted
devices, and durable projects. Only server-side code may import this package.
