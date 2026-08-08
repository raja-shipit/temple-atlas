# Temple Atlas

Map-based catalog of Hindu temples covered by @thetemplegirl on YouTube. Full product/technical spec lives in the living-doc artifact (`temple-atlas-spec`) — this README covers just what's needed to run and continue this codebase.

## What's scaffolded

- **Next.js app** (App Router, TypeScript, Tailwind) — `src/app`
- **Supabase schema** — `supabase/migrations/0001_init.sql`, matching spec v3 exactly: `temples`, `categories`, `sync_log`, plus `rename_category_cascade` / `merge_category_cascade` functions so a category rename never drifts out of sync with the denormalized `temples.categories` array (spec 4b)
- **Public map page** (`src/app/page.tsx` + `src/app/components/TempleMap.tsx`) — MapLibre GL JS + OpenFreeMap hosted vector tiles (resolved decision, spec 3/3a), pulling published temples from Supabase
- **Admin queue** (`src/app/admin/page.tsx`) — lists pending temples, flags `needs_review` rows, protected by basic auth (`src/middleware.ts`, resolved decision)
- **Cron route stubs**:
  - `src/app/api/cron/sync/route.ts` — the daily ingestion pipeline (YouTube → Claude extraction → entity resolution → Nominatim → insert as pending). Currently writes an empty `sync_log` row and throws a clear "not implemented" message — the actual pipeline logic still needs to be written.
  - `src/app/api/cron/refresh-thumbnails/route.ts` — the YouTube 30-day thumbnail refresh job (spec 5c). Currently just counts stale rows.
  - Both are wired into `vercel.json` on a daily schedule.
- **PWA basics** — `public/manifest.json`, a minimal `public/sw.js` that caches the app shell for offline/low-connectivity use (spec Section 7), registered in `src/app/layout.tsx`. Icons are solid-color placeholders — swap `public/icons/*.png` before launch.

## What's NOT built yet

This is a scaffold, not a working product. Still to do, roughly in dependency order:

1. **Extraction prompt** — the Claude prompt that turns a video's title/description into `ExtractedTemple[]` (see `src/lib/types.ts`), including the category fuzzy-match-or-propose step (spec Section 4).
2. **Entity resolution** (spec 5b) — the fuzzy-match logic that decides whether a newly extracted temple is actually a new row or an additional source on an existing one.
3. **Nominatim geocoding client** — respecting their usage policy (1 req/sec, identifying `User-Agent` from `NOMINATIM_USER_AGENT`), with the district/place cross-check described in spec Section 5.
4. **Fill in `/api/cron/sync`** using the three pieces above.
5. **Fill in `/api/cron/refresh-thumbnails`** with an actual YouTube `videos.list` call.
6. **Admin UI**: edit form, map preview, approve/reject (approve sets `last_verified_at = now()`, spec Section 6), manual "add temple" form (this is also where `instagram_urls` gets populated, spec 4a), category merge/rename/retire controls that call the SQL cascade functions.
7. **Public frontend**: search, category filter, state filter, card list synced to map viewport, trip planner (straight-line connector between stops — explicitly not driving directions, spec Section 7).

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase/YouTube/Anthropic/admin credentials
```

Run the migration against a Supabase project (SQL editor, or the Supabase CLI):

```bash
supabase db push   # or paste supabase/migrations/0001_init.sql into the SQL editor
```

```bash
npm run dev
```

`/` is the public map. `/admin` requires the basic-auth credentials from `.env.local`.

## Deploying

Push to Vercel, set the same env vars there, and the two cron jobs in `vercel.json` will start running on schedule automatically.
