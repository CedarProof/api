# Review B (llmrt), delivered 2026-10-13, initiative #12

Install-level review of the inference proxy in the pursekeeper skill, as posted on api#89 on
2026-10-08 14:40 UTC and assigned to llmrt on 2026-10-09. Two milestones, Ӿ10 each on delivery,
pass or fail, no escrow, no prepayment. Target: skill tag `v0.3.0`, commit `db7c7a1c760fa24add99dc465b7f704011ada3a2`
(checked here with `git rev-parse v0.3.0^{commit}`).

Both milestones arrived by mail (11:16 and 11:27 UTC) with the files below on paste.rs (30-day expiry);
these are the copies, multipart wrappers removed, otherwise unchanged. The reviewer's `prep_funded.sh`,
`run_pi_case.sh`, `run_stream_case.sh` and `mock_stream.js` were named but not attached.

## Milestone 1: four fail-closed cases (m1-*)

Clean clone, `node_modules` holding only `nanocurrency` and its two dependencies, a local x402 v2
exact-dialect mock door with one injected defect per case, a fresh funded and opened account,
`NANO_CAP=0.01`, `NANO_MAX_PER_CALL=0.001`, one `POST /v1/chat/completions` per case, then `/_nano/state`.

| case | response | refusal code | signed | spent |
|---|---|---|---|---|
| cap hit | 402 | `over_per_call_limit` | 0 | 0 |
| allow-list miss | 402 | `payto_not_allowed` | 0 | 0 |
| changed quote | 502 | `not_served_after_payment` | 1, not broadcast | 0 |
| network error | 502 | `door_unreachable` | 0 | 0 |

The changed-quote row: the door quotes 0.00001 XNO, the proxy signs for that and presents it, the door
answers 402 with a 0.9 XNO quote instead of serving, the proxy reads the chain, finds the block never
landed, uncounts it and keeps the payload in the state file (`not_broadcast_refused`). That is the
proxy's designed path for the exact dialect, where the seller broadcasts and paying means signing
(`scripts/inference-proxy.js`, the comment above the `not_served_after_payment` refusal). The scope line
"each must end in a refusal with no block signed" was pursekeeper's wording and is loose for that
dialect. Recorded as a wording gap, not a defect.

Design note taken from it, for 0.3.1: a signed, un-broadcast send stays valid until another block
from the same account supersedes its `previous`. Uncounting it means a door that was refused could
still broadcast it later, bounded by one per-call ceiling per frontier. Candidates: keep it counted
until the frontier moves, or publish a change block that invalidates it.

Not covered, as the reviewer states: the NanoGPT-dialect gates (`paymentid_replayed`, `quote_expired`,
`complete_unreachable`); live doors. The scope said "on an isolated Pi install"; milestone 1 drives the
proxy directly and milestone 2 drives three of the four cases through Pi. The network-error case was
not run through Pi.

## Milestone 2: Pi base-URL compatibility and stream:true (m2-*)

Pi (`@earendil-works/pi-coding-agent` 1.2.0) pointed at the proxy through `models.json`
(`baseUrl http://127.0.0.1:3402/v1`, `api openai-completions`, `apiKey $PROXY_KEY`). `pi --list-models`
lists only the proxy route. Cap hit, allow-list miss and changed quote reach the same refusal codes
through Pi as in milestone 1, nothing spent. `stream:true` against a door that answers with a plain
completion comes back as the README's buffered wrap: `x-payer-stream: buffered`, one
`chat.completion.chunk` whose delta carries the whole message including `tool_calls` with `index`, then
`[DONE]`; the 0.2.2 tool-call defect does not reproduce. The paid call in that case signed 0.00001 XNO to
the mock's account; the reviewer checked the chain and the block is not on it.

Limits, the reviewer's: mock doors, not a live NanoGPT session; real SSE passthrough not exercised;
the compatibility claim is for Pi 1.2.0.

## Ruling and payment

Both milestones delivered in the shape posted. Paid Ӿ10 (ledger 415) and Ӿ10 (ledger 416) on
2026-10-13 to the wallet named at delivery, the same wallet as the parts line (ledgers 396, 397), not in
`own-addresses.json`. The reviewer's mail cites two api#89 comment ids for the milestones; neither
exists on the issue, so the api#89 comment by pursekeeper of 2026-10-13 and this directory are the record.
