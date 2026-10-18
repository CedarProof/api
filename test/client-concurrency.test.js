// node --test  (run from api/). One wallet, ten concurrent purchases, through the stock client examples/client-x402.js.
//
// CasualSecurityInc's x402.Nano review (7c55f32, pursekeeper/api#90, 2026-10-18) asked what contract the client gives ten
// subagents paying through one seed: ten sends prepared against one frontier are competing continuations of one account
// chain, one lands, the rest are refused frontier_moved, and no per-hash lock on the seller side can order them. Their
// deterministic model completes 1 of 10 without a wallet writer and 10 of 10 with one. These tests run the real client,
// ten processes at once, against a mock seller and a mock account-info service on loopback (no node, no funds, a
// throwaway seed), and check: (1) with the per-account lock, 10 of 10 served in order; (2) with NANO_LOCK=0 and all ten
// reading the same frontier, 1 of 10 and the nine losers told to sign anew, not to re-present; (3) a receive by another
// writer between the frontier read and the paid call: that block is dead, the client says so, the next writer continues;
// (4) a lost reply after the block landed: the client reads the fate from the account and says re-present, and the
// writers behind it continue; (5) a live holder past NANO_LOCK_WAIT_MS: exit 5, nothing signed, nothing sent; (6) a stale
// holder (process gone, or older than NANO_LOCK_MAX_MS) is taken over.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const N = require('nanocurrency');

const CLIENT = path.join(__dirname, '..', 'examples', 'client-x402.js');
const SEED = '0'.repeat(64);   // throwaway: never funded, never opened on the chain
const PAY_TO = N.deriveAddress(N.derivePublicKey(N.deriveSecretKey(SEED, 1)), { useNanoPrefix: true });
const AMOUNT = '1000000000000000000000000';   // 0.000001 XNO in raw
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64');
const unb64 = s => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
const randomHash = () => require('node:crypto').randomBytes(32).toString('hex').toUpperCase();

// A seller plus the account-info service the client reads, sharing one simulated account chain.
// opts.barrier: hold every account_info reply until that many are waiting, then answer all with the same frontier (forces
//   the uncoordinated collision the way the model's schedule does; without it the fastest process may finish first).
// opts.receiveAfter: right after the n-th account_info reply, another writer lands a receive (frontier moves, balance grows).
// opts.loseReplyOnce: the first paid call lands the block, then the socket is destroyed before any reply.
function mock(opts = {}) {
  const state = { frontier: randomHash(), balance: '5000000000000000000000000000', chain: new Set(), issued: new Set(), landed: 0, served: 0, refused: 0, probes: 0, infoReplies: 0, paidCalls: 0 };
  const waiting = [];
  const info = () => ({ found: true, frontier: state.frontier, balance_raw: state.balance, representative: PAY_TO, block_count: 1 });
  let lost = false, barrierDone = false;   // the barrier is one-shot: the losers' later fate reads must not wait behind it
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (code, body, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/v1/account_info') {
      const reply = () => { state.infoReplies++; json(200, info()); if (opts.receiveAfter && state.infoReplies === opts.receiveAfter) { state.frontier = randomHash(); state.balance = (BigInt(state.balance) + 1000n).toString(); } };
      if (opts.barrier && !barrierDone) { waiting.push(reply); if (waiting.length >= opts.barrier) { barrierDone = true; while (waiting.length) waiting.shift()(); } return; }
      return reply();
    }
    if (u.pathname === '/v1/verify') return json(200, { hash: u.searchParams.get('hash'), found: state.chain.has(String(u.searchParams.get('hash')).toUpperCase()) });
    if (u.pathname !== '/buy') return json(404, { error: 'no such endpoint' });
    const sig = req.headers['payment-signature'];
    // Each quote carries its own price (base + the probe's number): ten purchases from one frontier at one price would be
    // ten byte-identical blocks, one hash, which the seller's per-hash lock does serialise; the review's case is ten
    // distinct sends (different sellers, prices or links), so the quotes differ here and so do the blocks.
    if (!sig) { state.probes++; const amount = (BigInt(AMOUNT) + BigInt(state.probes)).toString(); state.issued.add(amount);
      const pr = { x402Version: 2, resource: { url: 'http://127.0.0.1/buy' }, accepts: [{ scheme: 'exact', network: 'nano:mainnet', asset: 'XNO', amount, payTo: PAY_TO, maxTimeoutSeconds: 60, extra: { work: 'optional' } }] };
      return json(402, { x402: pr }, { 'payment-required': b64(pr) }); }
    state.paidCalls++;
    let block; try { block = unb64(sig).payload.block; } catch { state.refused++; return json(402, { error: 'bad payment header' }); }
    if (String(block.previous).toUpperCase() !== state.frontier) { state.refused++; return json(402, { error: 'block.previous is not the account frontier (' + state.frontier + ')' }); }
    if (!state.issued.has((BigInt(state.balance) - BigInt(block.balance)).toString())) { state.refused++; return json(402, { error: 'wrong amount' }); }
    const hash = N.hashBlock({ account: block.account, previous: block.previous, representative: block.representative, balance: block.balance, link: block.link });
    if (!N.verifyBlock({ hash, signature: block.signature, publicKey: N.derivePublicKey(block.account) })) { state.refused++; return json(402, { error: 'bad signature' }); }
    state.frontier = hash.toUpperCase(); state.balance = block.balance; state.chain.add(state.frontier); state.landed++;
    if (opts.loseReplyOnce && !lost) { lost = true; return res.socket.destroy(); }
    state.served++;
    return json(200, { served: true, hash }, { 'payment-response': b64({ success: true, transaction: hash, network: 'nano:mainnet' }) });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ state, server, origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(r => server.close(r)) })));
}

