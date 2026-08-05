#!/usr/bin/env bash
#
# Install Factoru's agent tools into whichever harness this session is running.
#
# Gas City 1.4.0 scans a pack's `mcp/` directory and `gc mcp list` will happily
# report where the entry *would* go, but it does not write that config into a
# live session: an agent asked to call the tool reports it is not exposed, and
# no harness config file appears in the working directory. So Factoru performs
# the delivery itself from `session_setup_script`, which is documented and does
# run after session creation.
#
# Doing it here is better than waiting for Gas City to materialise the pack
# entry, for a reason that outlives the bug: a pack `[env]` block can only carry
# a constant baked into a versioned, reviewable artifact, and Factoru's rules
# forbid putting a credential there. A setup script runs per session, so it can
# install a credential that is short-lived and scoped to one project and role.
#
# Both harness formats are written unconditionally. Gas City exposes no
# documented environment variable naming the provider, and writing the config a
# harness does not read costs nothing, whereas guessing wrong costs a silent
# missing tool — the exact failure this script exists to fix.

set -euo pipefail

# Resolve the pack directory from this script's own location. The pack is
# installed into a content-addressed cache path that nothing else can predict,
# and the MCP command must be absolute because the harness launches it with the
# repository as its working directory, not the pack.
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pack_dir="$(cd "${script_dir}/../.." && pwd)"
server_path="${pack_dir}/assets/probe-tool/server.mjs"

if [ ! -f "${server_path}" ]; then
  echo "factoru: probe server missing at ${server_path}" >&2
  exit 1
fi

workdir="$(pwd)"

# Identify the session as precisely as the runtime allows. These are set by Gas
# City for its own hooks; empty values are tolerated because this is a probe,
# but a real deployment must fail closed rather than issue an unscoped
# credential.
session_id="${GC_SESSION_ID:-${GC_SESSION_NAME:-unknown-session}}"
agent_name="${GC_AGENT:-${GC_TEMPLATE:-unknown-agent}}"
rig_name="${GC_RIG:-unknown-rig}"

# A per-session credential. In production Factoru Server mints this, binds it to
# one project and role, and can revoke it; here it only has to be different
# every session and absent from the pack.
session_token="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# --- Claude Code: <workdir>/.mcp.json -------------------------------------
cat > "${workdir}/.mcp.json" <<JSON
{
  "mcpServers": {
    "factoru-probe": {
      "command": "node",
      "args": ["${server_path}"],
      "env": {
        "FACTORU_PROBE_TOKEN": "${session_token}",
        "FACTORU_PROBE_PROJECT": "${rig_name}",
        "FACTORU_PROBE_ROLE": "${agent_name}"
      }
    }
  }
}
JSON

# --- Codex: <workdir>/.codex/config.toml -----------------------------------
mkdir -p "${workdir}/.codex"
cat > "${workdir}/.codex/config.toml" <<TOML
[mcp_servers.factoru-probe]
command = "node"
args = ["${server_path}"]

[mcp_servers.factoru-probe.env]
FACTORU_PROBE_TOKEN = "${session_token}"
FACTORU_PROBE_PROJECT = "${rig_name}"
FACTORU_PROBE_ROLE = "${agent_name}"
TOML

echo "factoru: installed factoru-probe for session ${session_id} (rig ${rig_name}, agent ${agent_name})"
