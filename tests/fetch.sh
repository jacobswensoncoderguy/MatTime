#!/bin/sh
# Downloads the recorded meets from the store (read-only) into tests/fx for the replay checks.
cd "$(dirname "$0")" && mkdir -p fx shots
K=sb_publishable_WFqCxeR9AjQ2ecjqryETLQ_1Xx2aDV8; U=https://neasjlyymaufxxpprduv.supabase.co/rest/v1/docs
for c in config meets meets/2026-11-12/bouts meets/2026-11-12/flo meets/2026-11-12/guesslog meets/2026-11-18/bouts meets/2026-11-18/flo meets/2026-11-18/guesslog; do
  curl -s "$U?select=id,data&coll=eq.$(printf %s "$c" | sed 's#/#%2F#g')&limit=5000" -H "apikey: $K" -H "Authorization: Bearer $K" -o "fx/$(echo $c | tr / _).json"
done; ls -la fx
