# Remote Linux source deployment over SSH

> **Developer preview:** Factoru does not have a packaged Server or signed
> Desktop release yet. This runbook uses a source checkout of `dev`, a manual
> tmux session, and an operator-maintained SSH tunnel. Linux arm64—including
> Raspberry Pi OS 64-bit—has not completed Factoru's end-to-end acceptance
> matrix. Use disposable repositories and test state.

This is the shortest secure path for testing Factoru Server on a separate
64-bit Linux machine. Factoru Server, the Gas City supervisor, agent tools, and
Dolt all remain on the remote host's loopback interface. SSH encrypts the only
network leg, and Factoru Desktop connects to a local forwarded port.

The preview targets:

- Raspberry Pi OS, Debian, or Ubuntu on Linux `arm64`/`aarch64` or `x86_64`;
- one unprivileged Linux account for Factoru, Gas City, and the provider CLI;
- a stable Factoru checkout and a separate directory for repositories; and
- either the Codex or Claude harness, installed and authenticated as that same
  account; and
- a Debian-family account with `sudo` permission when base OS packages are
  missing.

It does not support 32-bit Raspberry Pi OS, automatic startup after reboot,
schema-aware rollback, or a production restore workflow.

## 1. Prepare the Linux host

Connect over SSH and confirm that the OS is 64-bit:

```sh
uname -s
uname -m
```

Continue only when the output is Linux plus `aarch64`, `arm64`, or `x86_64`.
Install and authenticate either Codex or Claude as this account, using
`codex login` or `claude auth login`. Provider authentication is deliberately
not automated because it grants access to the operator's account.

The Factoru bootstrap installs the remaining OS and runtime prerequisites. The
only unavoidable pre-bootstrap tools are Git plus SSH access for the private
checkout and the authenticated provider CLI.

Gas City publishes both Linux arm64 and amd64 archives. A published binary is
not proof that the full Factoru chain is dependable on a Raspberry Pi; this
runbook is how that evidence will be collected.

## 2. Install the latest Factoru `dev`

Use a dedicated deployment checkout. Replace the repository URL if your clone
uses another authenticated remote:

```sh
git clone --branch dev git@github.com:RUverse/factoru.git "$HOME/factoru"
cd "$HOME/factoru"
./scripts/remote-bootstrap.sh --provider codex
```

Use `--provider claude` instead when Claude is the selected harness. This is the
one initial setup command after cloning. It is safe to rerun: compatible tools
are kept, while missing or incompatible managed tools are replaced by the
pinned releases. It:

- installs missing Debian-family packages through `sudo apt-get`;
- installs the repository-pinned Node and pnpm under
  `$HOME/.local/share/factoru` without replacing a system toolchain;
- downloads checksum-pinned Linux arm64/x64 releases of Gas City, Dolt, and
  Beads into that same user-owned tool directory;
- installs the frozen workspace and creates `$HOME/factoru-repositories`; and
- runs the complete provider-selected preflight.

The bootstrap refuses root, 32-bit/unsupported hosts, non-`dev` branches, dirty
deployment checkouts, and failed artifact checksums. It may prompt for `sudo`
only when base operating-system packages are missing. It does not start Server
or Gas City and does not create Factoru identity, database, or city state.

The final preflight is read-only with respect to Factoru state. It builds the
Server dependency graph, then checks Linux architecture, the repository's
Node/pnpm pins, Gas City and its dependency versions, provider login, and
reports memory and free storage. Every failure includes a remedy.

Keep project repositories outside the Factoru checkout. Gas City rig
registration creates Beads metadata and may commit it, so start with a clean,
disposable Git repository while validating this preview.
Do not move or delete the Factoru checkout: its path owns the development state,
server identity, and derived port block.

## 3. Start Server and Gas City

Create a named tmux session:

```sh
tmux new -s factoru-server
```

Inside it, start the development Server with only the dedicated repository root
approved for project onboarding:

```sh
cd "$HOME/factoru"
FACTORU_TRUST_PROXY= \
  FACTORU_REPOSITORY_ROOTS="[\"$HOME/factoru-repositories\"]" \
  pnpm dev:server
```

Wait until Factoru prints its server URL and state directory. Detach with
<kbd>Ctrl-b</kbd>, then <kbd>d</kbd>; do not stop the process.

In another SSH shell, initialize the dedicated Gas City city. The selected
provider must already be authenticated:

```sh
cd "$HOME/factoru"
pnpm dev:city --provider codex
```

This command is idempotent for the same checkout and server identity. It pins
the Factoru pack and starts the Factoru city without taking ownership of
unrelated cities on the host.

Print the actual development URL and port:

```sh
pnpm dev:env
```

Development ports are derived from the checkout path and may move to another
free block after a collision. Never assume port 8787 for this path.

Check health locally, replacing the URL with the one printed above:

```sh
curl --fail http://127.0.0.1:SERVER_PORT/api/v1/health
```

Finally, create a ten-minute, one-time pairing code:

```sh
pnpm dev:pair
```

## 4. Open the SSH tunnel from the Mac

Keep this command running in a Mac terminal. Replace `SERVER_PORT`, user, and
host with the values for the Linux machine:

```sh
ssh -N -L 18787:127.0.0.1:SERVER_PORT user@server
```

Port 18787 is only the Mac-side endpoint and may be changed if already in use.
The remote target must remain the exact loopback Factoru port. Do not forward
Gas City port 8372, any Gas City dashboard/controller, agent-tool endpoint, or
Dolt listener.

