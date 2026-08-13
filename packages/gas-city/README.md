# `@factoru/gas-city`

Factoru's server-only orchestration port over the pinned Gas City 1.4 runtime.
It owns compatibility/readiness checks, configured-provider model discovery,
project runtime configuration, rig registration, Project Manager external
messaging and provider-neutral structured transcript projection,
provider-session closure for auditable Factoru context reset,
Formula validation and launch, run observation/cancellation, event cursors, and
usage folding.

Run usage is consumed from one server-owned, resumable city SSE stream. The
adapter validates event envelopes, ignores heartbeats as accounting input, and
normalizes token-bearing `worker.operation` events; the server persists cursors
and deltas atomically and falls back to structured session transcripts when the
pinned 1.4.0 runtime emits no token-bearing worker event. Disconnects, sequence
gaps, and unavailable transcript evidence preserve observed totals and expose
them as partial rather than final.

The production compatibility contract requires `/events/stream`, not the
unused city `/usage` or per-session stream endpoints. Project Manager delivery
continues to use its durable extmsg transcript cursor. Startup and operator
doctor checks validate configured providers and the OpenAPI document served by
the live supervisor; incompatible orchestration is paused without taking down
Factoru's API or stored history.

Pack reconciliation runs `gc import check` and `gc config show --validate`
before reload/start. Shipped Formula v2 files use canonical
`formulas/<name>.toml` paths, declare a Formula compiler requirement, and omit
the deprecated graph contract spelling. Gas City 1.4.0 rig patches deliberately
retain bare agent names.

Gas City request/response shapes stay inside this package. Product code receives
Factoru-owned types, including the browser-safe provider/model catalog derived
from `GET /v0/city/{cityName}/providers/public`; provider commands, flags,
environment, option implementations, and credentials are never projected to
Desktop.

The real integration boundary and its remaining validation work are tracked in
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) and the
[Milestone 1 gate record](../../docs/spikes/milestone-1-gas-city-gate.md), and
[Milestone 7 acceptance record](../../docs/spikes/milestone-7-acceptance.md).
