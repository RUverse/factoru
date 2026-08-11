#!/bin/sh

set -eu

fail() {
  printf 'Factoru bootstrap: %s\n' "$*" >&2
  exit 1
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repository_root=$(CDPATH= cd -- "$script_dir/.." && pwd)

[ "$(id -u)" -ne 0 ] || fail "run this command as the unprivileged deployment user, not root."
[ "$(uname -s)" = "Linux" ] || fail "this preview bootstrap supports Linux only."

case "$(uname -m)" in
  aarch64|arm64) artifact_arch=arm64 ;;
  x86_64|amd64) artifact_arch=amd64 ;;
  armv6*|armv7*|armhf|i386|i686)
    fail "32-bit Linux is unsupported; install a 64-bit Raspberry Pi OS, Debian, or Ubuntu image."
    ;;
  *) fail "unsupported Linux architecture: $(uname -m). Use arm64 or x86_64." ;;
esac

provider=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --) shift ;;
    --provider)
      [ -z "$provider" ] || fail "--provider may be supplied only once."
      [ "$#" -ge 2 ] || fail "--provider requires codex or claude."
      provider=$2
      shift 2
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

case "$provider" in
  codex|claude) ;;
  '') fail "choose a provider with --provider codex or --provider claude." ;;
  *) fail "unsupported provider '$provider'; choose codex or claude." ;;
esac

branch=$(git -C "$repository_root" branch --show-current 2>/dev/null || true)
[ "$branch" = "dev" ] || fail "the deployment checkout must be on the dev branch (found '${branch:-no branch}')."

dirty=$(git -C "$repository_root" status --porcelain --untracked-files=normal 2>/dev/null || true)
[ -z "$dirty" ] || fail "the deployment checkout is dirty; commit, move, or discard those changes before bootstrapping."

missing_base=0
for executable in curl git ip jq lsof pgrep sha256sum tar tmux xz flock; do
  if ! command -v "$executable" >/dev/null 2>&1; then
    missing_base=1
  fi
done
if [ ! -r /etc/ssl/certs/ca-certificates.crt ]; then
  missing_base=1
fi

if [ "$missing_base" -eq 1 ]; then
  command -v apt-get >/dev/null 2>&1 ||
    fail "missing base tools and apt-get is unavailable; use Debian, Ubuntu, or Raspberry Pi OS for this preview."
  command -v sudo >/dev/null 2>&1 || fail "sudo is required to install missing operating-system packages."
  printf 'Installing missing operating-system packages (sudo may prompt once)...\n'
  sudo apt-get update
  sudo apt-get install --yes ca-certificates curl git iproute2 jq lsof procps tmux util-linux xz-utils
fi

