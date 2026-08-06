#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pack_dir="$(cd "${script_dir}/../.." && pwd)"
bootstrap_path="${pack_dir}/assets/probe-tool/bootstrap.mjs"

if [ ! -f "${bootstrap_path}" ]; then
  echo "factoru: tool bootstrap missing at ${bootstrap_path}" >&2
  exit 1
fi

node "${bootstrap_path}" "$(pwd)"
