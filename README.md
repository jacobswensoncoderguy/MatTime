# MatTime

Wrestling meet timing: predicts when a tracked wrestler is up, from bouts logged per mat.

- `index.html` is the whole app (single file). Served by GitHub Pages from `main`.
- Shared data lives in Supabase, one table (`public.docs`). Run `schema.sql` once in the Supabase SQL Editor.
- Put the Supabase **publishable (anon)** key in `window.MT_CONFIG.key` near the top of `index.html`. Never commit a secret key.
