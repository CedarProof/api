# llmrt payer-proxy bundle v3.1: unpaid re-run of the kepler check (2026-10-15)

llmrt mailed a v3.1 bundle on 2026-10-15 at 12:09 UTC (paste hk90m, 16,723 bytes, sha256
7c739efbd20577991d706afd553b5482121eb2ad99c8af0c142be52d669bf8a9, three files under `tool/`) with a changelog
saying finding 3 is now complete: when the synchronous window gives up with the send hash in hand, a background thread keeps
asking the door with the same payment header and caches the settled 200, and any later identical request is served from that
cache with `x-payer-replayed: 1` and signs nothing. The mail cites an api#89 comment id (6191642046) that does not exist;
nothing from llmrt has been posted on api#89 since 2026-10-13.

Method: the v3 bundle extracted to a scratch directory, the three v3.1 files copied over it as the changelog says, python3
only, no edits to their files. `diff` against v3: `nano_send.py` unchanged, `xno_payer_proxy.py` additions only (no line
removed, so the synchronous path is the v3 one), `test_xno_payer_proxy.py` 45 lines. A fresh throwaway seed, kept private,
funded with 0.01 XNO from the hot wallet. Only the kepler check (CHECK 2 of the 10-10 gate) was run: it is the one whose
behaviour v3.1 claims to change, and the other two paths are unchanged code. Unpaid, as the 10-13 re-run was.

## Timeline (UTC, 2026-10-15)

- 12:18:09 offline gate from the clean copy under `env -i`: 15 cases, ALL PASS (T10, T10b, T11 included).
- 12:24:44 proxy :3142 → `https://nano-check.pn-26f.workers.dev` (`--allow nano_1jyx763fmsr851ieufnztwh7jed8sssixhd4bsgwcj3rd31iwxaxtendnhu3 --cap-xno 0.002`), banner `paying from nano_3o3pxia6zq8ccs8oqmhjdxf7885xggpi6fqz4re6sb64u8b64hndghq7drum (seed index 14)`.
- 12:25:16 funded 0.01 XNO to that address (ledger 425, block 51045B52DDB7D43B617019A8BBA75B6F3997F45620FC9DB4A78F6D5034BE800B).
- 12:25:33 CHECK 2, first call: `GET /v1/check?address=<throwaway>` through :3142. The proxy pocketed the receivable (open block 18D1AA80E121C849…), sent 0.001 XNO to kepler (send 5C32CAE47646ACCBBAA3A0CE4185E0AF5B0789D92C086A40A88B0B8E52D2E580, confirmed on my node at 12:25:35), then answered **402 after 88.1 s** with the hash in the body and header, `waited_seconds: 85.8`, `replay_ready: true`. Same shape as 10-13.
- 12:27:22 the identical request again, 21 s after that 402 (what a runtime that retries would do). The proxy did not serve from any cache and did not wait for its background thread: it **signed and broadcast a second send** of 0.001 XNO (41A0B3800FCAE8E362B32D4AD3CA8FFE18AE11D6B875B7A83D3FE5C09CDB52EB, confirmed 12:27:23; `state-kepler.json` records both), waited another 85.8 s and answered **402 again** with the second hash. This is the hole the changelog says v3.1 closes.
- 12:29:04 to 12:33:51 the identical request every 15 s (19 more times): every one **403 `cap_exceeded`** in about 60 ms (`spent_raw` 0.002 = `cap_raw`). No request was ever answered with `x-payer-replayed: 1`. The proxy log has no `background confirm settled` line for either hash.
- 12:33:10 by hand, read-only: the same GET straight to kepler with `X-Nano-Payment: 5C32CAE4…` answered **200 `paid: true`** in 0.72 s. The door had the first payment; the proxy never got the 200.
- 12:34:17 proxy stopped by PID. 12:36:00 sweep of the remaining 0.008 XNO to the hot wallet with llmrt's own primitives (`pk_work`, `_block_build`, `pk_process`): block C0A440DDF06F1662666A0C4469F3D8F9E2F2CAD388DD71809118342046E225DE. The throwaway is in my own-addresses list; the sweep is my own money.

## Why, from the code

`_ask` (xno_payer_proxy.py line 241) takes a `headers` argument and does not use it: the request is built with a literal
`{"content-type": "application/json", "user-agent": UA}`. So the synchronous retries (line 355) and the background
confirmer (line 227) both ask the door **without the `X-Nano-Payment` header** they were given, and kepler, which keys paid
on that header, answers 402 to every one of them. The offline gate passes because the test replaces `_ask` with a mock that
reads the headers it is handed (test lines 50, 84, 212). NanoGPT works through the `statusUrl`/`completeUrl` completion
protocol, which never goes through `_ask` with a payment header, which is why CHECK 1 passed on 10-13 while CHECK 2 did not.

Consequences, all seen live today:

1. Finding 3's timing half is not a timing problem. The 85.8 s window could be an hour and kepler would still answer 402,
   because the hash never reaches it. On 10-13 I read the 402 inside the window as the door being slower than the window;
   the manual re-present that "worked 50 s later" worked because it carried the header. That reading was wrong and is
   corrected here.
2. The background confirm never settles on a header-keyed door, so the replay cache is never filled, so nothing is ever
   replayed. `_lookup_settled` runs before the cap check (handle, line 276), which is the right order; it just never hits.
3. An identical retry while the background thread is still pending is not recognised as the same call: there is no
   in-flight record, only a settled one. It goes down the normal path and pays again. That is a second hole, independent of
   the header bug: even with `_ask` fixed, a retry inside the door's confirmation lag signs a second block unless pending
   requests are keyed and joined.

A one-line check that would have caught both before shipping: run the gate with a real door, or make the mock door refuse
any ask whose headers lack the payment hash **as sent by the real `_ask`** rather than by a stand-in.

## Result

Finding 3 is not closed in v3.1. Findings 1 and 2 stay fixed (unchanged code, verified 10-13). Two blocks were signed for one
check that the door had already accepted; 0.002 XNO went to kepler for one paid answer the proxy never delivered. The fix
is to pass `headers` through in `_ask` and to key in-flight paid requests so a retry joins the pending confirm instead of
paying; a re-run of this check on a corrected bundle is the test. Unpaid, as before.

## Files

c2-start.txt, c2-result.txt, c2-headers.txt, c2-body.json (first call); c2-replay-log.txt, c2-replay-headers-N.txt,
c2-replay-body-N.json (the identical request, N = 1 is the second payment, N ≥ 2 the 403s); c2-send-block-info.txt;
c2-manual-represent.txt, c2-manual-body.json (kepler by hand with the header); proxy-kepler.log; proxy-stopped.txt;
sweep.py, sweep.txt. The seed file stays on my box.
