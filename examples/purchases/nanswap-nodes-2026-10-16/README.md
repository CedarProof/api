# Nanswap Nodes x402 door, bought 2026-10-16

Nanswap launched per-request RPC over an x402-shaped HTTP 402 at https://nodes.nanswap.com (docs: https://nodes.nanswap.com/x402/docs) on 2026-10-16, two days after pursekeeper asked for a per-proof `work_generate` sold that way. Prices are $0.00003 per credit, quoted live in raw XNO (or NANUSD): any read 1 credit, `process` 5, `work_generate` 25. The payment block may be sent **without work**; the proxy computes it (25-credit minimum on that path, 1 credit with own work). One payment buys credits behind a bearer token.

The shape is x402 v1 (`X-PAYMENT` header, `x402Version: 1`, network `nano-mainnet`, token in `X-PAYMENT-RESPONSE`), not the v2 `PAYMENT-SIGNATURE` shape of the scheme in review at x402-foundation/x402#3432, so `client.js` here is an 80-line purpose-built client (nanocurrency lib), not the stock `client-x402.js`.

Four calls from pursekeeper's x402 test account (its own account, funded from its hot wallet; not a counterparty):

| time (UTC) | call | work on payment block | credits | XNO | block | result |
|---|---|---|---|---|---|---|
| 13:28:23 | `work_generate` for the account's own frontier | none (Nanswap generated it) | 25 | 0.0022354694485842027 | `0565F96DD23810815F7836BFA78CC29C8D3FA4773D9C4D697D9533E3F63A0530` | 200 in 864 ms round trip, 1.18 s quote to answer; remaining 0 |
| 13:28:49 | `account_info` | own (local work server) | 2 | 0.00017883755588673621 | `C2834B22FB41C70BD0BB66FFE971C077C5F6635DE5DFAE67F83CA98EEAF02A06` | 200 in 474 ms; token issued; remaining 1 |
| 13:29:04 | `block_count` with the token | - | - | - | - | 200 in 192 ms; remaining 0 |
| 13:29:05 | `block_count` with the token again | - | - | - | - | 402 with the quote in 170 ms |

Both blocks are confirmed on pursekeeper's own node (heights 121 and 122 of the test account), subtype send, link = the quoted `payTo`. The work Nanswap put on the first payment block is the same value it served as the `work_generate` answer, because both were for the same hash.

Files: `run-*.json` are the timed records (the first is reconstructed from the console transcript; the original file was overwritten by the second run's same-minute stamp, fixed in `client.js` since). The token file is not published (0 credits left on it anyway).

First seller seen that accepts a workless payment block. Every agent that has paid in Nano so far needed a work server or a GPU to send.
