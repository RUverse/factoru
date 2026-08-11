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
schema-aware rollback, or a production restore workflow. The installed command
is a launcher into the stable source checkout, not a packaged release; do not
move or delete the checkout.

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
- installs the frozen workspace and creates `$HOME/factoru-repositories`;
- installs the source-preview `factoru-server` operator command under
  `$HOME/.local/share/factoru/bin`; and
- runs the complete provider-selected preflight.

The bootstrap refuses root, 32-bit/unsupported hosts, non-`dev` branches, dirty
deployment checkouts, and failed artifact checksums. It may prompt for `sudo`
only when base operating-system packages are missing. It does not start Server
or Gas City and does not create Factoru identity, database, or city state.
Its final `Next:` line uses the absolute CLI path so it works in the current
shell. The bootstrap persists the shorter `factoru-server` command in both
`$HOME/.profile` for login shells and `$HOME/.bashrc` for interactive Bash/VS
Code terminals. A child installer cannot alter its already-open parent shell,
so the output also prints the one-time `Current shell:` export when needed.

The final preflight is read-only with respect to Factoru state. It builds the
Server dependency graph, then checks Linux architecture, the repository's
Node/pnpm pins, Gas City and its dependency versions, provider login, and
reports memory and free storage. Every failure includes a remedy.

Keep project repositories outside the Factoru checkout. Gas City rig
registration creates Beads metadata and may commit it, so start with a clean,
disposable Git repository while validating this preview.
Do not move or delete the Factoru checkout: its path owns the development state,
server identity, and derived port block.

## 3. Configure providers and start the services

Initialize Factoru's dedicated Gas City city with the authenticated harness:

```sh
factoru-server providers configure --provider codex
```

Use `--provider claude` instead, or repeat `--provider` and choose one default:

```sh
factoru-server providers configure \
  --provider claude --provider codex --default-provider codex
```

This creates the stable Factoru server identity, initializes the dedicated city,
pins and installs the Factoru pack, and starts that city. Provider login remains
provider-owned: use `codex login` or `claude auth login`; Factoru never captures
those credentials. On an existing city the command does not rewrite trusted
provider configuration. It starts the city and verifies the requested providers,
failing with a remedy when they are not configured.

Create a named tmux session:

```sh
tmux new -s factoru-server
```

Inside it, start the source Server in the foreground:

```sh
factoru-server start
```

The source launcher supplies the checkout's isolated state and allows projects
only below `$HOME/factoru-repositories` unless `FACTORU_REPOSITORY_ROOTS` is
explicitly set. Wait until Factoru prints its URL and state directory. Detach
with <kbd>Ctrl-b</kbd>, then <kbd>d</kbd>; do not stop the process.

In another SSH shell, print the actual URL, identity, city, process health, and
active Factoru work:

```sh
factoru-server status
```

Development ports are derived from the checkout path. Never assume port 8787
for this source path.

Finally, create a ten-minute, one-time pairing code and print the exact Mac-side
URL and SSH command. Replace the host with the SSH destination that works from
the Mac:

```sh
factoru-server pair --ssh-host rez@rez-pi
```

Use `--local-port <port>` when Mac port 18787 is occupied, or `--json` for
machine-readable output. Treat the pairing code as a short-lived secret.

## 4. Open the SSH tunnel from the Mac

Copy the `SSH tunnel` line printed by `factoru-server pair` and keep it running
in a Mac terminal. Its shape is:

```sh
ssh -N -L 18787:127.0.0.1:SERVER_PORT user@server
```

If the host requires a specific SSH identity, add the same option used for a
normal login, for example `ssh -i ~/.ssh/rez-pi -N -L ... user@server`. Prefer a
named `~/.ssh/config` host when the identity and address are used repeatedly.

Port 18787 is only the Mac-side endpoint and may be changed if already in use.
Give every concurrently connected remote server its own Mac-side loopback port
(for example 18788, 18789, and 18790). Factoru Desktop keeps independent live
connections and credentials keyed by stable server ID. Its project list can show
all factories together; selecting a project routes commands to that project's
authoritative home factory, while the factory list filters projects and manages
connections.
The remote target must remain the exact loopback Factoru port. Do not forward
Gas City port 8372, any Gas City dashboard/controller, agent-tool endpoint, or
Dolt listener.

Factoru Desktop is also source-only today. In a Factoru checkout on the Mac:

```sh
pnpm install --frozen-lockfile
pnpm dev:desktop
```

Choose **Remote server** and enter the `Desktop URL` and `Pairing code` printed
by the CLI, plus a name for the Mac. With the default local port these are:

- server address: `http://127.0.0.1:18787`;
- the code from `factoru-server pair`; and
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
`factoru-server providers configure --provider ...` command before reconnecting.

Useful diagnostics:

```sh
tmux attach -t factoru-server
factoru-server status
factoru-server status --json
factoru-server providers list
factoru-server sessions --active
factoru-server doctor --provider codex
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
- **Provider configuration refuses initialization:** resolve every reported Gas City,
  Dolt, Beads, or provider-readiness finding, then rerun it.
- **Mac port 18787 is occupied:** rerun `factoru-server pair` with
  `--local-port <unused-port>`, use that port in `ssh -L`, and enter its
  `http://127.0.0.1:<port>` URL in Desktop. Do not reuse one local port for two
  simultaneous tunnels.
- **Pairing code expired:** run `factoru-server pair --ssh-host <host>` again;
  codes are one-time and valid for ten minutes.
- **`factoru-server` is not found after reconnecting:** log out and back in so
  `$HOME/.profile` is loaded, or run
  `export PATH="$HOME/.local/share/factoru/bin:$PATH"`.

`factoru-server sessions` lists Factoru-correlated planning, Queue, and delivery
runs from Factoru's database. Gas City 1.4's stable supervisor contract does not
provide a global session-list operation, so the CLI deliberately does not scrape
human-readable `gc` or tmux output or claim to enumerate unrelated
provider-native sessions.

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

Confirm `factoru-server sessions --active` is empty. Attach to
`factoru-server`, stop it with <kbd>Ctrl-c</kbd>, and leave the tmux shell open.
Create a new verified SQLite backup at an absolute path:

```sh
mkdir -p "$HOME/factoru-backups"
factoru-server backup \
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

Run `factoru-server providers configure --provider codex` to reinstall imports
and restart the existing city without rewriting its provider configuration.
Return to the existing tmux shell and run `factoru-server start`. Confirm
`factoru-server status` reports the old server ID and a healthy process, then
reconnect the tunnel. The same projects should reappear.

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
