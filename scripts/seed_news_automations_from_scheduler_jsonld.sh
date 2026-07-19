#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../../.." && pwd)"
NEWS_SCHEDULER_JSON="${REPO_ROOT}/projects/etzhayyim-project-news/scheduler.jsonld"

# Scheduler cron MCP endpoint (scheduler-cron-component).
# Override to point at another actor id or local dev.
SCHEDULER_API_BASE="${SCHEDULER_API_BASE:-https://1.etzhayyim.com}"
NEWS_JOBS_BASE="${NEWS_JOBS_BASE:-}"
AUTH_BEARER_TOKEN="${AUTH_BEARER_TOKEN:-}"

if [[ ! -f "${NEWS_SCHEDULER_JSON}" ]]; then
  echo "missing file: ${NEWS_SCHEDULER_JSON}" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

if [[ -z "${NEWS_JOBS_BASE}" ]]; then
  echo "NEWS_JOBS_BASE is required (example: https://etzhayyim.com/<news-nanoid>)" >&2
  exit 1
fi

SCHEDULER_API_BASE="${SCHEDULER_API_BASE%/}"
NEWS_JOBS_BASE="${NEWS_JOBS_BASE%/}"
TIMEZONE="$(jq -r '.scheduler.timezone // "UTC"' "${NEWS_SCHEDULER_JSON}")"

cron_to_interval_hours() {
  local cron="$1"
  if [[ "$cron" =~ ^[0-9]+[[:space:]]+\*/([0-9]+)[[:space:]]+\*[[:space:]]+\*[[:space:]]+\*$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  echo "4"
}

create_automation() {
  local name="$1"
  local route="$2"
  local schedule="$3"
  local categories_json="$4"
  local interval
  interval="$(cron_to_interval_hours "$schedule")"

  local target_url="${NEWS_JOBS_BASE}${route}"

  local tool_args
  tool_args="$(jq -n \
    --arg name "$name" \
    --arg timezone "$TIMEZONE" \
    --arg target_url "$target_url" \
    --argjson interval_hours "$interval" \
    --argjson days '["Mo","Tu","We","Th","Fr","Sa","Su"]' \
    --argjson categories "$categories_json" \
    '{
      name: $name,
      projects: ["etzhayyim-project-news"],
      work_dir: "/workspace/projects/etzhayyim-project-news",
      prompt: "Auto-generated from projects/etzhayyim-project-news/scheduler.jsonld",
      timezone: $timezone,
      schedule: {
        mode: "interval",
        interval_hours: $interval_hours,
        days: $days
      },
      target: {
        method: "POST",
        url: $target_url,
        headers: {"content-type":"application/json"},
        body: {
          data: { topic: "scheduled-news", localeTargets: ["ja","en"], runId: "" },
          categories: $categories
        }
      },
      retry: { max_attempts: 3, backoff_seconds: 30 }
    }')"

  local mcp_payload
  mcp_payload="$(jq -n --argjson args "$tool_args" '{
    jsonrpc: "2.0",
    id: "seed",
    method: "tools/call",
    params: { name: "scheduler_cron.automations_create", arguments: $args }
  }')"

  if [[ -z "${AUTH_BEARER_TOKEN}" ]]; then
    echo "AUTH_BEARER_TOKEN is required (scheduler-cron MCP is protected)" >&2
    exit 1
  fi

  curl -fsS -X POST "${SCHEDULER_API_BASE}/api/grpc" \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${AUTH_BEARER_TOKEN}" \
    --data "$mcp_payload" >/dev/null

  echo "seeded: ${name} -> ${target_url} (every ${interval}h)"
}

while IFS=$'\t' read -r name route schedule categories_json; do
  if [[ -z "$name" || -z "$route" ]]; then
    continue
  fi
  create_automation "$name" "$route" "$schedule" "$categories_json"
done < <(jq -r '.scheduler.jobs[] | [.name, .route, .schedule, ((.categories // []) | @json)] | @tsv' "${NEWS_SCHEDULER_JSON}")

echo "done"