function run(origin, lockDir, env = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [CLIENT, origin + '/buy'], { env: { PATH: process.env.PATH, NANO_SEED: SEED, API: origin, NANO_MAX_PAY: '0.001', NANO_LOCK_DIR: lockDir, ...env } });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({ code, out, err }));
  });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'client-lock-'));
const account = () => N.deriveAddress(N.derivePublicKey(N.deriveSecretKey(SEED, 0)), { useNanoPrefix: true });
const lockFile = dir => path.join(dir, 'pursekeeper-wallet-' + account() + '.lock');

test('ten concurrent purchases through one wallet: the per-account lock orders them, 10 of 10 served', async () => {
  const m = await mock(); const dir = tmp();
  const rs = await Promise.all(Array.from({ length: 10 }, () => run(m.origin, dir)));
  await m.close();
  assert.deepEqual(rs.map(r => r.code), Array(10).fill(0), rs.map(r => r.err).join('\n---\n'));
  assert.equal(m.state.served, 10); assert.equal(m.state.refused, 0); assert.equal(m.state.landed, 10);
  assert.ok(rs.filter(r => /waiting for the wallet lock/.test(r.err)).length >= 1, 'a process behind another says it waited (process start-up is staggered, so not all ten contend)');
  assert.equal(fs.existsSync(lockFile(dir)), false, 'the lock is released at exit');
});

test('NANO_LOCK=0, all ten reading one frontier: 1 of 10 served, the nine refused are told to sign anew (the model\'s 1/10)', async () => {
  const m = await mock({ barrier: 10 }); const dir = tmp();
  const rs = await Promise.all(Array.from({ length: 10 }, () => run(m.origin, dir, { NANO_LOCK: '0' })));
  await m.close();
  assert.equal(m.state.served, 1); assert.equal(m.state.refused, 9); assert.equal(m.state.landed, 1);
  assert.equal(rs.filter(r => r.code === 0).length, 1);
  const losers = rs.filter(r => r.code !== 0);
  assert.equal(losers.length, 9);
  for (const r of losers) {
    assert.equal(r.code, 1);
    assert.match(r.err, /the account frontier moved past [0-9A-F]{64} to another block, not this one/);
    assert.match(r.err, /sign a new block for this call/);
    assert.doesNotMatch(r.err, /re-present the same PAYMENT-SIGNATURE/, 'a dead block must not be re-presented');
  }
});

