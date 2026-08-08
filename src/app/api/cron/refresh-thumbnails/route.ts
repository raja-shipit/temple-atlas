import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

// Implements spec 5c: YouTube API Developer Policies require cached
// metadata (thumbnail_url) to be refreshed or deleted within 30 calendar
// days of being fetched. This route finds rows past that window and either
// re-fetches the thumbnail from the YouTube API or nulls it out (frontend
// falls back to a generic placeholder) if the video is gone.
//
// Piggybacks on the same daily Vercel Cron schedule as /api/cron/sync.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET() {
  const supabase = getServiceSupabase();
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const { data: staleRows, error } = await supabase
    .from("temples")
    .select("id, video_id, thumbnail_cached_at")
    .lt("thumbnail_cached_at", cutoff);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // TODO: for each stale row, re-fetch thumbnail_url via the YouTube Data
  // API (videos.list -> snippet.thumbnails) and update thumbnail_cached_at.
  // If the video is unavailable or the fetch fails, set thumbnail_url to
  // null instead of leaving stale data in place.

  return NextResponse.json({
    ok: true,
    staleCount: staleRows?.length ?? 0,
    message: "Refresh logic not yet implemented — scaffold only.",
  });
}
