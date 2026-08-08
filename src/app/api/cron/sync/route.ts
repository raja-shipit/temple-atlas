import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { extractTemplesFromVideo } from "@/lib/extraction";
import { resolveTempleEntity } from "@/lib/entity-resolution";
import type { AdditionalSource, Category, Temple, VideoForExtraction } from "@/lib/types";

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
//   3. Entity resolution (spec 5b, src/lib/entity-resolution.ts, implemented):
//      fuzzy-match each extracted temple against existing `temples` rows by
//      name/state/district. On a confident match, append to
//      additional_sources instead of creating a new row.
//   4. Geocode via Nominatim (spec 3, resolved decision 1) — 1 req/sec max,
//      identifying User-Agent, name + state as the query, cross-checked
//      against locationHints from the extraction step (spec 5). Low
//      confidence -> needs_review: true, not a silent guess.
//      [NOT YET IMPLEMENTED — new rows are inserted below with null lat/lng
//      and needs_review: true as a placeholder until this exists, so
//      nothing goes live without a coordinate]
//   5. Insert as status = 'pending'.
//      [done for new rows; attach-to-existing path also implemented]
//   6. Write one row to sync_log summarizing the run.
export async function GET() {
  const supabase = getServiceSupabase();

  // TODO: replace with a real YouTube playlistItems.list call, paginated,
  // stopping at the last-seen video_id (step 1 above).
  const newVideos: VideoForExtraction[] = [];

  const [{ data: categoryRows }, { data: templeRows }] = await Promise.all([
    supabase.from("categories").select("*"),
    supabase.from("temples").select("*"),
  ]);
  const existingCategories = (categoryRows ?? []) as Category[];
  // Entity resolution runs against every existing temple regardless of
  // status — a video shouldn't re-create a temple that's already sitting
  // in the pending queue either, not just already-published ones.
  const existingTemples = (templeRows ?? []) as Temple[];

  let videosWithMultipleTemples = 0;
  let templesAddedPending = 0;
  let templesAttachedToExisting = 0;
  let videosSkippedNonTemple = 0;
  const errors: string[] = [];

  for (const video of newVideos) {
    const result = await extractTemplesFromVideo(video, existingCategories);

    if (result.temples.length === 0) {
      videosSkippedNonTemple++;
      continue;
    }
    if (result.temples.length > 1) {
      videosWithMultipleTemples++;
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
      } else {
        // TODO: geocode (step 4) before insert once the Nominatim client
        // exists. Until then, insert with null coordinates and
        // needs_review: true so nothing surfaces on the public map
        // without a real location, and the admin queue makes the gap
        // visible instead of hiding it.
        const { data: inserted, error } = await supabase
          .from("temples")
          .insert({
            name: extracted.templeName,
            deity: extracted.deity,
            state: extracted.state,
            district: extracted.district,
            categories: extracted.categories.map((c) => c.name),
            video_url: source.video_url,
            video_title: video.title,
            video_id: video.videoId,
            description: extracted.description,
            status: "pending",
            needs_review: true,
            source: "auto",
          })
          .select("id")
          .single();

        if (error) {
          errors.push(`Failed to insert new temple for video ${video.videoId}: ${error.message}`);
          continue;
        }

        // Keep the in-memory candidate pool current within this run, so a
        // later video in the same batch can still match against a temple
        // this run just created (e.g. two videos from the same upload
        // batch covering the same place).
        existingTemples.push({
          id: inserted!.id,
          name: extracted.templeName,
          deity: extracted.deity,
          state: extracted.state,
          district: extracted.district,
          description: extracted.description,
          lat: null,
          lng: null,
          video_url: source.video_url,
          video_title: video.title,
          video_id: video.videoId,
          additional_sources: [],
          thumbnail_url: null,
          thumbnail_cached_at: null,
          instagram_urls: [],
          status: "pending",
          needs_review: true,
          source: "auto",
          last_verified_at: null,
          created_at: "",
          updated_at: "",
          categories: extracted.categories.map((c) => c.name),
        } as Temple);

        templesAddedPending++;
      }
    }
  }

  const { error: logError } = await supabase.from("sync_log").insert({
    videos_checked: newVideos.length,
    temples_added_pending: templesAddedPending,
    videos_skipped_non_temple: videosSkippedNonTemple,
    videos_with_multiple_temples: videosWithMultipleTemples,
    errors,
    notes:
      newVideos.length === 0
        ? "YouTube upload listing (step 1) not yet implemented — no videos were checked this run."
        : undefined,
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
    message:
      "Extraction (2) and entity resolution (3) are implemented and wired in. YouTube listing (1) and Nominatim geocoding (4) are still TODO — new rows are inserted with needs_review: true and no coordinates in the meantime.",
  });
}
