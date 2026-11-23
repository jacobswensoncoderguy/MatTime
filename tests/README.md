# Checks (run before every push)

All of these read the live store with GET only; every other request is blocked inside the test browser. Nothing here writes to the store.

    sh tests/fetch.sh          # recorded meets (Nov 12, Nov 18) -> tests/fx
    node tests/replay.js       # steps both meets through the evening: no guess in the past, Up-in agrees with its note,
                               # forfeits excluded, hand-entered times unchanged, nothing lost on reload or offline
    node tests/final.js        # live store load, stale-score check, alert paths, GO NOW gating, history numbers
    node tests/layout.js x     # 320/375/390/430 px audit + screenshots in tests/shots
    python3 tests/pgsim.py     # server.sql on a throwaway local Postgres with a fake Flo feed (needs a local server on /tmp/mtpg:5544)

Nov 5 is not in the store, so it cannot be replayed.

## Tried and not shipped (Nov 23, second run)
Automatic no-sheet estimate (build the estimate block from the previous meet's sheet when a meet has no roster): replayed on Nov 18 with the roster removed. Before GO NOW it showed "earliest 6:09–6:53 PM" for a bout that started 5:56 PM, and GO NOW (5:40 PM) fired only because an unrelated 110 lb result happened to post at 5:39. Flo's JV results arrive out of weight order and incomplete (34 results for 50 JV rows on Nov 18, 28 for 72 on Nov 12), so "which weight is JV at" is noise. The hand-written estimate block has the same weakness. Do not rebuild this on the weight frontier; a no-sheet meet needs the sheet.
