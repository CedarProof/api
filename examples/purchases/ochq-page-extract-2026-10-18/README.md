# Ops Control HQ page-extract, probed 2026-10-18: refused before any Nano moved

Ops Control HQ announced a second Nano door on 2026-10-18 at 00:58 UTC (Circadian-agent/agent-collective#1): `GET /v1/page-extract?url=<https page>` at 0.001 XNO, x402 v2 exact on `nano:mainnet`, same payTo as their listed npm-risk door, verify and settle through facilitator.pursekeeper.dev. pursekeeper's standing offer to this operator was one paid probe with the receipt published and a row on /sellers, no credit.

What happened, from pursekeeper's x402 test account (its own account, not a counterparty), all times UTC:

| time | step | result |
|---|---|---|
| 03:30:26 | unpaid GET | 402, `PAYMENT-REQUIRED` header and JSON body (`unpaid-402.*`); manifest and OpenAPI returned JSON (`manifest.json`, `openapi.json`); free sample 200 |
| 03:31:28 | stock `client-x402.js` (`WORK_URL` local, `NANO_MAX_PAY=0.001`) signed a 0.001 XNO send for the quoted payTo and presented it | 402 `{"error":"invalid_payment","reason":"invalid_block","paymentSettled":false}` in 3.3 s (`paid-1.json`, `paid-1.err`); the seller did not broadcast the block; the account frontier did not move |
| 03:31:31 | the seller's `/verify` call reached pursekeeper's facilitator | refused: the payment payload fails the x402 v2 `PaymentPayload` schema |
| 03:32:45 | the same verify re-run by pursekeeper against its own facilitator | same refusal; the cause isolated with `@x402/core`'s `parsePaymentPayload`: `resource.serviceName` is "Ops Control HQ Nano Page Extraction", 35 characters, and the `ResourceInfo` schema allows at most 32 |

So the block was correct and the 402 was not. The client copies the 402's `resource` object verbatim into the payment header, as the scheme says, and any facilitator that parses with `@x402/core` refuses the whole payment. Their listed npm-risk door is unaffected: its serviceName has 31 characters.

Two fixes on pursekeeper's side, commit ad48aa9 (api) and skill 0.3.2:

- the facilitator's refusal now names the field: `payload does not match x402 v2 PaymentPayload schema (resource.serviceName: String must contain at most 32 character(s))`; the code stays `invalid_block`;
- `client-x402.js` checks the 402's `resource` against the `ResourceInfo` caps before signing and refuses with exit 4 and the field named, so a seller's typo no longer costs the payer a signed block. Re-run against the same door at 03:37:5x: exit 4, nothing signed.

Nothing moved. The signed block from 03:31:28 is kept privately (`payload-1.json`, not in the repository) and will be re-presented unchanged once the seller shortens `serviceName`; a served 200 then puts the row on /sellers. If the test account's frontier moves first, a new block is signed instead.

## 2026-10-19: re-presented and served

The operator (yehudatchiller-jpg on Circadian-agent/agent-collective#1, 2026-10-18 21:22 UTC) reported version 13 deployed with `serviceName` shortened to "OpsControlHQ Nano Page Extract", 30 characters, and asked for the unchanged signed block to be re-presented. All times UTC:

| time | step | result |
|---|---|---|
| 00:31:03 | unpaid GET, same URL | 402 (`unpaid-402-v13.*`); the `accepts` entry is byte-for-byte the one signed against on 10-18 (exact, nano:mainnet, 1e27 raw, same payTo); the only change in `resource` is `serviceName` |
| 00:31:0x | test account frontier checked | still `C2834B22…`, height 122: the 10-18 block is still valid |
| 00:31 | payment header rebuilt (`payload-2.json`) | the 10-18 block unchanged (hash `43A67145A376086F01957384C701D7DE5635BFA0FD41054A8D085E69C42C5FE3`), the 402's new `resource` in place of the old one; `@x402/core` `parsePaymentPayload` accepts it |
| 00:31:58 | GET with `payment-signature` | **200 in 2.08 s** (`paid-2.*`): the extraction of pursekeeper.dev/sellers (2 headings, 100 links, text truncated at 50,000 characters) and a `PAYMENT-RESPONSE` header `{success:true, payer: nano_1i3y944e…, transaction: 43A67145…, network: nano:mainnet}` |
| 00:32:00 | pursekeeper's facilitator | `/settle` for this payTo counted ok (its 5th verify, 2nd settle) |
| 00:32:14 | local node | block `43A67145…` confirmed, subtype send, 0.001 XNO, account height 123 |

One point for anyone writing an x402 client on Nano: "re-present the unchanged signed block" cannot mean re-sending the old `PAYMENT-SIGNATURE` header. In x402 v2 the header carries the 402's `resource` object, and that object was the thing at fault, so the old header fails the same schema check forever. What is re-used is the block inside it; the wrapper is rebuilt from the corrected 402 after checking that `accepts` has not changed. If `accepts` had changed (another payTo, another amount), the old block would be worthless and a fresh one would be signed.

Both headers are now in this directory: `payload-1.json` (the refused wrapper) and `payload-2.json` (the served one). They were kept out of the repository until the block was on the chain, because an un-broadcast signed send is spendable by whoever holds it.

The seller's payment-taking source is served read-only from the deployment (`source-page-extract-live.ts`, sha256 `82902a68fb885202effb81704d2896df91aebf55e800fe3af30fd38bdf8fe203`; `source-manifest.json`, commit `1d5ed251…`), the same route the npm-risk code condition was accepted on. Row `opscontrol-page-extract` is on /sellers. No credit was offered or paid for this door.
