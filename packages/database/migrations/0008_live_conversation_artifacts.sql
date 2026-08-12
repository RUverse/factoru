-- Milestone 7: durable rich turns, replaceable streaming projections, and
-- project/conversation-scoped image artifacts. Binary bytes remain outside SQLite.

ALTER TABLE conversations ADD COLUMN stream_cursor INTEGER NOT NULL DEFAULT 0
  CHECK (stream_cursor >= 0);

CREATE TABLE conversation_turns (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  gas_city_session_id TEXT,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'streaming', 'completed', 'cancelling', 'cancelled', 'failed')
  ),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (conversation_id, user_message_id)
);
CREATE INDEX conversation_turns_active
  ON conversation_turns(conversation_id, state, created_at);

ALTER TABLE conversation_messages RENAME TO conversation_messages_legacy;

CREATE TABLE conversation_messages (
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
  UNIQUE (conversation_id, gas_city_sequence)
);

INSERT INTO conversation_messages(
  id, conversation_id, role, text, author_display_name, in_reply_to_message_id,
  gas_city_sequence, delivery_state, state, token_input, token_output,
  tool_activity_json, created_at, updated_at
)
SELECT
  id, conversation_id, role, text, author_display_name, in_reply_to_message_id,
  gas_city_sequence, delivery_state,
  CASE delivery_state WHEN 'pending' THEN 'pending' WHEN 'failed' THEN 'failed' ELSE 'completed' END,
  token_input, token_output, tool_activity_json, created_at, created_at
FROM conversation_messages_legacy;

DROP TABLE conversation_messages_legacy;
CREATE INDEX conversation_messages_order
  ON conversation_messages(conversation_id, created_at, id);

INSERT INTO conversation_turns(
  id, conversation_id, user_message_id, assistant_message_id, state,
  created_at, updated_at, completed_at
)
SELECT
  'turn_' || substr(id, 5), conversation_id, id,
  (SELECT assistant.id FROM conversation_messages assistant
   WHERE assistant.conversation_id = user_message.conversation_id
     AND assistant.role = 'assistant' AND assistant.in_reply_to_message_id = user_message.id
   ORDER BY assistant.created_at LIMIT 1),
  CASE state WHEN 'failed' THEN 'failed' WHEN 'pending' THEN 'pending' ELSE 'completed' END,
  created_at, updated_at, CASE WHEN state = 'completed' THEN updated_at ELSE NULL END
FROM conversation_messages user_message WHERE role = 'user';

UPDATE conversation_messages
SET turn_id = 'turn_' || substr(id, 5)
WHERE role = 'user';

UPDATE conversation_messages
SET turn_id = (
  SELECT turn.id FROM conversation_turns turn
  WHERE turn.conversation_id = conversation_messages.conversation_id
    AND turn.user_message_id = conversation_messages.in_reply_to_message_id
)
WHERE role = 'assistant' AND in_reply_to_message_id IS NOT NULL;

CREATE TABLE conversation_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by_device_id TEXT NOT NULL REFERENCES trusted_devices(id) ON DELETE RESTRICT,
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/gif', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  width INTEGER NOT NULL CHECK (width > 0 AND width <= 8192),
  height INTEGER NOT NULL CHECK (height > 0 AND height <= 8192),
  provenance TEXT NOT NULL CHECK (provenance IN ('picker', 'paste', 'drop')),
  status TEXT NOT NULL CHECK (status IN ('ready', 'cancelled', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  retention_expires_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX conversation_artifacts_scope
  ON conversation_artifacts(project_id, conversation_id, status, created_at);

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
  id, message_id, ordinal, kind, text_content, created_at, updated_at
)
SELECT 'part_' || substr(id, 5), id, 0, 'text', text, created_at, updated_at
FROM conversation_messages WHERE length(text) > 0;

CREATE TABLE conversation_stream_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  turn_id TEXT,
  message_id TEXT,
  content_part_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE INDEX conversation_stream_events_replay
  ON conversation_stream_events(conversation_id, sequence);

CREATE TABLE artifact_delivery_grants (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES conversation_artifacts(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX artifact_delivery_grants_expiry
  ON artifact_delivery_grants(expires_at, used_at);
