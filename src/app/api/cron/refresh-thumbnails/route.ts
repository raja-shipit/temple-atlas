import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { fetchThumbnails } from "@/lib/youtube";

// Implements spec 5c: YouTube API Developer Policies require cached
// metadata (thumbnail_url) to be refreshed or deleted within 30 calendar
// days of being fetched. Finds rows past that window and either re-fetches
// the thumbnail or nulls it out if the video is gone.
//
// Piggybacks on the same daily Vercel Cron schedule as /api/cron/sync.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function GET() {
  const supabase = getServiceSupabase();
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (!youtubeApiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing YOUTUBE_API_KEY env var." },
      { status: 500 }
    );
  }

  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();

  const { data: staleRows, error } = await supabase
    .from("temples")
    .select("id, video_id")
    .lt("thumbnail_cached_at", cutoff)
    .not("video_id", "is", null);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = staleRows ?? [];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, refreshed: 0, removed: 0 });
  }

  const videoIds = [...new Set(rows.map((r) => r.video_id as string))];
  const thumbnails = await fetchThumbnails(videoIds, youtubeApiKey);

  let refreshed = 0;
  let removed = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    const thumb = thumbnails.get(row.video_id as string);
    const { error: updateError } = await supabase
      .from("temples")
      .update({
        thumbnail_url: thumb ?? null,
        thumbnail_cached_at: thumb ? now : null,
      })
      .eq("id", row.id);

    if (updateError) {
      errors.push(`Failed to update temple ${row.id}: ${updateError.message}`);
      continue;
    }
    if (thumb) refreshed++;
    else removed++;
  }

  return NextResponse.json({ ok: true, refreshed, removed, errors });
}
