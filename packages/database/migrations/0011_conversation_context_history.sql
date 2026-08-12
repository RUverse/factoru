-- Contexts are durable chat-history entries, including contexts that contain no
-- messages. Messages continue to carry the revision used for scoped paging.

CREATE TABLE conversation_contexts (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision > 0),
  started_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, revision)
);

INSERT INTO conversation_contexts(conversation_id, revision, started_at)
SELECT id, 1, created_at FROM conversations;

INSERT OR IGNORE INTO conversation_contexts(conversation_id, revision, started_at)
SELECT id, context_revision, COALESCE(context_started_at, created_at)
FROM conversations
WHERE context_revision > 1;
