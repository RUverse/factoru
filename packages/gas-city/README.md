# `@factoru/gas-city`

Factoru's server-only orchestration port over the pinned Gas City 1.4 runtime.
It owns compatibility/readiness checks, configured-provider model discovery,
project runtime configuration, rig registration, Project Manager messaging,
Formula validation and launch, run observation/cancellation, event cursors, and
usage folding.

Gas City request/response shapes stay inside this package. Product code receives
Factoru-owned types, including the browser-safe provider/model catalog derived
from `GET /v0/city/{cityName}/providers/public`; provider commands, flags,
environment, option implementations, and credentials are never projected to
Desktop.

The real integration boundary and its remaining validation work are tracked in
[docs/ARCHITECTURE.md](../../docs/ARCHITECTURE.md) and the
[Milestone 1 gate record](../../docs/spikes/milestone-1-gas-city-gate.md).
