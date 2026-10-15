# Sweep the throwaway (seed index 14) back to the hot wallet with llmrt's own primitives, as on 2026-10-13.
import sys, time, json
sys.path.insert(0, 'tool'); import nano_send as ns
hot = sys.argv[1]
acct = ns.src_addr(); info = ns.pk_account_info(acct)
prev = info['frontier']; bal = int(info['balance_raw']); rep = info.get('representative') or ns.DEFAULT_REP
print('account', acct); print('frontier', prev, 'balance_raw', bal, 'xno', bal/1e30, 'rep', rep[:20])
work = ns.pk_work(prev); print('work', work)
block, h = ns._block_build(prev, 0, ns._pub32_hex(hot), rep, 'send', work)
r = ns.pk_process(block, 'send'); print('process', r)
print('SWEEP send to hot', bal/1e30, 'hash', h, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
