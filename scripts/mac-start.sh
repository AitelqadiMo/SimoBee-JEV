#!/usr/bin/env bash
# SimoBee: build and start everything locally on a Mac (or any machine with Docker), then open the dashboard.
#   bash scripts/mac-start.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install Docker Desktop from https://www.docker.com/products/docker-desktop and run this again."
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is installed but not running. Opening it; run this script again once it says 'Engine running'."
  open -a Docker 2>/dev/null || true
  exit 1
fi

PORT=80
if [ -f .env ] && grep -qE '^WEB_HTTP_PORT=' .env; then PORT="$(grep -E '^WEB_HTTP_PORT=' .env | tail -1 | cut -d= -f2 | tr -d ' "')"; fi
URL="http://localhost"; [ "$PORT" != "80" ] && URL="http://localhost:$PORT"

echo "Building and starting SimoBee (first build takes a few minutes)..."
docker compose up -d --build

echo -n "Waiting for the engine"
for _ in $(seq 1 60); do
  if curl -fsS "$URL/health" >/dev/null 2>&1; then echo " ready."; break; fi
  echo -n "."; sleep 2
done
echo

docker compose ps
echo
echo "Open $URL"
echo "  First run: the Setup page (open for 2 hours after the engine starts)."
echo "  Logs:      docker compose logs -f engine"
echo "  Stop:      docker compose stop"
command -v open >/dev/null 2>&1 && open "$URL" || true
