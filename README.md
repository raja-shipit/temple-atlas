# Temple Atlas

Map-based catalog of Hindu temples covered by @thetemplegirl on YouTube. Full product/technical spec lives in the living-doc artifact (`temple-atlas-spec`) — this README covers just what's needed to run and continue this codebase.

## What's scaffolded

- **Next.js app** (App Router, TypeScript, Tailwind) — `src/app`
- **Supabase schema** — `supabase/migrations/0001_init.sql`, matching spec v3 exactly: `temples`, `categories`, `sync_log`, plus `rename_category_cascade` / `merge_category_cascade` functions so a category rename never drifts out of sync with the denormalized `temples.categories` array (spec 4b)
- **Public map page** (`src/app/page.tsx` + `src/app/components/TempleMap.tsx`) — MapLibre GL JS + OpenFreeMap hosted vector tiles (resolved decision, spec 3/3a), pulling published temples from Supabase
- **Admin queue** (`src/app/admin/page.tsx`) — lists pending temples, flags `needs_review` rows, protected by basic auth (`src/middleware.ts`, resolved decision)
- **Claude extraction step** (spec Section 4 & 5) — `src/lib/extraction-prompt.ts` builds the system/user prompts and the forced tool-use schema; `src/lib/extraction.ts` calls the Anthropic API and returns typed results. Enforces the two easy-to-get-wrong rules from the spec: categories are only assigned when the video's own title/description/playlist explicitly supports them (no inferring circuit membership), and the output is an array so multi-temple and non-temple videos are handled correctly (spec 5a).

  Try it without touching the database: `npm run test:extraction -- scripts/fixtures/sample-video.json` prints the exact prompts that would be sent. Three fixtures are included — a standard single-temple video, a non-temple vlog (should yield an empty `temples` array), and a multi-temple day-trip video (should yield three). Set `ANTHROPIC_API_KEY` in your shell to also run it live and see the actual parsed output.

- **Entity resolution** (spec 5b) — `src/lib/entity-resolution.ts`. Decides whether a newly extracted temple is the same physical temple as an existing row (attach as an additional source) or genuinely new. Deliberately conservative about the exact failure mode the spec calls out: two temples with a generic shared name ("Durga Mandir") in different states score low even at perfect textual similarity, because normalizing away words like "temple"/"mandir" can make unrelated places look identical — state mismatches are never overridden by name similarity alone. Try it with `npm run test:entity-resolution`, which runs four scenarios (exact repeat, phrasing variant, same-name-different-state, unrelated temple) and prints the match/no-match reasoning for each.

- **Cron route stubs**:
  - `src/app/api/cron/sync/route.ts` — the daily ingestion pipeline. Extraction (step 2) and entity resolution (step 3) are wired in and functional: a matched temple gets the new video appended to `additional_sources`; an unmatched one gets inserted as a new pending row. YouTube upload listing (step 1) and Nominatim geocoding (step 4) are still TODO — new rows are inserted with `needs_review: true` and no coordinates in the meantime, so nothing reaches the public map without a real location once geocoding exists to check it against.
  - `src/app/api/cron/refresh-thumbnails/route.ts` — the YouTube 30-day thumbnail refresh job (spec 5c). Currently just counts stale rows.
  - Both are wired into `vercel.json` on a daily schedule.
- **PWA basics** — `public/manifest.json`, a minimal `public/sw.js` that caches the app shell for offline/low-connectivity use (spec Section 7), registered in `src/app/layout.tsx`. Icons are solid-color placeholders — swap `public/icons/*.png` before launch.

## What's NOT built yet

This is a scaffold, not a working product. Still to do, roughly in dependency order:

1. **YouTube upload listing** — `playlistItems.list` against the channel's uploads playlist, paginated, stopping at the last-seen `video_id`. Feeds the extraction step below; this is the one remaining piece of the ingestion pipeline's input side.
2. ~~Extraction prompt~~ — done, see `src/lib/extraction.ts` / `src/lib/extraction-prompt.ts`.
3. ~~Entity resolution~~ — done, see `src/lib/entity-resolution.ts`.
4. **Nominatim geocoding client** — respecting their usage policy (1 req/sec, identifying `User-Agent` from `NOMINATIM_USER_AGENT`), cross-checked against each temple's `locationHints` from the extraction step (spec Section 5). Newly inserted temples currently have `needs_review: true` and null coordinates as a placeholder for this.
5. **Finish `/api/cron/sync`** — extraction and entity resolution are already wired in; plug in steps 1 and 4 around them, and set `needs_review` based on actual geocode confidence instead of unconditionally.
6. **Fill in `/api/cron/refresh-thumbnails`** with an actual YouTube `videos.list` call.
7. **Admin UI**: edit form, map preview, approve/reject (approve sets `last_verified_at = now()`, spec Section 6), manual "add temple" form (this is also where `instagram_urls` gets populated, spec 4a), category merge/rename/retire controls that call the SQL cascade functions.
8. **Public frontend**: search, category filter, state filter, card list synced to map viewport, trip planner (straight-line connector between stops — explicitly not driving directions, spec Section 7).

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
