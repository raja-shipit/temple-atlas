# Temple Atlas

Map-based catalog of Hindu temples covered by @thetemplegirl on YouTube. Full product/technical spec lives in the living-doc artifact (`temple-atlas-spec`) — this README covers just what's needed to run and continue this codebase.

## What's built

**Ingestion pipeline** (spec Section 5) — every step now implemented in `/api/cron/sync`:

1. **YouTube upload listing** (`src/lib/youtube.ts`) — `playlistItems.list` against the channel's uploads playlist, paginated, stopping at the last-seen `video_id`.
2. **Claude extraction** (`src/lib/extraction-prompt.ts` + `src/lib/extraction.ts`) — forced tool-use call that returns an array of temples per video (spec 5a), so non-temple videos correctly yield an empty array and compilation videos correctly yield several entries. Categories are only assigned when the video's own title/description/playlist explicitly supports them — the prompt is told not to infer circuit membership (e.g. "this is popularly a Jyotirlinga" when the video never says so).
   Try it without touching anything else: `npm run test:extraction -- scripts/fixtures/sample-video.json`. Three fixtures are included (single-temple, non-temple vlog, multi-temple compilation). Set `ANTHROPIC_API_KEY` to also run it live.
3. **Entity resolution** (`src/lib/entity-resolution.ts`, spec 5b) — decides whether a newly extracted temple is the same physical temple as an existing row (append to `additional_sources`) or genuinely new. Conservative by design: a generic shared name ("Durga Mandir") across different states never auto-attaches even at perfect text similarity, since normalizing away generic words can make unrelated places look identical.
   Try it: `npm run test:entity-resolution` — four scenarios (exact repeat, phrasing variant, same-name-different-state, unrelated temple) with the reasoning printed for each.
4. **Nominatim geocoding** (`src/lib/geocoding.ts`, resolved decision) — public API, 1 req/sec throttle enforced in-process, identifying `User-Agent` from `NOMINATIM_USER_AGENT`. Cross-checks the result against the extracted `state` and `locationHints`; sets `needs_review: true` rather than silently trusting an ambiguous or state-mismatched result.
5. **Insert as pending**, with the real geocoded coordinates and `needs_review` flag — done.
6. **`sync_log`** row per run — done.

**Thumbnail refresh** (`/api/cron/refresh-thumbnails`, spec 5c) — finds temples whose cached thumbnail is more than 30 calendar days old (YouTube's Developer Policy limit) and either refreshes it via `videos.list` or nulls it out if the video's gone.

**Admin** (`src/app/admin/`, spec Section 6) — pending queue with a map preview and inline edit form per entry, approve (sets `last_verified_at`)/reject actions, a re-verify action on already-published entries, a manual "add temple" form (also where `instagram_urls` gets populated — spec 4a, never touched by the pipeline), and category rename/merge/retire controls. The rename/merge actions call the `rename_category_cascade` / `merge_category_cascade` SQL functions from the migration, not a direct update, so the denormalized `temples.categories` array can never drift out of sync (spec 4b). All server actions live in `src/app/admin/actions.ts`; the route itself is behind basic auth via `src/middleware.ts`.

**Public frontend** (`src/app/components/TempleExplorer.tsx` + `TempleMap.tsx`, spec Section 7) — MapLibre GL JS + OpenFreeMap tiles (resolved decision, spec 3a), search, multi-select category filter, state filter, a card list that stays in sync with the same filters and the map, and a trip planner: add/remove/reorder stops, with a straight-line connector drawn on the map — explicitly labeled as a straight line, not driving directions.

**Database** — `supabase/migrations/0001_init.sql` matches spec v3 exactly: `temples`, `categories`, `sync_log`, and the two cascade functions mentioned above.

**PWA basics** — `public/manifest.json`, a minimal `public/sw.js` caching the app shell for offline/low-connectivity use (spec Section 7 — a meaningful share of this audience will be at rural temple sites with poor signal), registered in `src/app/layout.tsx`. Icons are solid-color placeholders — swap `public/icons/*.png` before launch.

## What's not built / not verified yet

- **Nothing has been run against real credentials.** This sandbox has no network access to the YouTube Data API, the Anthropic API, or Nominatim, so none of steps 1–4 above have been exercised end-to-end against live data — only `tsc --noEmit`, `next build`, and `eslint` have been verified clean, plus the two dry-run scripts (extraction, entity resolution) that don't require external network access. Run a real cron invocation against a test Supabase project before trusting this in production.
- **Playlist membership** isn't fetched during YouTube listing (`src/lib/youtube.ts` — `playlistTitles` is always `[]`). The extraction prompt still works off title/description alone; wire in a `playlists.list` walk later if category proposals prove too weak without it.
- **`lastSeenVideoId` tracking** is inferred from the most recently created temple row rather than stored explicitly in `sync_log` — fine at ~1 video/week, but worth hardening (e.g. a dedicated `last_synced_video_id` column) before running a large backfill.
- **Category marker colors on the map** — `categories.color` exists in the schema but nothing sets or reads it yet; every marker is currently one fixed color.
- **"Last verified" data won't exist until the admin approve flow is actually used** against a real database — the field and UI are wired, there's just nothing to show without real approvals.

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
