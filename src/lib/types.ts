// Mirrors supabase/migrations/0001_init.sql — keep in sync by hand until
// this project is wired up to generate types from the live schema
// (`supabase gen types typescript`).

export type TempleStatus = "pending" | "published" | "rejected";
export type TempleSource = "auto" | "manual";

export interface AdditionalSource {
  video_id: string;
  video_url: string;
  video_title: string;
}

export interface Temple {
  id: string;
  name: string;
  deity: string | null;
  state: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  categories: string[];
  video_url: string | null;
  video_title: string | null;
  video_id: string | null;
  additional_sources: AdditionalSource[];
  description: string | null;
  thumbnail_url: string | null;
  thumbnail_cached_at: string | null;
  instagram_urls: string[];
  status: TempleStatus;
  needs_review: boolean;
  source: TempleSource;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  first_seen_video_id: string | null;
  temple_count: number;
  created_at: string;
  updated_at: string;
}

// Shape Claude's extraction step must return for a single video (spec 5a —
// an ARRAY of these per video, not one object, to handle multi-temple videos).
export interface ExtractedTemple {
  isTemple: true;
  templeName: string;
  deity: string | null;
  state: string | null;
  district: string | null;
  categories: {
    name: string;
    isNew: boolean;
    justification: string; // what in the video's own framing supports this category
  }[];
  description: string;
}

export interface ExtractionResult {
  videoId: string;
  temples: ExtractedTemple[]; // empty array for non-temple videos
}
