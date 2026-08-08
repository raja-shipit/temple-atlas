import type { VideoForExtraction } from "@/lib/types";

// spec Section 5: "Use the channel's uploads playlist (UU + channel ID
// with UC stripped) via playlistItems.list, paginated, stopping once a
// previously-seen video_id is hit." Rate limits are a non-issue at this
// cadence (10,000 units/day free tier, ~1 video/week).
const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

function uploadsPlaylistId(channelId: string): string {
  if (!channelId.startsWith("UC")) {
    throw new Error(`Expected a channel ID starting with "UC", got: ${channelId}`);
  }
  return "UU" + channelId.slice(2);
}

interface PlaylistItemsPage {
  items: {
    snippet: {
      title: string;
      description: string;
      resourceId: { videoId: string };
    };
  }[];
  nextPageToken?: string;
}

// Returns new videos since `lastSeenVideoId`, oldest-first-stopped (i.e. it
// pages forward from most recent and stops as soon as it hits a video
// already known), most-recent-first in the returned array. Pass
// lastSeenVideoId = null to fetch everything (first-ever run).
export async function listNewUploads(
  channelId: string,
  apiKey: string,
  lastSeenVideoId: string | null,
  maxPages = 5
): Promise<VideoForExtraction[]> {
  const playlistId = uploadsPlaylistId(channelId);
  const results: VideoForExtraction[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(
        `YouTube playlistItems.list failed: ${res.status} ${await res.text()}`
      );
    }
    const data = (await res.json()) as PlaylistItemsPage;

    let hitKnownVideo = false;
    for (const item of data.items) {
      const videoId = item.snippet.resourceId.videoId;
      if (lastSeenVideoId && videoId === lastSeenVideoId) {
        hitKnownVideo = true;
        break;
      }
      results.push({
        videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        // Playlist membership beyond the uploads playlist itself would
        // need a separate playlists.list + per-playlist playlistItems.list
        // walk to check membership, which is expensive to do per-video at
        // any scale. Left empty for now — the extraction prompt still
        // works fine off title/description alone; wire this in later if
        // series categorization proves too weak without it.
        playlistTitles: [],
      });
    }

    if (hitKnownVideo || !data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return results;
}

interface VideosListItem {
  id: string;
  snippet: {
    thumbnails: {
      high?: { url: string };
      medium?: { url: string };
      default?: { url: string };
    };
  };
}

// Used both at ingestion time (to populate thumbnail_url) and by the 30-day
// refresh job (spec 5c).
export async function fetchThumbnails(
  videoIds: string[],
  apiKey: string
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (videoIds.length === 0) return result;

  // videos.list accepts up to 50 IDs per call.
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL(`${YOUTUBE_API_BASE}/videos`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new Error(`YouTube videos.list failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as { items: VideosListItem[] };

    const found = new Set(data.items.map((v) => v.id));
    for (const item of data.items) {
      const thumb =
        item.snippet.thumbnails.high?.url ??
        item.snippet.thumbnails.medium?.url ??
        item.snippet.thumbnails.default?.url ??
        null;
      result.set(item.id, thumb);
    }
    // A video that's gone (deleted/private) simply won't appear in items —
    // record it as null so callers can distinguish "checked, gone" from
    // "not checked yet".
    for (const id of batch) {
      if (!found.has(id)) result.set(id, null);
    }
  }

  return result;
}
