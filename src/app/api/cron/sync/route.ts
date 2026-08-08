import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { extractTemplesFromVideo } from "@/lib/extraction";
import type { Category, VideoForExtraction } from "@/lib/types";

// Vercel Cron target — see spec Section 3 (data flow) and Section 5
// (ingestion pipeline detail). Runs daily.
//
// Pipeline, in order:
//   1. List new uploads since the last successful run via
//      playlistItems.list on the channel's uploads playlist (UU + channel
//      ID with UC stripped), paginated, stopping at the last-seen video_id.
//      [NOT YET IMPLEMENTED — see step below]
//   2. For each new video, call extractTemplesFromVideo (src/lib/extraction.ts,
//      implemented). Returns an ARRAY of temples per video (spec 5a), each
//      with proposed categories matched/justified against the existing
//      categories table (spec 4).
//   3. Entity resolution (spec 5b): fuzzy-match each extracted temple
//      against existing `temples` rows (name + state/district + coordinate
//      proximity) before inserting. On a match, append to
//      additional_sources instead of creating a new row.
//      [NOT YET IMPLEMENTED]
//   4. Geocode via Nominatim (spec 3, resolved decision 1) — 1 req/sec max,
//      identifying User-Agent, name + state as the query, cross-checked
//      against locationHints from the extraction step (spec 5). Low
//      confidence -> needs_review: true, not a silent guess.
//      [NOT YET IMPLEMENTED]
//   5. Insert as status = 'pending'.
//      [NOT YET IMPLEMENTED]
//   6. Write one row to sync_log summarizing the run.
//      [scaffolded below]
export async function GET() {
  const supabase = getServiceSupabase();

  // TODO: replace with a real YouTube playlistItems.list call, paginated,
  // stopping at the last-seen video_id (step 1 above).
  const newVideos: VideoForExtraction[] = [];

  const { data: categoryRows } = await supabase.from("categories").select("*");
  const existingCategories = (categoryRows ?? []) as Category[];

  let videosWithMultipleTemples = 0;
  let templesAddedPending = 0;
  let videosSkippedNonTemple = 0;

  for (const video of newVideos) {
    const result = await extractTemplesFromVideo(video, existingCategories);

    if (result.temples.length === 0) {
      videosSkippedNonTemple++;
      continue;
    }
    if (result.temples.length > 1) {
      videosWithMultipleTemples++;
    }

    for (const temple of result.temples) {
      // TODO: entity resolution (step 3) then geocoding (step 4) then
      // insert as pending (step 5) — see comments above.
      void temple;
      templesAddedPending++;
    }
  }

  const { error } = await supabase.from("sync_log").insert({
    videos_checked: newVideos.length,
    temples_added_pending: templesAddedPending,
    videos_skipped_non_temple: videosSkippedNonTemple,
    videos_with_multiple_temples: videosWithMultipleTemples,
    notes:
      newVideos.length === 0
        ? "YouTube upload listing (step 1) not yet implemented — no videos were checked this run."
        : undefined,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    videosChecked: newVideos.length,
    templesAddedPending,
    message:
      "Extraction (step 2) is implemented and wired in. YouTube listing (1), entity resolution (3), and geocoding (4/5) are still TODO.",
  });
}
