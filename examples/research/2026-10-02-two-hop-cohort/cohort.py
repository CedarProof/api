#!/usr/bin/env python3
"""Two-hop cohort classification of every Nano payment pursekeeper has received.

    python3 cohort.py --rpc http://127.0.0.1:7076 [--ledger URL|file] [--own URL|file]
                      [--inputs file] [--max-id N] [--out DIR] [--private-mine file]

Inputs, all public unless noted:
  --ledger   pursekeeper's ledger export (default https://pursekeeper.dev/log.json, key "ledger")
  --own      pursekeeper's other accounts (default the api repo's data/own-addresses.json)
  --inputs   inputs.json beside this script: hot wallet, donation send hashes, exchange accounts
  --rpc      any Nano node RPC with account_history and account_info (the author used its own node)
  --private-mine  box-only: extra addresses treated as pursekeeper's money and never printed
             (the funding accounts behind tranches). Omit it: the author's run found none of them
             in any payer's history, so the public run gives the same classes.

Classes, first match wins, for each receipt (payer P, amount A, ledger time T):
  own              P (or the account behind a pass-through P) is pursekeeper's own. Not inflow.
  donation         the receipt's send hash is on the donation list.
  seeded-direct    the attributed payer had received a payment_out from pursekeeper before T.
  seeded-indirect  before T, the attributed payer had received >= A in total from pursekeeper's
                   accounts or from accounts pursekeeper had paid before T.
  mixed            some, but less than A, of its pre-T inbound came from such accounts.
  unseeded         nothing in its pre-T inbound traces to pursekeeper within two hops.
                   Sub-label: exchange (>= 50% of pre-T inbound from listed exchange accounts),
                   other, none (no receive before T in the history read).
Attribution: a pass-through wallet (<= 4 blocks, one funding account, emptied, opened and
emptied within 3600 s, at least one send to the hot wallet) is replaced by its funding account
before the rules run. A payer's funders are read from its newest HIST blocks; an account with
more blocks is flagged deep (older funders unseen; the error can only be toward "unseeded").
Chain timestamps are node-local; the comparison uses T + 1 s. Read-only.
"""
import json, os, sys, collections, datetime, urllib.request

RAW = 10**30
HIST = 2000
PASS_BLOCKS = 4
HERE = os.path.dirname(os.path.abspath(__file__))

def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
RPC = arg('--rpc', 'http://127.0.0.1:7076')

def fetch(src):
    if src.startswith('http'):
        req = urllib.request.Request(src, headers={'accept': 'application/json', 'user-agent': 'cohort.py'})
        with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)
    return json.load(open(src))

def rpc(**kw):
    req = urllib.request.Request(RPC, data=json.dumps(kw).encode(), headers={'content-type': 'application/json'})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

def xno(raw): return int(raw) / RAW
def fmt(v):
    s = f'{v:.6f}'.rstrip('0').rstrip('.'); return s or '0'
def short(a): return a[:14] + '…' if a and a.startswith('nano_') else (a or '')
def tsiso(s): return datetime.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp()

# ---- inputs --------------------------------------------------------------
LEDGER = fetch(arg('--ledger', 'https://pursekeeper.dev/log.json'))
LEDGER = LEDGER['ledger'] if isinstance(LEDGER, dict) else LEDGER
INPUTS = fetch(arg('--inputs', os.path.join(HERE, 'inputs.json')))
HOT = INPUTS['hot']
OWN = {HOT} | {a['address'] for a in fetch(arg('--own', 'https://raw.githubusercontent.com/pursekeeper/api/main/data/own-addresses.json'))['addresses']}
PRIVATE = set()
if arg('--private-mine'):
    PRIVATE = {a['address'] if isinstance(a, dict) else a for a in (lambda d: d['addresses'] if isinstance(d, dict) else d)(fetch(arg('--private-mine')))}
MINE = OWN | PRIVATE
EXCH = {e['account']: e['name'] for e in INPUTS['exchanges']}
DONATIONS = {h.upper() for h in INPUTS['donations']}
OUT = collections.defaultdict(list)
for r in LEDGER:
    if r['kind'] == 'payment_out': OUT[r['counterparty']].append(r)