node_version=$(awk '
  /"devEngines"[[:space:]]*:/ { in_dev_engines = 1 }
  in_dev_engines && /"version"[[:space:]]*:/ {
    line = $0
    sub(/^.*"version"[[:space:]]*:[[:space:]]*"/, "", line)
    sub(/".*$/, "", line)
    print line
    exit
  }
' "$repository_root/package.json")
pnpm_version=$(sed -n 's/^.*"packageManager"[[:space:]]*:[[:space:]]*"pnpm@\([^"]*\)".*$/\1/p' "$repository_root/package.json" | sed -n '1p')

[ -n "$node_version" ] || fail "could not read the Node.js pin from package.json."
[ -n "$pnpm_version" ] || fail "could not read the pnpm pin from package.json."

install_root=${FACTORU_BOOTSTRAP_ROOT:-"$HOME/.local/share/factoru"}
case "$install_root" in
  /*) ;;
  *) fail "the Factoru tool directory must be an absolute path: $install_root" ;;
esac
bin_dir="$install_root/bin"
toolchains_dir="$install_root/toolchains"
mkdir -p "$bin_dir" "$toolchains_dir"
export PATH="$bin_dir:$PATH"

link_managed() {
  source_path=$1
  destination_path=$2
  if [ -e "$destination_path" ] && [ ! -L "$destination_path" ]; then
    fail "refusing to replace non-symlink Factoru tool path: $destination_path"
  fi
  ln -sfn "$source_path" "$destination_path"
}

current_node=$(node --version 2>/dev/null || true)
if [ "$current_node" != "v$node_version" ] || ! command -v npm >/dev/null 2>&1; then
  node_archive="node-v${node_version}-linux-${artifact_arch}.tar.xz"
  node_home="$toolchains_dir/node-v${node_version}-linux-${artifact_arch}"
  if [ ! -x "$node_home/bin/node" ] || [ ! -x "$node_home/bin/npm" ]; then
    [ ! -e "$node_home" ] || fail "the managed Node.js directory is incomplete: $node_home"
    bootstrap_tmp=$(mktemp -d "${TMPDIR:-/tmp}/factoru-node.XXXXXX")
    case "$bootstrap_tmp" in
      "${TMPDIR:-/tmp}"/factoru-node.*) ;;
      *) fail "mktemp returned an unexpected path: $bootstrap_tmp" ;;
    esac
    cleanup_tmp() {
      if [ -n "${bootstrap_tmp:-}" ] && [ -d "$bootstrap_tmp" ]; then
        rm -rf -- "$bootstrap_tmp"
      fi
    }
    trap cleanup_tmp EXIT HUP INT TERM

    printf 'Installing Node.js %s for Linux %s...\n' "$node_version" "$artifact_arch"
    curl -fsSL -o "$bootstrap_tmp/$node_archive" \
      "https://nodejs.org/download/release/v${node_version}/${node_archive}"
    curl -fsSL -o "$bootstrap_tmp/SHASUMS256.txt" \
      "https://nodejs.org/download/release/v${node_version}/SHASUMS256.txt"
    (
      cd "$bootstrap_tmp"
      grep "  ${node_archive}$" SHASUMS256.txt | sha256sum -c -
    )
    node_stage="$toolchains_dir/.node-v${node_version}-linux-${artifact_arch}.$$"
    [ ! -e "$node_stage" ] || fail "unexpected Node.js staging path already exists: $node_stage"
    mkdir "$node_stage"
    tar --no-same-owner --no-same-permissions -xJf "$bootstrap_tmp/$node_archive" \
      -C "$node_stage" --strip-components=1
    mv "$node_stage" "$node_home"
    cleanup_tmp
    trap - EXIT HUP INT TERM
  fi

  link_managed "$node_home/bin/node" "$bin_dir/node"
  link_managed "$node_home/bin/npm" "$bin_dir/npm"
  link_managed "$node_home/bin/npx" "$bin_dir/npx"
  if [ -e "$node_home/bin/corepack" ]; then
    link_managed "$node_home/bin/corepack" "$bin_dir/corepack"
  fi
  hash -r 2>/dev/null || true
fi

[ "$(node --version 2>/dev/null || true)" = "v$node_version" ] || fail "Node.js $node_version could not be activated."

current_pnpm=$(pnpm --version 2>/dev/null || true)
if [ "$current_pnpm" != "$pnpm_version" ]; then
  printf 'Installing pnpm %s...\n' "$pnpm_version"
  pnpm_home="$install_root/pnpm"
  npm install --global --prefix "$pnpm_home" "pnpm@$pnpm_version"
  [ -x "$pnpm_home/bin/pnpm" ] || fail "pnpm installed without its expected executable."
  link_managed "$pnpm_home/bin/pnpm" "$bin_dir/pnpm"
  if [ -e "$pnpm_home/bin/pnpx" ]; then
    link_managed "$pnpm_home/bin/pnpx" "$bin_dir/pnpx"
  fi
  hash -r 2>/dev/null || true
fi

[ "$(pnpm --version 2>/dev/null || true)" = "$pnpm_version" ] || fail "pnpm $pnpm_version could not be activated."

if [ -z "${FACTORU_BOOTSTRAP_ROOT:-}" ]; then
  profile_line='export PATH="$HOME/.local/share/factoru/bin:$PATH"'
  profile_path="$HOME/.profile"
  touch "$profile_path"
  if ! grep -Fqx "$profile_line" "$profile_path"; then
    printf '\n# Factoru remote source-preview tools\n%s\n' "$profile_line" >> "$profile_path"
  fi
fi

cd "$repository_root"
exec node scripts/remote-bootstrap.mjs --provider "$provider"
