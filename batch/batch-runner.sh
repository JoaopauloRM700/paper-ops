#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BATCH_DIR="$SCRIPT_DIR"
INPUT_FILE="$BATCH_DIR/batch-input.tsv"
STATE_FILE="$BATCH_DIR/batch-state.tsv"
LOGS_DIR="$BATCH_DIR/logs"
LOCK_FILE="$BATCH_DIR/batch-runner.pid"
STATE_LOCK_DIR="$BATCH_DIR/.batch-state.lock"
MAIN_PID="${BASHPID:-$$}"

PARALLEL=1
DRY_RUN=false
RETRY_FAILED=false
START_FROM=0
MAX_RETRIES=2
USE_FIXTURES=false

usage() {
  cat <<'USAGE'
paper-ops batch runner - process saved search queries in batch

Usage: batch-runner.sh [OPTIONS]

Options:
  --parallel N         Number of parallel searches (default: 1)
  --dry-run            Show what would be processed, do not execute
  --retry-failed       Retry only rows marked failed in batch-state.tsv
  --start-from N       Skip numeric ids smaller than N
  --max-retries N      Max retry attempts per row (default: 2)
  --fixtures           Run the local fixture-backed search path
  -h, --help           Show this help

Files:
  batch-input.tsv      Input rows (id, query, optional notes)
  batch-state.tsv      Processing state (auto-managed)
  logs/                Per-row execution logs

Examples:
  bash batch/batch-runner.sh --dry-run
  bash batch/batch-runner.sh --fixtures
  bash batch/batch-runner.sh --parallel 2 --retry-failed
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --parallel) PARALLEL="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --retry-failed) RETRY_FAILED=true; shift ;;
    --start-from) START_FROM="$2"; shift 2 ;;
    --max-retries) MAX_RETRIES="$2"; shift 2 ;;
    --fixtures) USE_FIXTURES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 1 ;;
  esac
done

sanitize_field() {
  printf '%s' "$1" | tr '\r\n\t' '   '
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

acquire_lock() {
  if [[ -f "$LOCK_FILE" ]]; then
    local old_pid
    old_pid="$(cat "$LOCK_FILE")"
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "ERROR: Another batch-runner is already running (PID $old_pid)"
      exit 1
    fi
    rm -f "$LOCK_FILE"
  fi

  echo "$MAIN_PID" > "$LOCK_FILE"
}

release_lock() {
  if [[ "${BASHPID:-$$}" != "$MAIN_PID" ]]; then
    return
  fi

  rm -f "$LOCK_FILE"
}

trap release_lock EXIT

acquire_state_lock() {
  while ! mkdir "$STATE_LOCK_DIR" 2>/dev/null; do
    sleep 0.1
  done
}

release_state_lock() {
  rmdir "$STATE_LOCK_DIR" 2>/dev/null || true
}

init_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    printf 'id\tquery\tstatus\tstarted_at\tcompleted_at\treport_path\tjson_path\terror\tretries\n' > "$STATE_FILE"
  fi
}

get_status() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "none"
    return
  fi

  local status
  status="$(awk -F'\t' -v id="$id" '$1 == id { print $3 }' "$STATE_FILE")"
  echo "${status:-none}"
}

get_retries() {
  local id="$1"
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "0"
    return
  fi

  local retries
  retries="$(awk -F'\t' -v id="$id" '$1 == id { print $9 }' "$STATE_FILE")"
  echo "${retries:-0}"
}

