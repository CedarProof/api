// Mock door for Review B fail-closed cases. Serves 402 quotes with a chosen defect per env MOCK_MODE.
// Modes: cap_hit (huge amount), allow_miss (payTo not on allow-list), changed_quote (amount grows on
// re-present), network_error (drop the connection), ok (normal quote).
const http = require('http');
const PORT = Number(process.env.MOCK_PORT || 3403);
const MODE = process.env.MOCK_MODE || 'ok';
// A syntactically valid account (the proxy calls checkAddress before any amount check).
const PAYTO = process.env.MOCK_PAYTO || 'nano_11131a3ia3a81w61k4id3i8iw5ri46b3871o4rdji8at5eg3t9izij86w3hz';
// The reviewer's own address, used only by the allow-list-miss case so a rejection there cannot be
// confused with a malformed-quote rejection.
const OTHER = 'nano_1zow151ycd1xcdt5h911dxmb5frpowk5z63fus6ycwghk9p7rzoyemirsiwk';
const seen = new Map();

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => (body += c));
  req.on('end', () => {
    if (MODE === 'network_error') {
      req.socket.destroy();  // no response at all
      return;
    }
    const paid = req.headers['payment-signature'] !== undefined;
    // changed_quote: the first (unpaid) presentation quotes a small price; once the caller has paid and
    // the door is asked again, it quotes above the caller's per-call ceiling. A proxy that re-reads the
    // quote must refuse instead of signing the larger amount.
    let amount = '10000000000000000000000000';
    if (MODE === 'cap_hit') amount = '900000000000000000000000000000';
    if (MODE === 'changed_quote' && paid) amount = '900000000000000000000000000000';
    if (paid && MODE === 'ok') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'served' } }] }));
      return;
    }
    // exact dialect via PAYMENT-REQUIRED header
    const quote = {
      x402Version: 2,
      accepts: [{
        scheme: 'exact', network: 'nano:mainnet',
        payTo: MODE === 'allow_miss' ? OTHER : PAYTO,
        amount,
        resource: 'http://127.0.0.1:' + PORT + '/v1/chat/completions',
        maxTimeoutSeconds: 60,
        extra: {},
      }],
    };
    seen.set(req.url, true);
    res.writeHead(402, { 'content-type': 'application/json', 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify(quote)).toString('base64') });
    res.end(JSON.stringify({ error: 'payment required' }));
  });
});
server.listen(PORT, '127.0.0.1', () => console.log('mock door on ' + PORT + ' mode=' + MODE));

