'use strict';
// Purpose-built client for Nanswap Nodes' x402 door (https://nodes.nanswap.com/x402/docs), 2026-10-16.
// It is x402 v1-shaped: X-PAYMENT header, network "nano-mainnet", work optional, bearer token for the remainder.
// Usage: NANO_SEED=<hex> node client.js <action-json> [credits] [--own-work]
//   credits: how many credits to buy with the payment (default: the quote's no-work minimum, 25)
//   --own-work: compute work via WORK_URL and send it (then 1 credit is enough)
//   TOKEN=x402_...: spend an existing token instead of paying
const N = require('nanocurrency');
const fs = require('fs');
const BASE = 'https://nodes.nanswap.com';
const body = process.argv[2] || '{"action":"version"}';
const creditsArg = process.argv[3] && !process.argv[3].startsWith('--') ? BigInt(process.argv[3]) : null;
const ownWork = process.argv.includes('--own-work');
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = s => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const t0 = Date.now(); const ms = () => (Date.now() - t0) + 'ms';
const rec = { started: new Date().toISOString(), base: BASE, body: JSON.parse(body), steps: [] };
const step = (name, data) => { rec.steps.push({ at: ms(), name, ...data }); console.error(ms(), name, JSON.stringify(data).slice(0, 400)); };
const outDir = __dirname; const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 17);

(async () => {
  const headers = { 'content-type': 'application/json' };
  if (process.env.TOKEN) {
    headers['x-payment-token'] = process.env.TOKEN;
    step('spend-token', { token_prefix: process.env.TOKEN.slice(0, 10) });
  } else {
    if (!process.env.NANO_SEED) { console.error('set NANO_SEED'); process.exit(2); }
    const sk = N.deriveSecretKey(process.env.NANO_SEED, Number(process.env.NANO_INDEX || 0));
    const pk = N.derivePublicKey(sk); const account = N.deriveAddress(pk, { useNanoPrefix: true });
    const action = JSON.parse(body).action;
    const q = await (await fetch(`${BASE}/x402/quote?action=${encodeURIComponent(action)}`)).json();
    const offer = q.accepts.find(a => a.scheme === 'exact' && a.network === 'nano-mainnet' && a.asset === 'XNO');
    if (!offer) throw new Error('no XNO offer: ' + JSON.stringify(q));
    step('quote', { payTo: offer.payTo, basePriceRaw: offer.extra.basePriceRaw, minPaymentRaw: offer.extra.minPaymentRaw, minWithOwnWork: offer.extra.minPaymentRawWithOwnWork, assetUsdPrice: offer.extra.assetUsdPrice, actionCredits: offer.extra.actionCredits });
    const base = BigInt(offer.extra.basePriceRaw);
    const credits = creditsArg ?? (ownWork ? BigInt(offer.extra.actionCredits[action] || offer.extra.actionCredits.default) : BigInt(offer.extra.minPaymentRaw) / base);
    const amount = base * credits;
    const cap = BigInt(Math.round(Number(process.env.NANO_MAX_PAY || '0.01') * 1e6)) * (10n ** 24n);
    if (amount > cap) { step('refused', { amount: amount.toString(), cap: cap.toString() }); process.exit(3); }
    const fr = await (await fetch(`${BASE}/x402/frontier/${account}`)).json();
    step('frontier', fr);
    const newBal = BigInt(fr.balance) - amount; if (newBal < 0n) throw new Error('insufficient');
    let w = null;
    if (ownWork) {
      const r = await (await fetch(process.env.WORK_URL || 'http://127.0.0.1:3007', { method: 'POST', body: JSON.stringify({ action: 'work_generate', hash: fr.frontier, difficulty: 'fffffff800000000' }) })).json();
      if (!r.work) throw new Error('work failed ' + JSON.stringify(r)); w = r.work; step('own-work', { work: w });
    }
    const { block, hash } = N.createBlock(sk, { work: w, previous: fr.frontier, representative: fr.representative, balance: newBal.toString(), link: offer.payTo });
    block.account = block.account.replace(/^xrb_/, 'nano_');
    if (!w) delete block.work; else block.work = w;
    step('signed', { hash, amount: amount.toString(), xno: Number(amount) / 1e30, credits: credits.toString(), work: block.work || '' });
    rec.hash = hash; rec.amount_raw = amount.toString(); rec.credits_bought = credits.toString();
    headers['x-payment'] = b64({ x402Version: 1, scheme: 'exact', network: 'nano-mainnet', payload: { block } });
  }
  const t1 = Date.now();
  const res = await fetch(`${BASE}/XNO`, { method: 'POST', headers, body });
  const text = await res.text();
  const h = Object.fromEntries([...res.headers.entries()].filter(([k]) => /payment|credit|ratelimit/i.test(k)));
  let receipt = null; if (h['x-payment-response']) { try { receipt = unb64(h['x-payment-response']); } catch (e) { receipt = { raw: h['x-payment-response'] }; } }
  step('response', { status: res.status, round_trip_ms: Date.now() - t1, headers: h, receipt: receipt && { ...receipt, token: receipt.token ? receipt.token.slice(0, 8) + '…' : undefined }, body: text.slice(0, 600) });
  rec.status = res.status; rec.receipt_public = receipt && { ...receipt, token: undefined }; rec.body = text.slice(0, 2000); rec.headers = h;
  if (receipt && receipt.token) fs.writeFileSync(`${outDir}/token-${stamp}.json`, JSON.stringify({ token: receipt.token, credits: receipt.credits, remaining: receipt.remaining, at: new Date().toISOString() }) + '\n', { mode: 0o600 });
  rec.finished = new Date().toISOString();
  fs.writeFileSync(`${outDir}/run-${stamp}.json`, JSON.stringify(rec, null, 1) + '\n');
  console.log(JSON.stringify({ status: res.status, receipt: rec.receipt_public, body: text.slice(0, 300) }));
})().catch(e => { console.error('ERR', e.message); rec.error = e.message; fs.writeFileSync(`${outDir}/run-${stamp}-error.json`, JSON.stringify(rec, null, 1) + '\n'); process.exit(1); });
