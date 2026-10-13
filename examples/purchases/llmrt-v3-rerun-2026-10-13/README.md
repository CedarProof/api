# llmrt parts bundle v3: unpaid re-run of the 2026-10-10 gate (2026-10-13)

Clean copy of llmrt's `pk_parts_v3_bundle.zip` (received by mail 2026-10-13 12:22 UTC, 28,791 bytes, 16 entries, 8 files),
extracted to a scratch directory under this one, python3 only, no node, no edits to their files. This re-run was promised
on api#89 and by mail on 2026-10-13 12:40 UTC: the same three checks as the 10-10 gate, unpaid, to see whether the three
findings from that run are fixed. The seed is a fresh throwaway generated for this run and kept private; both the
`seed.hex` file and the scratch bundle stay on my box.

## Timeline (UTC, 2026-10-13)

- 16:55:53 tests: `tool/test_xno_payer_proxy.py` under `env -i` (no seed, no proxy env): 12 cases printed, ALL PASS (T1-T9 with T4 twice, T7, T7b, T7c; T8 slow_door_served and T9 hash_in_402_body are the new ones).
- 16:56:02 proxy :3141 → nano-gpt.com (`--allow-door nano-gpt.com --cap-xno 0.006 --max-per-call-xno 0.004`) started from the clean copy with `XNO_SEED_PATH` pointing at the throwaway. Second banner line: `paying from nano_3qgpdzwx5trwz1xdxetagx6yywu6wid5ko4sffgk8bftk4a6msn1hrpeq1e7 (seed index 14) -- fund this address`. **Finding 1 fixed**: the address to fund is printed, and it is the index the payer signs from.
- 16:56:20 proxies :3142 → kepler (`--allow nano_1jyx763fmsr851ieufnztwh7jed8sssixhd4bsgwcj3rd31iwxaxtendnhu3 --cap-xno 0.002`) and :3143 → nano-gpt.com (`--max-per-call-xno 0.00001`) started; same banner, same address.
- 16:56:45 funded Ӿ0.01 from the hot wallet to the printed address (ledger 418, block 3214EBDEC8238D4E56C545ECF22BD6741FD271BB0FBC9A741A1516381AC6C9AA). Account not yet opened; the money sits receivable. Nothing pocketed by hand this time.
- 16:57:09 CHECK 1 PASS: `POST /v1/chat/completions` (gpt-4o-mini) through :3141 answered 200 in 15.9 s with `LLMRT_GATE_OK`. Proxy log: `pocketed 10000000000000000000000000000 raw receivable (subtype open, 4A8048408B46F3B4…)`, then the paid call. Open block 4A8048408B46F3B4D8FA8978E416AD147B244CF2E398AFB500BCE0875F9A30A8 at 16:57:15, send 682A1F1A89867E852905CAE1E7A3426716A4C8A4E15B308D439CFF452D743028 of Ӿ0.0000304 to nano_145y6zgk… at 16:57:17 (quote pay_8ff900caba74ed1e3032bcaa80d9cec8). **Finding 2 fixed**: a freshly funded, never-opened wallet pays without a manual open.
- 16:57:39 CHECK 2 PAID, NOT DELIVERED WITHIN THE WINDOW: `GET /v1/check?address=…` through :3142. The proxy sent Ӿ0.001 to kepler (send 86C9716DBC2E293AAFB13446E317D6D11895176B5EA29B26EEF5BD7B21A779A6, confirmed on my node at 16:57:40, local_timestamp 1791910660), retried with `X-Nano-Payment` on the new schedule (5, 8, 12.8, 20, 20, 20 s) and gave up at 16:59:06 with the door's 402: `waited_seconds 85.8`, and the hash `86C9716D…` present both in the body field `x-nano-payment` and in the response header `x-nano-payment`. At 16:59:29, 23 s after the proxy gave up, the same hash presented by hand answered 200 `paid: true` in 0.9 s. **Finding 3 half fixed**: the retry window grew from 30 s to 85.8 s (the changelog's "about 106 s" counts request time) and the hash is now handed back so the caller can re-present it, which is the part that makes the money recoverable; but kepler's confirmation lag is still longer than the window, so the runtime still gets a 402 after paying. The lag is on the door's side: kepler checks the send through public RPC (rpc.nano.to, nanoslo.0x.no, per its listing), while the block was confirmed on the network within a second.
- 17:00:08 CHECK 3 PASS: the same POST through :3143 refused `per_call_ceiling` in 8.1 s (`amount_raw 30410000000000000000000000 > max_per_call_raw 10000000000000000000000000`); frontier 86C9716D… and block count 3 identical before and after; `state-ceiling.json` never written.
- 17:00:39 proxies stopped by PID. No NanoGPT refund receivable this time (the charge was exactly the quote), so finding 4 is not exercised; the pocketing path from finding 2 is the one that would catch it.
- 17:01:22 sweep: Ӿ0.0089696 from the throwaway to the hot wallet with llmrt's own primitives (`pk_work`, `_block_build`, `pk_process`), block 86F0D1066905E17BFC9D2A6110C646BC0275BE3BCF4B2D0C3715BE52923EA1B7, confirmed. The throwaway is recorded in my own-addresses list; the sweep receipt is my own money, not inflow.

## Result

Findings 1 and 2 are fixed as described in CHANGELOG_v3. Finding 3 is fixed in its recoverable half (hash returned in the 402 body and header) and improved but not closed in its timing half (85.8 s still shorter than kepler's confirmation check on this run; it was 30 s versus about 50 s on 10-10). No payment was lost: both paid calls delivered, one through the proxy and one by re-presenting the returned hash. Test spend from the throwaway: Ӿ0.0000304 + Ӿ0.001 = Ӿ0.0010304; the rest swept back. This re-run was unpaid, as promised; nothing is owed on it.

One suggestion, not a condition: when the final 402 carries `x-nano-payment`, the proxy could keep polling the door in the background and answer a later identical request from the cache, or document that the caller must re-present the hash itself. Either is fine; what matters is that the runtime's operator knows the money moved and the hash is theirs to re-present.

## Files

c1-result.txt, c1-headers.txt, c1-body.json (CHECK 1); c2-result.txt, c2-headers.txt, c2-body.json, c2-manual-represent.txt, c2-manual-body.json (CHECK 2); c3-before.txt, c3-result.txt, c3-body.json, c3-after.txt (CHECK 3); proxy-nanogpt.log, proxy-kepler.log, proxy-ceiling.log; state-nanogpt.json, state-kepler.json; sweep.txt. Not published: seed.hex, the bundle copy.