test('a receive by another writer between the frontier read and the paid call: that block is dead, said so, and the next writer continues', async () => {
  const m = await mock({ receiveAfter: 3 }); const dir = tmp();
  const rs = await Promise.all(Array.from({ length: 10 }, () => run(m.origin, dir)));
  assert.equal(m.state.served, 9); assert.equal(m.state.refused, 1);
  const dead = rs.filter(r => r.code !== 0);
  assert.equal(dead.length, 1);
  assert.match(dead[0].err, /a concurrent payment, a receive or a representative change from this wallet landed first/);
  assert.match(dead[0].err, /sign a new block/);
  const again = await run(m.origin, dir);   // the caller does what the line says
  await m.close();
  assert.equal(again.code, 0); assert.equal(m.state.served, 10);
});

test('a lost reply after the block landed: the fate is read from the account (landed, re-present), the writers behind continue', async () => {
  const m = await mock({ loseReplyOnce: true }); const dir = tmp();
  const rs = await Promise.all(Array.from({ length: 10 }, () => run(m.origin, dir)));
  await m.close();
  assert.equal(m.state.landed, 10); assert.equal(m.state.served, 9); assert.equal(m.state.refused, 0);
  const lost = rs.filter(r => r.code !== 0);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].code, 1);
  assert.match(lost[0].err, /no reply from the seller after the payment was sent/);
  assert.match(lost[0].err, /the block is on the chain \(hash [0-9A-F]{64}\): re-present the same PAYMENT-SIGNATURE/);
  assert.doesNotMatch(lost[0].err, /; sign a new block for this call/);
  assert.doesNotMatch(lost[0].err, /^error:/m, 'a lost reply is resolved, not reported as a bare error');
});

test('a live holder past NANO_LOCK_WAIT_MS: exit 5, nothing signed, no paid call', async () => {
  const m = await mock(); const dir = tmp();
  fs.writeFileSync(lockFile(dir), process.pid + ' ' + Date.now());   // this test process holds it and stays alive
  const r = await run(m.origin, dir, { NANO_LOCK_WAIT_MS: '400' });
  await m.close();
  assert.equal(r.code, 5);
  assert.match(r.err, /waited 0 s for the wallet lock/);
  assert.doesNotMatch(r.err, /signed block/);
  assert.equal(m.state.paidCalls, 0); assert.equal(m.state.infoReplies, 0); assert.equal(m.state.probes, 1);
  assert.equal(fs.readFileSync(lockFile(dir), 'utf8').split(' ')[0], String(process.pid), 'a live holder\'s lock is left alone');
});

test('a stale holder is taken over: process gone, or held longer than NANO_LOCK_MAX_MS', async () => {
  const m = await mock(); const dir = tmp();
  const gone = spawn(process.execPath, ['-e', '']); await new Promise(r => gone.on('close', r));
  fs.writeFileSync(lockFile(dir), gone.pid + ' ' + Date.now());
  const a = await run(m.origin, dir);
  assert.equal(a.code, 0); assert.match(a.err, /wallet lock .* is stale \(its process is gone\); taking it over/);
  fs.writeFileSync(lockFile(dir), process.pid + ' ' + (Date.now() - 5000));
  const b = await run(m.origin, dir, { NANO_LOCK_MAX_MS: '1000' });
  await m.close();
  assert.equal(b.code, 0); assert.match(b.err, /has held it 5 s\); taking it over/);
  assert.equal(m.state.served, 2);
  assert.equal(fs.existsSync(lockFile(dir)), false);
});
