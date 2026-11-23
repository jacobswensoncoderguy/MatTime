# Checks (run before every push)

All of these read the live store with GET only; every other request is blocked inside the test browser. Nothing here writes to the store.

    sh tests/fetch.sh          # recorded meets (Nov 12, Nov 18) -> tests/fx
    node tests/replay.js       # steps both meets through the evening: no guess in the past, Up-in agrees with its note,
                               # forfeits excluded, hand-entered times unchanged, nothing lost on reload or offline
    node tests/final.js        # live store load, stale-score check, alert paths, GO NOW gating, history numbers
    node tests/layout.js x     # 320/375/390/430 px audit + screenshots in tests/shots
    python3 tests/pgsim.py     # server.sql on a throwaway local Postgres with a fake Flo feed (needs a local server on /tmp/mtpg:5544)

Nov 5 is not in the store, so it cannot be replayed.
