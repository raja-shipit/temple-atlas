import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Vercel Cron target — see spec Section 3 (data flow) and Section 5
// (ingestion pipeline detail). Runs daily.
//
// Pipeline, in order (fill in as each piece is built):
//   1. List new uploads since the last successful run via
//      playlistItems.list on the channel's uploads playlist (UU + channel
//      ID with UC stripped), paginated, stopping at the last-seen video_id.
//   2. For each new video, call the Claude extraction step. It must return
//      an ARRAY of temples per video (spec 5a), each with isTemple: true
//      and proposed categories matched/justified against the existing
//      categories table (spec 4).
//   3. Entity resolution (spec 5b): fuzzy-match each extracted temple
//      against existing `temples` rows (name + state/district + coordinate
//      proximity) before inserting. On a match, append to
//      additional_sources instead of creating a new row.
//   4. Geocode via Nominatim (spec 3, resolved decision 1) — 1 req/sec max,
//      identifying User-Agent, name + state as the query, cross-checked
//      against any district/place mentioned in the video's own title or
//      description (spec 5). Low confidence -> needs_review: true, not a
//      silent guess.
//   5. Insert as status = 'pending'.
//   6. Write one row to sync_log summarizing the run (spec Section 4).
//
// This route intentionally throws until the pipeline is implemented, so it
// fails loudly in Vercel's cron logs rather than silently doing nothing.
export async function GET() {
  const supabase = getServiceSupabase();

  const { error } = await supabase.from("sync_log").insert({
    videos_checked: 0,
    temples_added_pending: 0,
    videos_skipped_non_temple: 0,
    videos_with_multiple_temples: 0,
    notes: "Pipeline not yet implemented — scaffold only.",
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message:
      "sync_log row written. Ingestion logic (YouTube -> Claude -> entity resolution -> Nominatim -> insert) is not yet implemented.",
  });
}
