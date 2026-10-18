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
