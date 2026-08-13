-- Gas City transcript sequences restart when Factoru rotates the external
-- conversation identity. Preserve content parts while moving sequence
-- uniqueness from the stable Factoru conversation to one context revision.

CREATE TABLE conversation_content_parts_context_migration AS
SELECT * FROM conversation_content_parts;

DROP TABLE conversation_content_parts;

CREATE TABLE conversation_messages_context_migration (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT REFERENCES conversation_turns(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  author_display_name TEXT NOT NULL,
  in_reply_to_message_id TEXT,
  gas_city_sequence INTEGER CHECK (gas_city_sequence IS NULL OR gas_city_sequence > 0),
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('pending', 'delivered', 'failed')),
  state TEXT NOT NULL DEFAULT 'completed' CHECK (
    state IN ('pending', 'streaming', 'completed', 'cancelling', 'cancelled', 'failed')
  ),
  content_version INTEGER NOT NULL DEFAULT 1 CHECK (content_version > 0),
  token_input INTEGER CHECK (token_input IS NULL OR token_input >= 0),
  token_output INTEGER CHECK (token_output IS NULL OR token_output >= 0),
  tool_activity_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  context_revision INTEGER NOT NULL DEFAULT 1 CHECK (context_revision > 0),
  UNIQUE (conversation_id, context_revision, gas_city_sequence)
);

INSERT INTO conversation_messages_context_migration(
  id, conversation_id, turn_id, role, text, author_display_name,
  in_reply_to_message_id, gas_city_sequence, delivery_state, state,
  content_version, token_input, token_output, tool_activity_json,
  created_at, updated_at, context_revision
)
SELECT
  id, conversation_id, turn_id, role, text, author_display_name,
  in_reply_to_message_id, gas_city_sequence, delivery_state, state,
  content_version, token_input, token_output, tool_activity_json,
  created_at, updated_at, context_revision
FROM conversation_messages;

DROP TABLE conversation_messages;
ALTER TABLE conversation_messages_context_migration RENAME TO conversation_messages;

CREATE INDEX conversation_messages_order
  ON conversation_messages(conversation_id, created_at, id);
CREATE INDEX conversation_messages_context
  ON conversation_messages(conversation_id, context_revision, created_at, id);

CREATE TABLE conversation_content_parts (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES conversation_messages(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'tool')),
  text_content TEXT,
  artifact_id TEXT REFERENCES conversation_artifacts(id) ON DELETE RESTRICT,
  tool_name TEXT,
  tool_status TEXT CHECK (tool_status IS NULL OR tool_status IN ('running', 'completed', 'failed')),
  tool_summary TEXT,
  tool_started_at TEXT,
  tool_finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (message_id, ordinal),
  CHECK (
    (kind = 'text' AND text_content IS NOT NULL AND artifact_id IS NULL AND tool_name IS NULL) OR
    (kind = 'image' AND artifact_id IS NOT NULL AND text_content IS NULL AND tool_name IS NULL) OR
    (kind = 'tool' AND tool_name IS NOT NULL AND text_content IS NULL AND artifact_id IS NULL)
  )
);

INSERT INTO conversation_content_parts(
  id, message_id, ordinal, kind, text_content, artifact_id, tool_name,
  tool_status, tool_summary, tool_started_at, tool_finished_at, created_at, updated_at
)
SELECT
  id, message_id, ordinal, kind, text_content, artifact_id, tool_name,
  tool_status, tool_summary, tool_started_at, tool_finished_at, created_at, updated_at
FROM conversation_content_parts_context_migration;

DROP TABLE conversation_content_parts_context_migration;
