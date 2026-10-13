# Review B, milestone 1: fail-closed results on an isolated install

Reviewer: llmrt. Target: pursekeeper skill tag `v0.3.0`, commit `db7c7a1c76`
(`git -C pk_skill_v3 rev-parse HEAD`). Ran 2026-10-13 UTC.

## What was tested

The proxy is the `scripts/inference-proxy.js` from that tag, started from a clean clone with
`node_modules` containing only `nanocurrency` and its transitive `bignumber.js`/`blakejs`. The door is
a local mock (`mock_door.js`, included) that returns a 402 quote shaped as the x402 v2 exact dialect
(`PAYMENT-REQUIRED` header, `scheme: exact`, `network: nano:mainnet`), with one defect injected per
case. The paying account is a fresh seed funded with 0.01 XNO and opened with `node no-node.js receive`
before the runs, so every case reaches its quote-level gate rather than stopping at
`account_not_opened`.

Reproduce any case:

```bash
cd /home/ai/桌面/loop1/tmp/rb
bash run_case.sh cap_hit          # or: allow_miss, changed_quote, network_error
cat out_cap_hit.txt               # request, response, and the state file at the end
```

The runner starts the mock door, starts the proxy against it with `NANO_CAP=0.01` and
`NANO_MAX_PER_CALL=0.001`, sends one `POST /v1/chat/completions` with `PROXY_KEY` as the bearer
token, then reads `/_nano/state`. `NANO_ALLOW_PAYTO` is set only for the allow-list case.

## Results

| case | injected defect | response | refusal code | payments signed | spent |
|---|---|---|---|---|---|
| cap hit | quote is 0.9 XNO, above the 0.001 per-call ceiling | 402 | `over_per_call_limit` | 0 | 0 |
| allow-list miss | `payTo` is not on `NANO_ALLOW_PAYTO` | 402 | `payto_not_allowed` | 0 | 0 |
| changed quote | the door raises the price to 0.9 XNO after the caller has presented a payment | 502 | `not_served_after_payment` | 1 signed, **not broadcast** | 0 |
| network error | the door drops the connection with no response | 502 | `door_unreachable` | 0 | 0 |

Every case ends in a refusal to the runtime with `state.spent_raw = "0"`. The one signed block in the
changed-quote case is the documented path, not a leak: the proxy signs, the door does not serve, the
proxy reads the chain, finds the block was never broadcast, uncounts it and keeps the payload in the
state file (`status: not_broadcast_refused`). The spend counter stays at zero, so a later call is not
blocked by a payment that never landed.

## Files

- `mock_door.js` — the door, one defect per `MOCK_MODE`.
- `run_case.sh` — starts door + proxy, sends the request, captures response and state.
- `prep_funded.sh` — creates and opens the test account.
- `out_<case>.txt` — the request, the response, and the state at the end of that run.
- `state_<case>.json` — the full state file for that run, including the refusal record.

## Notes and limits

- The mock door is a local x402 v2 exact-dialect server, not NanoGPT. The four gates exercised here
  (`over_per_call_limit`, `payto_not_allowed`, `not_served_after_payment`, `door_unreachable`) are
  decided by the proxy before or independently of the door's identity, so a local door reaches them.
  The NanoGPT-dialect gates (`paymentid_replayed`, `quote_expired`, `complete_unreachable`) are not
  covered by this milestone.
- The paying account is the operator's own test account on mainnet; the mock door's `payTo` is a
  syntactically valid account with no key held here, so no real funds could move even if the proxy had
  paid.
- No live calls were made. The reviewer's ceiling was not touched.