update_state_unlocked() {
  local id="$1"
  local query="$2"
  local status="$3"
  local started="$4"
  local completed="$5"
  local report_path="$6"
  local json_path="$7"
  local error_text="$8"
  local retries="$9"

  local tmp
  tmp="$STATE_FILE.tmp"
  local found=false

  if [[ -f "$STATE_FILE" ]]; then
    head -1 "$STATE_FILE" > "$tmp"
    while IFS=$'\t' read -r sid squery sstatus sstarted scompleted sreport sjson serror sretries; do
      [[ "$sid" == "id" ]] && continue
      if [[ "$sid" == "$id" ]]; then
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
          "$id" "$query" "$status" "$started" "$completed" "$report_path" "$json_path" "$error_text" "$retries" >> "$tmp"
        found=true
      else
        printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
          "$sid" "$squery" "$sstatus" "$sstarted" "$scompleted" "$sreport" "$sjson" "$serror" "$sretries" >> "$tmp"
      fi
    done < "$STATE_FILE"
  else
    printf 'id\tquery\tstatus\tstarted_at\tcompleted_at\treport_path\tjson_path\terror\tretries\n' > "$tmp"
  fi

  if [[ "$found" == "false" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' \
      "$id" "$query" "$status" "$started" "$completed" "$report_path" "$json_path" "$error_text" "$retries" >> "$tmp"
  fi

  mv "$tmp" "$STATE_FILE"
}

update_state() {
  acquire_state_lock
  update_state_unlocked "$@"
  release_state_lock
}

check_prerequisites() {
  if [[ ! -f "$INPUT_FILE" ]]; then
    echo "ERROR: $INPUT_FILE not found."
    exit 1
  fi

  if ! command_exists node; then
    echo "ERROR: node is required to run paper-ops batch searches."
    exit 1
  fi

  if [[ ! -f "$PROJECT_DIR/paper-ops.mjs" ]]; then
    echo "ERROR: $PROJECT_DIR/paper-ops.mjs not found."
    exit 1
  fi

  mkdir -p "$LOGS_DIR"
  init_state
}

should_process_entry() {
  local id="$1"
  local status
  local retries
  status="$(get_status "$id")"
  retries="$(get_retries "$id")"

  if [[ "$id" =~ ^[0-9]+$ && "$START_FROM" =~ ^[0-9]+$ ]]; then
    if (( id < START_FROM )); then
      return 1
    fi
  fi

  if [[ "$RETRY_FAILED" == "true" ]]; then
    [[ "$status" == "failed" ]] || return 1
    (( retries < MAX_RETRIES )) || return 1
    return 0
  fi

  case "$status" in
    none|"")
      return 0
      ;;
    failed)
      (( retries < MAX_RETRIES )) || return 1
      return 0
      ;;
    processing|completed)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

process_query() {
  local id="$1"
  local query="$2"
  local notes="${3:-}"

  local started_at
  local completed_at
  local retries
  local log_file
  local report_path=""
  local json_path=""
  local error_text=""

  retries=$(( $(get_retries "$id") + 1 ))
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  log_file="$LOGS_DIR/${id}.log"

  update_state "$id" "$(sanitize_field "$query")" "processing" "$started_at" "-" "-" "-" "-" "$retries"

  local command
  command=(node "$PROJECT_DIR/paper-ops.mjs" search "$query" --project-root "$PROJECT_DIR")
  if [[ "$USE_FIXTURES" == "true" ]]; then
    command+=(--fixtures)
  fi

  if (cd "$PROJECT_DIR" && "${command[@]}") >"$log_file" 2>&1; then
    completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    report_path="$(awk -F': ' '/^Saved markdown report:/ { print $2 }' "$log_file" | tail -1)"
    json_path="$(awk -F': ' '/^Saved JSON export:/ { print $2 }' "$log_file" | tail -1)"
    update_state \
      "$id" \
      "$(sanitize_field "$query")" \
      "completed" \
      "$started_at" \
      "$completed_at" \
      "$(sanitize_field "$report_path")" \
      "$(sanitize_field "$json_path")" \
      "$(sanitize_field "$notes")" \
      "$retries"
    echo "[$id] completed"
    return 0
  fi

  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  error_text="$(tail -n 5 "$log_file" | tr '\r\n' ' ' | sed 's/[[:space:]]\+/ /g')"
  update_state \
    "$id" \
    "$(sanitize_field "$query")" \
    "failed" \
    "$started_at" \
    "$completed_at" \
    "-" \
    "-" \
    "$(sanitize_field "$error_text")" \
    "$retries"
  echo "[$id] failed"
  return 1
}

main() {
  acquire_lock
  check_prerequisites

  local pending=0

  while IFS=$'\t' read -r id query notes; do
    [[ "$id" == "id" ]] && continue
    [[ -n "$id" && -n "$query" ]] || continue

    if ! should_process_entry "$id"; then
      continue
    fi

    pending=$((pending + 1))

    if [[ "$DRY_RUN" == "true" ]]; then
      echo "DRY RUN [$id] $query"
      continue
    fi

    process_query "$id" "$query" "${notes:-}" &

    while (( $(jobs -pr | wc -l) >= PARALLEL )); do
      wait -n || true
    done
  done < "$INPUT_FILE"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "Pending rows: $pending"
    return 0
  fi

  local wait_status=0
  local pid
  for pid in $(jobs -pr); do
    if ! wait "$pid"; then
      wait_status=1
    fi
  done

  echo "Processed rows: $pending"
  return "$wait_status"
}

main "$@"