Factoru Desktop is also source-only today. In a Factoru checkout on the Mac:

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

Choose **Remote server** and enter:

- server address: `http://127.0.0.1:18787`;
- the code from `pnpm dev:pair`; and
- a name for the Mac.

Plain HTTP is acceptable only because both HTTP endpoints are loopback and SSH
encrypts the traffic between machines. Never enter `http://<remote-host>` or
bind Factoru to `0.0.0.0`; Server configuration rejects non-loopback binding.
Do not set `FACTORU_TRUST_PROXY` for the SSH path.

## 5. Prove the full loop

Use a disposable repository under `$HOME/factoru-repositories`, or give Factoru
an HTTPS/SSH repository URL to clone below that approved root. Then:

1. Create and open a project.
2. In **Workers**, configure Project Manager `chat` and `planning`, plus
   Software Engineer `implementation` and `review`, using the provider/model
   available on the Linux host.
3. Add a small Backlog task and move it to Queue.
4. Observe Queue planning, `in_progress`, deterministic checks, independent
   review, and the final `needs_you` package.
5. Approve or archive only after inspecting the diff and evidence.

This successful journey is required before Linux arm64 or Raspberry Pi support
can be promoted from `Validate`.

## 6. Verify the trust boundary

On the Linux host, inspect listeners:

```sh
ss -ltnp
```

Factoru, Gas City, its managed city/controller, agent tools, and Dolt must show
only `127.0.0.1`, `::1`, or equivalent host-local sockets. Stop immediately if
one is listening on `0.0.0.0`, `::`, or a LAN address. Only SSH should be
reachable from the Mac.

The SSH tunnel must stay open while Desktop is connected. If it drops, Desktop
shows cached state and reconnects after the same forward is restored. After a
Linux reboot, restart the Factoru tmux session and rerun the idempotent
`pnpm dev:city --provider ...` command before reconnecting.

Useful diagnostics:

```sh
tmux attach -t factoru-server
pnpm dev:env
pnpm remote:preflight -- --provider codex
gc version
dolt version
bd version
```

Common failures:

- **Preflight rejects `arm` or `ia32`:** install a 64-bit Linux image.
- **Bootstrap refuses a dirty checkout:** preserve or remove the reported local
  changes; the deployment checkout is not a working repository.
- **Bootstrap cannot use `sudo`:** install the listed Debian base packages as
  an administrator, then rerun it as the Factoru user.
- **A download or checksum fails:** do not bypass verification; confirm network
  access and rerun the same bootstrap command.
- **Provider authentication fails:** log in as the same unprivileged account
  that runs Factoru and Gas City.
- **`pnpm dev:city` refuses initialization:** resolve every reported Gas City,
  Dolt, Beads, or provider-readiness finding, then rerun it.
- **Mac port 18787 is occupied:** choose another unused Mac-side port and enter
  that port in Desktop.
- **Pairing code expired:** run `pnpm dev:pair` again; codes are one-time and
  valid for ten minutes.

## 7. Deploy a newer `dev` commit

Do not update while a task or Queue planner is active. Finish or cancel the work
and confirm the deployment checkout is clean:

```sh
cd "$HOME/factoru"
git status --short --branch
git rev-parse HEAD
test -z "$(git status --porcelain)" || {
  echo "Stop: the deployment checkout has local changes."
  exit 1
}
```

Attach to `factoru-server`, stop it with <kbd>Ctrl-c</kbd>, and leave the tmux
shell open. Export the same development environment and create a new verified
SQLite backup at an absolute path:

```sh
cd "$HOME/factoru"
eval "$(pnpm dev:env --export)"
mkdir -p "$HOME/factoru-backups"
pnpm --filter @factoru/server start backup \
  "$HOME/factoru-backups/factoru-before-update.sqlite"
```

The backup command refuses to overwrite an existing file. Give each backup a
new name when repeating this procedure.

Fetch and fast-forward only; never reset a deployment checkout with user
changes:

```sh
git fetch origin dev
git merge --ff-only origin/dev
./scripts/remote-bootstrap.sh --provider codex
pnpm check
git rev-parse HEAD
```

The bootstrap is idempotent and performs the frozen install plus preflight, so
the update path does not repeat manual host dependency steps. Keep `pnpm check`
as the separate source-verification gate. Use `--provider claude` consistently
when that is the deployed harness.

Return to the existing `factoru-server` tmux shell and start the same Server
command from section 3. Rerun `pnpm dev:city --provider codex`, then check the
health endpoint and reconnect the tunnel. The health response must report the
same `serverId`, and the same projects should reappear.

Factoru migrations are forward-only. Although the SQLite backup is verified at
creation time, packaged restore and coordinated Gas City/Dolt recovery are
unfinished Milestone 7 work. Do not assume that checking out an older commit is
a safe rollback after a migration; keep this preview on disposable state.

## HTTPS alternative

For a persistent connection that does not require an SSH process, terminate
HTTPS with a trusted private overlay or loopback reverse proxy on the server
host and forward only Factoru to its loopback port. Enable
`FACTORU_TRUST_PROXY=loopback`, preserve WebSocket upgrades, original HTTPS
protocol, and client IP, and use the HTTPS hostname in Desktop. Never proxy Gas
City or Dolt. Native Factoru certificate management remains deferred.
