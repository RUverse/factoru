# 0010 — Factoru installs its own agent tools from `session_setup_script`

**Status:** Accepted (production path connected in Milestone 4)
**Date:** 2026-08-05

## Context

Milestone 1 required proving "one minimal authenticated Factoru tool round trip
through both initial Claude and Codex harnesses" before prompts, tools, or
Worker Types could be treated as stable, and required comparing the candidate
mechanisms: provider hooks, `session_setup`/`session_setup_script`, overlays, and
a narrow local bridge.

Gas City 1.4.0 offers an apparent answer that does not work. A pack may declare
MCP servers in a well-known `mcp/` directory, and `gc mcp list --agent <name>`
reports a projection target for each harness:

```text
codex  -> <workdir>/.codex/config.toml
claude -> <workdir>/.mcp.json
```

That output looks exactly like success. It is not. With a pack `mcp/` entry in
place, an agent asked to call the tool replied:

> `factoru_probe` is not exposed in the tool set I can call.

No harness config file was written into the working directory at all. `gc mcp
list` describes a **planned** projection, not a materialised one. Separately,
every per-agent `mcp` attachment-list field is documented as a compatibility
tombstone "accepted but ignored by the active materializer".

## Decision

**Factoru installs its own agent tools from `session_setup_script`**, a
documented agent field whose commands run after session creation and whose
relative paths resolve against the pack directory.

`packs/factoru-default/assets/scripts/install-factoru-tools.sh` writes both
harness formats on every session start:

- `<workdir>/.mcp.json` for Claude Code
- `<workdir>/.codex/config.toml` for Codex

It writes both unconditionally. Gas City exposes no documented environment
variable naming the provider, and writing a config the running harness ignores
costs nothing, whereas guessing wrong costs a silently missing tool — precisely
the failure this replaces.

Three properties matter more than the mechanism:

1. **The MCP command path is absolute**, resolved from the script's own location
   up to the pack root. The pack is installed into a content-addressed cache
   path nothing else can predict, and the harness launches the server with the
   *repository* as its working directory.
2. **The credential is minted per session** and never appears in the pack. This
   is the reason to prefer a script even if Gas City later fixes its projection:
   a pack `[env]` block can only carry a constant baked into a versioned,
   reviewable artifact, which Factoru's security rules forbid for credentials.
3. **The credential belongs to the server, not the agent.** The tool takes no
   token argument. The MCP server holds a scoped credential and, in production,
   presents it to Factoru Server on the agent's behalf. An earlier draft made
   the token a tool argument; that is wrong twice over, because a model cannot
   be handed a secret it is expected not to leak, and it makes the model the
   authenticated party rather than the session Factoru issued the credential to.

The server also projects its current bare HTTP loopback origin to
`<city>/.gc/factoru-server.json`. Gas City supplies the absolute city path as
`GC_CITY`, so session setup discovers isolated development ports and deployment
port changes without baking machine-local data into the pack. The projection is
non-secret, private (`0600`), schema-versioned, and recoverable from server
configuration. Setup rejects links, non-regular or group/world-accessible files,
and every non-loopback or path-bearing URL. A repository-local development
allocation and the stable `127.0.0.1:8787` origin remain compatibility fallbacks.

## Evidence

Both harnesses completed a real round trip against Gas City 1.4.0.

Codex, as `software-implementer`, invoked `factoru_probe` and reported the
bridge reachable. Claude, as `software-reviewer`, invoked
`mcp__factoru-probe__factoru_probe` and returned the response verbatim:

```json
{
  "ok": true,
  "project_id": "probe",
  "role": "probe/factoru.software-reviewer",
  "session_credential_present": true,
  "note": "claude-bridge",
  "message": "Factoru probe tool reached. This is fixed development data, not project state."
}
```

Each session rewrote the config with its own role and a distinct random token,
so per-session scoping and credential rotation are observed rather than assumed.

## Consequences

- Factoru Server exposes an internal, loopback-only endpoint for the setup
  process to obtain a short-lived credential. It validates Gas City rig and
  agent identifiers, binds the token to project, role, and session, and audits
  every authenticated tool call. The fixed-data probe was replaced by the real
  task gateway in Milestone 4.
- Factoru's city configurator owns the `.gc/factoru-server.json` projection and
  includes endpoint changes in its idempotent reload decision. It is deployment
  state, not a second source of truth; the bound server configuration remains
  authoritative.
- The setup script writes files into the user's repository working directory
  (`.mcp.json`, `.codex/config.toml`). Registration already discloses Gas City's
  repository mutations ([ADR 0009](./0009-rig-registration-safety.md)); this
  list must grow to include Factoru's own, and both belong in `.gitignore`.
- Worker Type tool policy becomes a property of what the setup script installs
  per role, which is a Factoru-owned decision rather than a Gas City one. That
  is the outcome the architecture wanted: one stable role-scoped tool contract
  above harness-specific mechanisms.
- Revocation is per session: a credential dies with the session that owns it.
  Revoking mid-session requires Factoru Server to reject the credential, which
  is why authentication must terminate at Factoru Server and not at the MCP
  server.
- Factoru must not rely on the pack `mcp/` directory. It is kept out of
  `factoru-default` deliberately, so nothing suggests a delivery path that does
  not run.

## Revisit when

- Gas City implements the `stage1` delivery its projection reports, at which
  point the pack `mcp/` directory becomes viable — though the per-session
  credential requirement would still argue for the script.
- A third harness is supported, which adds a config format to write.
- Tier-three container isolation lands, since the server would then run inside
  the capsule and the transport changes.