# ---- chain reads ---------------------------------------------------------
_hist, _info = {}, {}
def history(acct):
    if acct not in _hist:
        h = rpc(action='account_history', account=acct, count=str(HIST)).get('history', [])
        _hist[acct] = list(reversed(h)) if isinstance(h, list) else []
    return _hist[acct]
def info(acct):
    if acct not in _info:
        r = rpc(action='account_info', account=acct)
        _info[acct] = None if 'error' in r else {'blocks': int(r['block_count'])}
    return _info[acct]

# ---- rules ---------------------------------------------------------------
def paid_before(acct, t): return [r for r in OUT.get(acct, []) if tsiso(r['ts']) < t]

def passthrough(p):
    h = history(p)
    if not h or len(h) > PASS_BLOCKS: return None
    recv = [x for x in h if x['type'] == 'receive']; send = [x for x in h if x['type'] == 'send']
    if len(recv) + len(send) != len(h) or not recv: return None
    funders = {x['account'] for x in recv}
    if len(funders) != 1: return None
    emptied = sum(int(x['amount']) for x in recv) == sum(int(x['amount']) for x in send)
    ts = [int(x.get('local_timestamp') or 0) for x in h]
    f = next(iter(funders))
    return f if (emptied and max(ts) - min(ts) <= 3600 and any(x['account'] == HOT for x in send) and f != p) else None

def funders_before(acct, t):
    h = history(acct); i = info(acct)
    out = collections.OrderedDict()
    for x in h:
        if x['type'] == 'receive' and int(x.get('local_timestamp') or 0) <= t + 1:
            out[x['account']] = out.get(x['account'], 0) + int(x['amount'])
    return out, bool(i and i['blocks'] > HIST)

def funder_label(f, t):
    if f in MINE: return 'pursekeeper'
    if paid_before(f, t): return 'paid-by-pursekeeper'
    if f in EXCH: return 'exchange:' + EXCH[f]
    if info(f) and info(f)['blocks'] >= 10000: return 'high-traffic'
    return 'other'

def classify(row):
    p = row['counterparty']; a = int(row['amount_raw']); t = tsiso(row['ts'])
    try: src = (json.loads(row.get('meta_json') or '{}').get('source_hash') or '').upper()
    except Exception: src = ''
    out = {'id': row['id'], 'ts': row['ts'], 'amount': fmt(xno(a)), 'payer': p, 'send_hash': src, 'via': None, 'attributed': p}
    if p in MINE: out.update(cls='own', why="payer is one of pursekeeper's own accounts"); return out
    if src in DONATIONS: out.update(cls='donation', why='send hash on the donation list'); return out
    f = passthrough(p)
    if f: out['via'] = p; out['attributed'] = f
    q = out['attributed']
    if q in MINE: out.update(cls='own', why="pass-through wallet funded by pursekeeper's own account"); return out
    pb = paid_before(q, t)
    if pb: out.update(cls='seeded-direct', why=f"attributed payer was paid by pursekeeper {len(pb)}x before this receipt (ledger #{pb[0]['id']} first)"); return out
    funders, deep = funders_before(q, t)
    lab = [(fa, amt, funder_label(fa, t)) for fa, amt in funders.items()]
    out['funders'] = [{'account': ('[pursekeeper funding account, withheld]' if fa in PRIVATE else fa), 'amount': fmt(xno(amt)), 'label': l} for fa, amt, l in lab]
    out['deep'] = deep
    seeded = sum(amt for fa, amt, l in lab if l in ('pursekeeper', 'paid-by-pursekeeper')); total = sum(funders.values())
    if seeded >= a and seeded > 0: out.update(cls='seeded-indirect', why=f"Ӿ{fmt(xno(seeded))} of the attributed payer's pre-receipt inbound came from pursekeeper or accounts it had paid; covers this Ӿ{fmt(xno(a))}"); return out
    if seeded > 0: out.update(cls='mixed', why=f"Ӿ{fmt(xno(seeded))} of Ӿ{fmt(xno(total))} pre-receipt inbound traces to pursekeeper within two hops; less than this receipt"); return out
    exch = sum(amt for fa, amt, l in lab if l.startswith('exchange:'))
    sub = 'none' if not funders else 'exchange' if exch * 2 >= total else 'other'
    out.update(cls='unseeded', sub=sub, why={'none': 'no receive before this send in the history read' + (' (deep account)' if deep else ''),
        'exchange': f"{exch * 100 // total if total else 0}% of pre-receipt inbound from listed exchange accounts",
        'other': 'pre-receipt inbound from accounts not paid by pursekeeper and not listed exchanges'}[sub])
    return out

