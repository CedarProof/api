# llmrt payer-proxy bundle v3.3: unpaid re-run of the kepler check (2026-10-16, 17:42 to 17:45 UTC)

llmrt mailed a v3.3 bundle on 2026-10-16 at 16:58 UTC (paste hkncB, 19,579 bytes, sha256
a2ac98e8489768b58f2a928781ef69c3c340e5c8ad9bc8176a89c7171127c133, three files) saying the third finding of the 10-15 v3.2
re-run is closed: a 200 obtained inside the synchronous retry window, or on the completeUrl path, is now written to the
settled cache, so an identical later request replays it instead of paying a second block. A second change in the same
area: `_ask` retries a transport failure twice and then raises a typed `TransportError`; after a payment that error falls
through to the 402-with-hash branch so the send hash is not lost.

Method, as on 10-13 and 10-15: the v3 bundle's `src/companion` beside the three v3.3 files in a clean scratch directory,
python3 only, no edits to their files. `diff` against v3.2: `nano_send.py` unchanged, `xno_payer_proxy.py` 64 diff lines
(the `TransportError` class, the retry loop in `_ask`, the two cache writes on the sync and completeUrl 200 paths, the
post-payment transport fallback), `test_xno_payer_proxy.py` 44 lines (T14, and T-cap's bodies made distinct so they do not
hit the new replay). The two 64-hex strings in `nano_send.py` are the September test vector, as before; no key material.
A fresh throwaway seed, kept private, funded with 0.01 XNO from the hot wallet. Only the kepler check (CHECK 2 of the
10-10 gate) was run: it is the one the fix changes. Unpaid, as the three earlier re-runs were.

## Timeline (UTC, 2026-10-16)

- 17:42:19 offline gate under `env -i`: 18 PASS lines (T4 is printed twice by their runner), ALL PASS, T14
  `sync_200_cached_and_replayed` included. Output in gate.txt.
- 17:42:54 v3.3 proxy on :3142 → `https://nano-check.pn-26f.workers.dev` (`--allow
  nano_1jyx763fmsr851ieufnztwh7jed8sssixhd4bsgwcj3rd31iwxaxtendnhu3 --cap-xno 0.002`), banner `paying from
  nano_3ydt5r1rt549qng8jbzetyrzdhbteyd9bgw75fgrmszqbbfo6pdd57pe8jwe (seed index 14)`. Port 3142 was free before the start
  (checked with ss), unlike on 10-15.
- 17:43 funded 0.01 XNO to that address (ledger 430, block 160F9F3AEDC8D726483B199092F7D2977E5E29F202B092578B09305667744BE8).
- 17:43:16 CHECK 2, first call: `GET /v1/check?address=<throwaway>` through :3142. The proxy pocketed the receivable (open
  block 5614FCA6D75AFCB7A49813762BB297AD2CB8CE0A363B2FBB82E1D329FE1E1C48), sent 0.001 XNO to kepler (send
  E2F76184F513540F39D971F713476A0C2BF7203E082B77330BBCD496A13AB68D, confirmed on my node) and answered **200 `paid: true`
  in 7.4 s**, the payment hash in the body.
- 17:43:44 to 17:44:44 the identical request five more times, every 15 s. **Each 200 in under 2 ms with
  `x-payer-replayed: 1`** and the body the first payment bought. No second signature: the throwaway's chain holds exactly
  two blocks, the open and the one send (c2-account-history.json). On 10-15 the same second call paid again.
- 17:45:01 proxy stopped by PID, checked dead with ps and the port free with ss (proxy-stopped.txt).
- 17:45:12 sweep of the remaining 0.009 XNO to the hot wallet with llmrt's own primitives:
  799D8C07B0E98AEC4432C1E11BE7D9265D4C372BBE38766D867C11415563A1A7. The throwaway is in my own-addresses list; the sweep
  is my own money. Test spend: 0.001 XNO to kepler for one delivered answer, replayed five times.

## Reading

Finding 3 of the 10-15 record is closed on the live door: a 200 delivered inside the synchronous window is cached, and an
identical request afterwards replays it without a second block. Findings 1 and 2 stay fixed (the code on those paths is
unchanged since 10-13). The in-flight join (the other half of finding 3's 10-15 note) is still verified offline only, for
the same reason as on 10-15: no door on my list confirms slowly enough to take that path. The `TransportError` path was not
exercised live either; T-series offline only.

With this, the three findings of the 10-10 gate each have a live closure on the kepler door, and the bundle is what the
10-10 changelog said it was. What this is not: a review of the proxy as a whole, or a statement about the NanoGPT door
family, where check 1 passes via statusUrl/completeUrl and the new completeUrl cache write has not been driven against a
real door.

## Files

check2.sh (the script), c2-start.txt, c2-result.txt, c2-headers.txt, c2-body.json (first call); c2-replay-log.txt,
c2-replay-headers-N.txt, c2-replay-body-N.json (N = 1 to 5, all replays); c2-account-history.json (the throwaway's chain:
open, one send to kepler); gate.txt; proxy-kepler.log; proxy-stopped.txt; state-kepler.json (the proxy's own record);
sweep.py, sweep.txt. The seed file stays on my box.
