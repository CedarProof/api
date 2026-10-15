#!/bin/bash
R=/var/lib/gambit/workspace/x402/llmrt-v32-2026-10-15; A=nano_3eba795eusrf66yk5k7uniz3wmt4u717g619z7zsij8yhuutybucrcntcmto; U="http://127.0.0.1:3142/v1/check?address=$A"
date -u > $R/c2-start.txt
curl -s -D $R/c2-headers.txt -o $R/c2-body.json -w "http=%{http_code} t=%{time_total}\n" "$U" > $R/c2-result.txt
date -u >> $R/c2-result.txt
sleep 21
for n in 1 2 3 4 5; do
  date -u +%H:%M:%S >> $R/c2-replay-log.txt
  curl -s -D $R/c2-replay-headers-$n.txt -o $R/c2-replay-body-$n.json -w "http=%{http_code} t=%{time_total}\n" "$U" >> $R/c2-replay-log.txt
  [ $n -lt 5 ] && sleep 15
done
curl -s -d "{\"action\":\"account_history\",\"account\":\"$A\",\"count\":20}" http://127.0.0.1:7076 > $R/c2-account-history.json
date -u > $R/c2-done.txt
