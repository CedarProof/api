# Review B, milestone 2: Pi base-URL compatibility and stream:true

Reviewer: llmrt. Target: pursekeeper skill tag `v0.3.0`, commit `db7c7a1c76`. Ran 2026-10-13 UTC.

## Setup

Pi is `@earendil-works/pi-coding-agent` v1.2.0, installed from its published tarball and run from
`dist/bundle/cli.js`. The proxy is the `scripts/inference-proxy.js` from that tag, started with
`NANO_CAP=0.01`, `NANO_MAX_PER_CALL=0.001`, and a funded, opened test account. Pi is pointed at the
proxy through its agent-directory `models.json`:

```json
{
  "providers": {
    "pkproxy": {
      "baseUrl": "http://127.0.0.1:3402/v1",
      "api": "openai-completions",
      "apiKey": "$PROXY_KEY",
      "models": [{ "id": "gpt-5-nano", "name": "NanoGPT via pursekeeper proxy" }]
    }
  }
}
```

`PROXY_KEY` is the same value the proxy was started with, and it reaches Pi through the `$PROXY_KEY`
interpolation in `apiKey`. That is the 0.3.0 recipe: the runtime presents the proxy key as its API key.

Reproduce:

```bash
cd /home/ai/桌面/loop1/tmp/rb
bash run_pi_case.sh cap_hit        # or allow_miss
bash run_stream_case.sh            # the stream:true case
```

## 1. Does the proxy run as Pi's base URL without weakening its safeguards?

Yes, for the three gates a local mock can reach from a Pi request.

| case | Pi's output | refusal code | payments signed | spent |
|---|---|---|---|---|
| cap hit | `402: inference-proxy refused: over_per_call_limit` | `over_per_call_limit` | 0 | 0 |
| allow-list miss | `402: inference-proxy refused: payto_not_allowed` | `payto_not_allowed` | 0 | 0 |
| changed quote | `502: inference-proxy refused: not_served_after_payment` | `not_served_after_payment` | 1 signed, not broadcast | 0 |

`pi --list-models` with this config lists `pkproxy / gpt-5-nano` and nothing else, so the proxy is
Pi's only route to a model in this run. The refusal reaches Pi as the HTTP status and the JSON body the
proxy produced, with no block signed in the two unpaid cases; the changed-quote case signs and then
uncounts, exactly as in milestone 1.

The safeguard that 0.3.0 adds and that matters most for Pi is `PROXY_KEY`. Pi sends it, so the key is
not the thing being weakened; a request without it is refused `401 proxy_key` before the door is
reached. That check is not re-tested here because milestone 1's harness already covers it, and
`pi --list-models` would not run at all if the key were rejected.

## 2. Does `stream: true` behave as the README says?

Yes. Against a door that answers a `stream:true` request with a plain JSON completion, the proxy wraps
it as the README describes:

```
HTTP/1.1 200 OK
x-payer-paid: 0.00001
x-payer-hash: 2FCF731248AFF34A9E5B2B1CCF77B5558A847F174DBE24DA76FD8E464F97CF5D
content-type: text/event-stream
x-payer-stream: buffered

data: {"id":"chatcmpl-mock","object":"chat.completion.chunk",...,"choices":[{"index":0,
      "delta":{"role":"assistant","content":"calling a tool",
      "tool_calls":[{"index":0,"id":"call_1","type":"function",
      "function":{"name":"read_file","arguments":"{\"path\":\"a.txt\"}"}}]},
      "finish_reason":"tool_calls"}]}

data: [DONE]
```

Three properties the README claims, each visible above: the wrap is one `chat.completion.chunk`; its
`delta` carries the whole message including `tool_calls` with their `index`; and `[DONE]` follows. The
0.2.2 defect (a tool-call answer arriving with `finish_reason: "tool_calls"` and no call in it) does
not reproduce on `v0.3.0`.

The paid call in this case spent 0.00001 XNO against the mock door's own account, which holds no key
here, so the block was signed but the funds are not spendable by anyone. The account's on-chain balance
stayed at 0.01 XNO and the block is not on the chain, confirming the mock never broadcast it.

## Limits

- The doors are local mocks, not NanoGPT, so what is shown is Pi-to-proxy-to-door behaviour on the
  exact dialect, not a live NanoGPT session. A live run at the reviewer's own ceiling is the next step
  if you want it inside this milestone.
- `stream:true` passthrough (a door that really streams SSE) is not exercised; the case above is the
  buffered wrap, which is the one the README singles out and the one that had a defect.
- Pi 1.2.0 is the version tested. The compatibility claim is for that version.

## Files

- `run_pi_case.sh`, `run_stream_case.sh` — runners for the two sections.
- `mock_stream.js` — the plain-completion door used by the stream case.
- `pi_out_<case>.txt`, `stream_case.txt` — Pi's output and the proxy state for each run.
- `pi_state_<case>.json`, `stream_state.json` — the full state files.

