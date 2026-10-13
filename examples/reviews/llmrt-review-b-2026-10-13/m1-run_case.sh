#!/usr/bin/env bash
# Review B fail-closed runner: start the mock door + the proxy, send one request, capture the refusal.
# usage: run_case.sh <mode> <extra_env>
set -u
MODE="$1"; shift || true
ROOT=/home/ai/桌面/loop1
SKILL=$ROOT/tmp/pk_skill_v3/scripts
PORT=${PORT:-3402}
MOCK_PORT=3403
OUT=$ROOT/tmp/rb/out_$MODE.txt
: > "$OUT"

pkill -f 'mock_door.js' 2>/dev/null; pkill -f "inference-proxy.js" 2>/dev/null; sleep 1

MOCK_MODE=$MODE MOCK_PORT=$MOCK_PORT node $ROOT/tmp/rb/mock_door.js > $ROOT/tmp/rb/mock_$MODE.log 2>&1 &
sleep 1

STATE=$ROOT/tmp/rb/state_$MODE.json
rm -f "$STATE"
cd $SKILL
# A funded, opened account so quote-level cases (cap hit, changed quote) reach their gate rather
# than stopping at account_not_opened.
export NANO_SEED=$(cat $ROOT/tmp/rb/seed.hex)
export PROXY_KEY=reviewbkey1234567890
export UPSTREAM=http://127.0.0.1:$MOCK_PORT
export NANO_CAP=0.01
export NANO_MAX_PER_CALL=0.001
export STATE_FILE=$STATE
export PORT=$PORT
export NANO_RPC=https://nanoslo.0x.no/proxy
export WORK_URL=https://pursekeeper.dev/v1/work
export RECEIVE=0
export NANO_ALLOW_PAYTO="${NANO_ALLOW_PAYTO:-}"
node inference-proxy.js >> $ROOT/tmp/rb/proxy_$MODE.log 2>&1 &
PROXY_PID=$!
sleep 2

echo "=== CASE $MODE ===" >> "$OUT"
echo "--- request (curl -sS -i, PROXY_KEY as Authorization)" >> "$OUT"
curl -sS -i --max-time 20 -X POST "http://127.0.0.1:$PORT/v1/chat/completions" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $PROXY_KEY" \
  -d '{"model":"gpt-5-nano","messages":[{"role":"user","content":"hi"}]}' >> "$OUT" 2>&1
echo >> "$OUT"
echo "--- state (payments must be empty: nothing signed)" >> "$OUT"
curl -sS --max-time 10 "http://127.0.0.1:$PORT/_nano/state" >> "$OUT" 2>&1
echo >> "$OUT"
kill $PROXY_PID 2>/dev/null
pkill -f 'mock_door.js' 2>/dev/null
echo "DONE $MODE -> $OUT"