def main():
    max_id = int(arg('--max-id', 10**9)); outdir = arg('--out', HERE)
    rows = sorted([r for r in LEDGER if r['kind'] == 'payment_in' and r['id'] <= max_id and str(r['counterparty']).startswith('nano_')], key=lambda r: r['id'])
    res = [classify(r) for r in rows]
    key = lambda r: r['cls'] + ('/' + r['sub'] if r.get('sub') else '')
    by = collections.defaultdict(lambda: {'receipts': 0, 'raw': 0, 'cp': set()})
    for r, row in zip(res, rows):
        b = by[key(r)]; b['receipts'] += 1; b['raw'] += int(row['amount_raw']); b['cp'].add(r['attributed'])
    tot = {k: {'receipts': v['receipts'], 'nano': fmt(xno(v['raw'])), 'counterparties': len(v['cp'])} for k, v in sorted(by.items())}
    def agg(pairs):
        cps = collections.defaultdict(int)
        for r, row in pairs: cps[r['attributed']] += int(row['amount_raw'])
        return {'nano': fmt(xno(sum(cps.values()))), 'receipts': len(pairs), 'counterparties': len(cps), 'counterparties_at_least_0_01': sum(1 for v in cps.values() if v >= RAW // 100)}
    pairs = list(zip(res, rows))
    un = [(r, row) for r, row in pairs if r['cls'] == 'unseeded']
    doc = {'generated_at': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), 'rpc_is_local_node': RPC.startswith('http://127.'),
           'ledger_max_id': rows[-1]['id'] if rows else None, 'receipts': len(rows), 'hist_blocks_read': HIST, 'pass_through_max_blocks': PASS_BLOCKS,
           'totals_by_class': tot,
           'not_own_not_seeded_direct': agg([(r, row) for r, row in pairs if r['cls'] not in ('own', 'seeded-direct')]),
           'unseeded': agg(un),
           'unseeded_via_pass_through': agg([(r, row) for r, row in un if r['via']]),
           'unseeded_direct': agg([(r, row) for r, row in un if not r['via']]),
           'rows': res}
    os.makedirs(outdir, exist_ok=True)
    stem = os.path.join(outdir, 'cohort-' + doc['generated_at'][:10])
    json.dump(doc, open(stem + '.json', 'w'), indent=1, ensure_ascii=False)
    md = [f"# Two-hop cohort: every receipt through ledger #{doc['ledger_max_id']} ({len(rows)} receipts), generated {doc['generated_at']}", '',
          '| class | receipts | Ӿ | distinct attributed payers |', '|---|---:|---:|---:|'] + [f"| {k} | {v['receipts']} | {v['nano']} | {v['counterparties']} |" for k, v in tot.items()]
    for name in ('not_own_not_seeded_direct', 'unseeded', 'unseeded_via_pass_through', 'unseeded_direct'):
        v = doc[name]; md.append(f"- {name}: Ӿ{v['nano']} in {v['receipts']} receipts from {v['counterparties']} attributed payers ({v['counterparties_at_least_0_01']} at or above Ӿ0.01)")
    md += ['', '| # | time | Ӿ | payer | via | attributed | class | why |', '|---|---|---:|---|---|---|---|---|']
    md += [f"| {r['id']} | {r['ts'][:16]}Z | {r['amount']} | {short(r['payer'])} | {short(r['via'])} | {short(r['attributed'])} | {key(r)} | {r['why']} |" for r in res]
    open(stem + '.md', 'w').write('\n'.join(md) + '\n')
    print('\n'.join(md[:len(tot) + 9])); print('written', stem + '.json', stem + '.md')

if __name__ == '__main__': main()
