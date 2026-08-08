import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { extractTemplesFromVideo } from "@/lib/extraction";
import { resolveTempleEntity } from "@/lib/entity-resolution";
import { listNewUploads, fetchThumbnails } from "@/lib/youtube";
import { geocodeTemple } from "@/lib/geocoding";
import type { AdditionalSource, Category, Temple } from "@/lib/types";

// Vercel Cron target — see spec Section 3 (data flow) and Section 5
// (ingestion pipeline detail). Runs daily. Full pipeline, all steps now
// implemented:
//   1. List new uploads (src/lib/youtube.ts) via playlistItems.list on the
//      channel's uploads playlist, stopping at the last-seen video_id
//      (read from the most recent sync_log row).
//   2. Claude extraction (src/lib/extraction.ts) — returns an array of
//      temples per video (spec 5a).
//   3. Entity resolution (src/lib/entity-resolution.ts, spec 5b) — fuzzy
//      match against existing rows; attach as additional_sources on a
//      match, otherwise proceed to insert as new.
//   4. Nominatim geocoding (src/lib/geocoding.ts, spec Section 3/5) — sets
//      lat/lng and needs_review based on actual geocode confidence.
//   5. Insert as status = 'pending'.
//   6. Write one sync_log row summarizing the run.
export async function GET() {
  const supabase = getServiceSupabase();

  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (!channelId || !youtubeApiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing YOUTUBE_CHANNEL_ID or YOUTUBE_API_KEY env vars." },
      { status: 500 }
    );
  }

  // Resume from the last video we successfully processed, per spec
  // Section 5 ("paginated, stopping once a previously-seen video_id is
  // hit"). sync_log doesn't currently store this directly, so we take it
  // from the most recently created temple's video_id as a reasonable
  // proxy — good enough for a ~1-video/week cadence where each run
  // typically sees 0-1 new uploads. Revisit if that assumption stops
  // holding (e.g. a backfill run processing many videos at once).
  const { data: mostRecentTemple } = await supabase
    .from("temples")
    .select("video_id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastSeenVideoId = mostRecentTemple?.video_id ?? null;

  const newVideos = await listNewUploads(channelId, youtubeApiKey, lastSeenVideoId);

  const [{ data: categoryRows }, { data: templeRows }] = await Promise.all([
    supabase.from("categories").select("*"),
    // Entity resolution runs against every existing temple regardless of
    // status — a video shouldn't re-create a temple that's already sitting
    // in the pending queue, not just already-published ones.
    supabase.from("temples").select("*"),
  ]);
  const existingCategories = (categoryRows ?? []) as Category[];
  const existingTemples = (templeRows ?? []) as Temple[];

  let videosWithMultipleTemples = 0;
  let templesAddedPending = 0;
  let templesAttachedToExisting = 0;
  let videosSkippedNonTemple = 0;
  const errors: string[] = [];

  for (const video of newVideos) {
    let result;
    try {
      result = await extractTemplesFromVideo(video, existingCategories);
    } catch (e) {
      errors.push(`Extraction failed for video ${video.videoId}: ${(e as Error).message}`);
      continue;
    }

    if (result.temples.length === 0) {
      videosSkippedNonTemple++;
      continue;
    }
    if (result.temples.length > 1) {
      videosWithMultipleTemples++;
    }

    // Fetch the thumbnail once per video, not per temple, since a
    // multi-temple video shares one thumbnail across all its entries.
    let thumbnailUrl: string | null = null;
    try {
      const thumbs = await fetchThumbnails([video.videoId], youtubeApiKey);
      thumbnailUrl = thumbs.get(video.videoId) ?? null;
    } catch (e) {
      errors.push(`Thumbnail fetch failed for video ${video.videoId}: ${(e as Error).message}`);
    }

    for (const extracted of result.temples) {
      const { match } = resolveTempleEntity(extracted, existingTemples);
      const source: AdditionalSource = {
        video_id: video.videoId,
        video_url: `https://www.youtube.com/watch?v=${video.videoId}`,
        video_title: video.title,
      };

      if (match) {
        const { error } = await supabase
          .from("temples")
          .update({
            additional_sources: [...match.temple.additional_sources, source],
          })
          .eq("id", match.temple.id);

        if (error) {
          errors.push(
            `Failed to attach video ${video.videoId} to existing temple ${match.temple.id}: ${error.message}`
          );
          continue;
        }
        templesAttachedToExisting++;
        continue;
      }

      // New temple: geocode before insert (step 4), per spec data flow.
      let lat: number | null = null;
      let lng: number | null = null;
      let needsReview = true;
      let geocodeNote = "Geocoding did not return a result — needs manual coordinates.";

      try {
        const geo = await geocodeTemple({
          templeName: extracted.templeName,
          state: extracted.state,
          district: extracted.district,
          locationHints: extracted.locationHints,
        });
        if (geo) {
          lat = geo.lat;
          lng = geo.lng;
          needsReview = geo.needsReview;
          geocodeNote = geo.reason;
        }
      } catch (e) {
        errors.push(`Geocoding failed for "${extracted.templeName}": ${(e as Error).message}`);
      }

      const { data: inserted, error } = await supabase
        .from("temples")
        .insert({
          name: extracted.templeName,
          deity: extracted.deity,
          state: extracted.state,
          district: extracted.district,
          lat,
          lng,
          categories: extracted.categories.map((c) => c.name),
          video_url: source.video_url,
          video_title: video.title,
          video_id: video.videoId,
          description: extracted.description,
          thumbnail_url: thumbnailUrl,
          thumbnail_cached_at: thumbnailUrl ? new Date().toISOString() : null,
          status: "pending",
          needs_review: needsReview,
          source: "auto",
        })
        .select("id")
        .single();

      if (error) {
        errors.push(`Failed to insert new temple for video ${video.videoId}: ${error.message}`);
        continue;
      }

      if (needsReview) {
        errors.push(`needs_review set for "${extracted.templeName}": ${geocodeNote}`);
      }

      // Keep the in-memory candidate pool current within this run, so a
      // later video in the same batch can still match against a temple
      // this run just created.
      existingTemples.push({
        id: inserted!.id,
        name: extracted.templeName,
        deity: extracted.deity,
        state: extracted.state,
        district: extracted.district,
        description: extracted.description,
        lat,
        lng,
        video_url: source.video_url,
        video_title: video.title,
        video_id: video.videoId,
        additional_sources: [],
        thumbnail_url: thumbnailUrl,
        thumbnail_cached_at: thumbnailUrl ? new Date().toISOString() : null,
        instagram_urls: [],
        status: "pending",
        needs_review: needsReview,
        source: "auto",
        last_verified_at: null,
        created_at: "",
        updated_at: "",
        categories: extracted.categories.map((c) => c.name),
      } as Temple);

      templesAddedPending++;
    }
  }

  const { error: logError } = await supabase.from("sync_log").insert({
    videos_checked: newVideos.length,
    temples_added_pending: templesAddedPending,
    videos_skipped_non_temple: videosSkippedNonTemple,
    videos_with_multiple_temples: videosWithMultipleTemples,
    errors,
  });

  if (logError) {
    return NextResponse.json({ ok: false, error: logError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    videosChecked: newVideos.length,
    templesAddedPending,
    templesAttachedToExisting,
    errors,
  });
}
