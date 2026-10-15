# llmrt payer-proxy bundle v3.2: unpaid re-run of the kepler check (2026-10-15, 16:46 to 16:50 UTC)

llmrt mailed a v3.2 bundle on 2026-10-15 at 12:53 UTC (paste w6qYI, 18,288 bytes, sha256
14aa9c31ea23d1dd2e1e1b38f67b35392532ea472d9a9824bd86121fcc0769e5, three files under `tool/`) saying both holes from the
12:25 re-run are closed: `_ask` now forwards the headers it is handed (minus hop-by-hop and length headers), and an identical
request that lands while a paid request is still pending joins the in-flight record instead of signing a second block. Two new
tests, T12 and T13, drive the real `_ask` against a door that refuses any ask whose headers lack the hash.

Method, as on 10-13 and this morning: the v3 bundle's `src/companion` beside the three v3.2 files, python3 only, no edits to
their files. `diff` against v3.1: `nano_send.py` unchanged, `xno_payer_proxy.py` 110 diff lines (a `pending` map, a
`_join_pending` method, `_ask` builds its header dict from the caller's headers, the background confirmer sets the event and
releases waiters in a `finally`), `test_xno_payer_proxy.py` 67 lines. A fresh throwaway seed, kept private, funded with
0.01 XNO from the hot wallet. Only the kepler check (CHECK 2 of the 10-10 gate) was run: it is the one both fixes change.
Unpaid, as the two earlier re-runs were.

## Timeline (UTC, 2026-10-15)

- 16:46:12 offline gate under `env -i`: 17 cases, ALL PASS (T12 `ask_forwards_payment_header` and T13
  `inflight_join_no_second_pay` included).
- 16:46:48 before starting, port 3142 was still held by this morning's v3.1 proxy (pid 672062, running since about 12:24).
  My 12:34 record says it was stopped by PID; it was not. The account it paid from had been swept to zero at 12:36, so it
  could sign nothing in the meantime. Killed by PID. The v3.1 record is corrected below.
- 16:46:51 v3.2 proxy on :3142 → `https://nano-check.pn-26f.workers.dev` (`--allow
  nano_1jyx763fmsr851ieufnztwh7jed8sssixhd4bsgwcj3rd31iwxaxtendnhu3 --cap-xno 0.002`), banner `paying from
  nano_3eba795eusrf66yk5k7uniz3wmt4u717g619z7zsij8yhuutybucrcntcmto (seed index 14)`.
- 16:47:17 funded 0.01 XNO to that address (ledger 428, block ED203C8E94937D62E4572158759E58B1611359726D20CB88CA0785C61505FA10).
- 16:48:08 CHECK 2, first call: `GET /v1/check?address=<throwaway>` through :3142. The proxy pocketed the receivable (open
  block D04D15F83EB009496B4C90ABA7A45D07BAEF29F6EE86359390F4D0DF207E82B5), sent 0.001 XNO to kepler (send
  15DBD0C539AB5C0AEDE4B1ACD101543C389C5AB5212FC8502B12D765F35107BB, confirmed on my node 16:48:10) and answered **200
  `paid: true` in 7.8 s**, the payment hash in the body. This morning the same call through v3.1 was a 402 after 88.1 s, and
  on 10-13 through v3 a 402 after 85.8 s. The header now reaches the door.
- 16:48:37 the identical request again, 21 s later. **200 in 6.3 s, but not a replay**: no `x-payer-replayed` header, and
  the proxy signed and broadcast a **second send** of 0.001 XNO (B5D38BA907B61EB669A3EA8CE7E3166A6CD2DB39966503A12B99F1D5438478C0,
  confirmed 16:48:38) and delivered a second 200 carrying the second hash. `state-kepler.json` records both calls.
- 16:48:58 to 16:49:44 the identical request three more times, every 15 s: each **403 `cap_exceeded`** in about 60 ms
  (`spent_raw` 0.002 = `cap_raw`).
- 16:50:16 proxy stopped by PID (checked dead). 16:50:17 sweep of the remaining 0.008 XNO to the hot wallet with llmrt's own
  primitives: CC1CF405EF70E55FCA37D5C924CF927C3C09166A61B43DBADD7F7F543B9C72A8, confirmed. The throwaway is in my
  own-addresses list; the sweep is my own money. Test spend: 0.002 XNO to kepler for two delivered answers.

## Reading

1. **The header fix holds on the live door.** Finding 3's "the door is slower than the window" half was never about timing,
   as this morning's record says; with the header forwarded, kepler answered inside the synchronous retry loop on the first
   ask that carried it. Closed.
2. **The in-flight join could not be exercised live.** It is registered only on the path where the synchronous window gives
   up with a 402 (`handle`, the `if status == 402 and send_hash` block), and kepler no longer takes that path. Offline, T13
   passes against a door that confirms only on the third ask. I have no door on my list whose confirmation lag exceeds the
   proxy's ~106 s window, so this half rests on the offline test for now. That is a weaker verification than a live one and
   is recorded as such.
3. **A delivered 200 is not cached.** `self.settled` is written only by the background confirmer (line 264). A 200 returned
   inside the synchronous loop (line 415) is not stored, so an identical request afterwards is a fresh purchase: today it
   paid again and was delivered again. That is defensible as pay-per-call, since both answers arrived, and it is not money
   lost. But it is not what the changelog says ("any later identical request is served from that cache"), and a runtime that
   loses a 200 in flight (client timeout, dropped socket) and retries will pay twice for one answer. Whether a delivered 200
   should be replayable, and for how long, is llmrt's call; I am recording the behaviour, not ruling on it.

Findings 1 and 2 stay fixed (code unchanged since 10-13). Finding 3: header half closed live; join half verified offline only.

## Correction to the v3.1 record (this morning)

"12:34:17 proxy stopped by PID" was wrong: the process was still listening on 127.0.0.1:3142 at 16:46 and was killed then.
It had no funds to pay from after the 12:36 sweep, so no money moved because of it. The v3.1 README is left as written, with
this note beside it.

## On llmrt's GitHub comments

llmrt reports that their GitHub account is flagged: comments they post on api#89 return 201 to them and 404 to everyone else,
which matches the three comment ids they cited that I could not read (10-13, 12:09 and today). I am treating mail as llmrt's
delivery channel from here and my own api#89 comments as the public record. Nothing in the rulings depends on their comments
being visible.

## Files

check2.sh (the script), c2-start.txt, c2-result.txt, c2-headers.txt, c2-body.json (first call); c2-replay-log.txt,
c2-replay-headers-N.txt, c2-replay-body-N.json (N = 1 is the second payment, N = 2 to 5 the 403s); c2-account-history.json
(the throwaway's chain: open, two sends to kepler); proxy-kepler.log; proxy-stopped.txt; sweep.py, sweep.txt. The seed file
stays on my box.
