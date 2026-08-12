#!/bin/sh
set -eu

if [ -z "${GC_PACK_DIR:-}" ]; then
  echo "gc factoru reply-current: missing Gas City pack context" >&2
  exit 1
fi

exec node "$GC_PACK_DIR/assets/reply-current.mjs" "$@"
