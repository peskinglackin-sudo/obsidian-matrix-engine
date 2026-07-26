#!/bin/sh
set -eu

if [ "$#" -lt 1 ]; then
  echo "usage: run-platform-probe.sh <prepare|finalize> [options]" >&2
  exit 2
fi

mode=$1
shift
case "$mode" in
  prepare|finalize) ;;
  *)
    echo "mode must be prepare or finalize" >&2
    exit 2
    ;;
esac

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname "$script_dir")
exec node --import=tsx "$root/spike/platform-runner/operator.ts" "$mode" "$@"
