-- A context reset preserves Factoru's durable transcript while rotating the
-- Gas City conversation/session context used by subsequent user turns.

ALTER TABLE conversations ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 1
  CHECK (context_revision > 0);
ALTER TABLE conversations ADD COLUMN context_started_at TEXT;

UPDATE conversations SET context_started_at = created_at;

ALTER TABLE conversation_turns ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 1
  CHECK (context_revision > 0);
ALTER TABLE conversation_messages ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 1
  CHECK (context_revision > 0);

CREATE INDEX conversation_messages_context
  ON conversation_messages(conversation_id, context_revision, created_at, id);
