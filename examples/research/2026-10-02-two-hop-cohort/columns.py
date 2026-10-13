#!/usr/bin/env python3
"""The two columns pre-registered for cohort run #3 (README, 2026-10-13 02:33Z and 06:52Z), added to
every unseeded checkout receipt of a run. Neither changes a class; the two-hop class stays primary.

    python3 columns.py cohort-YYYY-MM-DD.json [--out columns-YYYY-MM-DD.json]

venue-declared kind: human | agent | unlabelled. The label the venue (Subnano) attached to the paying
  account: tipper.authorKind on the tip-activities endpoint for post tips, author_kind on the comments
  endpoint for comment tips (a comment with tip_status "paid"; these do not appear on tip-activities),
  and author_kind of a public comment in which a buyer says it bought the post (hand entries in
  declared.json, each citing the comment id). Sale notices name the buyer as "Someone", so a sale with
  no such comment is unlabelled. Rows before 2026-10-13 are back-filled from the same endpoints and
  marked. receipt-posts.json ties each receipt to its venue event (amount after fee, nearest time).
rails offered: nano | nano,usdc | unknown. The post's acceptedRails as read in the wake the receipt
  landed (rails/<stamp>.json, written by a snapshot of the venue's /.well-known/x402/posts feed and
  /api/posts/<id>); the snapshot used is the first one taken at or after the receipt's booking time
  within 24 h. Receipts before the first snapshot (2026-10-13 11:02 UTC) are unknown, never back-filled.
  A Nano receipt counts as a choice between rails only when its own snapshot lists two.
"""
import json, sys, glob, os, collections, datetime as dt
def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default
here = os.path.dirname(os.path.abspath(__file__))
src = sys.argv[1]; doc = json.load(open(src))
rp = json.load(open(os.path.join(here, 'receipt-posts.json')))['receipts']
declared = json.load(open(os.path.join(here, 'declared.json')))['receipts']
snaps = []
for f in sorted(glob.glob(os.path.join(here, 'rails', '*.json'))):
    s = json.load(open(f)); snaps.append((dt.datetime.fromisoformat(s['generated_at'].replace('Z', '+00:00')), os.path.basename(f), s['posts']))
FIRST_SNAP = min(s[0] for s in snaps) if snaps else None
BACKFILL_BEFORE = dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc)
def ts(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
def week(t):
    y, w, _ = t.isocalendar(); return f'{y}-W{w:02d}'
KINDS = ['human', 'agent', 'unlabelled']; RAILS = ['nano', 'nano,usdc', 'unknown']
rows, bins = [], collections.OrderedDict()
def cell(): return {'receipts': 0, 'nano': 0.0}
for r in doc['rows']:
    if r['cls'] != 'unseeded' or not r.get('via'): continue
    t = ts(r['ts']); rid = str(r['id']); ev = rp.get(rid, {})
    if rid in declared:
        kind, source, by = declared[rid]['declared_kind'], declared[rid]['source'], declared[rid].get('declared_by')
    else:
        kind, source, by = ev.get('declared_kind', 'unlabelled'), ev.get('source'), ev.get('declared_by')
    if kind not in KINDS: kind = 'unlabelled'
    post = ev.get('post')
    rails, snap = 'unknown', None
    for when, name, posts in snaps:
        if when >= t and (when - t) <= dt.timedelta(hours=24) and post in posts:
            rails, snap = posts[post]['rails_offered'], name; break
    if rails not in RAILS: rails = 'unknown'
    row = {'id': r['id'], 'ts': r['ts'], 'amount': r['amount'], 'post': post, 'event': ev.get('event'), 'declared_kind': kind, 'declared_source': source, 'declared_by': by, 'back_filled': t < BACKFILL_BEFORE and kind != 'unlabelled', 'rails_offered': rails, 'rails_snapshot': snap}
    rows.append(row)
    b = bins.setdefault(week(t), {'kind': {k: cell() for k in KINDS}, 'rails': {k: cell() for k in RAILS}, 'all': cell()})
    for c in (b['kind'][kind], b['rails'][rails], b['all']): c['receipts'] += 1; c['nano'] += float(r['amount'])
def pub(c): return {'receipts': c['receipts'], 'nano': round(c['nano'], 6)}
out = {'source': os.path.basename(src), 'generated_at': doc['generated_at'], 'ledger_max_id': doc['ledger_max_id'], 'first_rails_snapshot': FIRST_SNAP.strftime('%Y-%m-%dT%H:%M:%SZ') if FIRST_SNAP else None,
       'bins': {k: {'all': pub(v['all']), 'kind': {x: pub(v['kind'][x]) for x in KINDS}, 'rails': {x: pub(v['rails'][x]) for x in RAILS}} for k, v in sorted(bins.items())}, 'rows': rows}
dest = arg('--out', os.path.join(here, 'columns-' + doc['generated_at'][:10] + '.json'))
json.dump(out, open(dest, 'w'), indent=1)
f = lambda c: f"{c['receipts']} ({c['nano']:g})"
print('| bin | unseeded checkout receipts (Ӿ) | human | agent | unlabelled | rails nano | rails nano,usdc | rails unknown |'); print('|' + '---|' * 8)
for k, v in out['bins'].items():
    print(f"| {k} | {f(v['all'])} | " + ' | '.join(f(v['kind'][x]) for x in KINDS) + ' | ' + ' | '.join(f(v['rails'][x]) for x in RAILS) + ' |')
bf = sum(1 for r in rows if r['back_filled']); print(f"labelled rows: {sum(1 for r in rows if r['declared_kind'] != 'unlabelled')} of {len(rows)}, {bf} back-filled (before 2026-10-13); unmatched events: {sum(1 for r in rows if not r['event'] or r['event'] == 'unmatched')}")
print('written', dest)
