// Nominatim geocoding client — resolved decision (spec Section 3, 9): the
// public API, not self-hosted. Their usage policy requires max 1
// request/second and an identifying User-Agent; both are enforced here so
// nothing downstream has to remember to.
const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";

// Simple in-process throttle. Good enough at this app's actual call volume
// (~1 video/week -> at most a handful of geocode calls per cron run); not
// meant to coordinate across multiple server instances, which Vercel's
// serverless functions don't share state between anyway, so a single
// instance handling one cron invocation at a time is the right scope for
// this throttle.
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1100;

async function throttle() {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastRequestAt = Date.now();
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  importance: number;
  address?: {
    state?: string;
    state_district?: string;
    county?: string;
    city?: string;
    town?: string;
    village?: string;
  };
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  confidence: number; // 0-1, heuristic — see geocodeTemple
  needsReview: boolean;
  reason: string;
}

// Geocodes a temple using name + state as the primary query (spec Section
// 5), then sanity-checks the result against the extraction step's
// locationHints and stated state — because common temple names ("Durga
// Mandir", "Shiva Temple") repeat across many towns, a geocoder can return
// a confident-looking result for entirely the wrong place.
export async function geocodeTemple(params: {
  templeName: string;
  state: string | null;
  district: string | null;
  locationHints: string[];
}): Promise<GeocodeResult | null> {
  const userAgent = process.env.NOMINATIM_USER_AGENT;
  if (!userAgent) {
    throw new Error(
      "Missing NOMINATIM_USER_AGENT env var — required by Nominatim's usage policy."
    );
  }

  const queryParts = [params.templeName, params.district, params.state, "India"].filter(
    Boolean
  );
  const query = queryParts.join(", ");

  await throttle();

  const url = new URL(NOMINATIM_BASE);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "3");
  url.searchParams.set("countrycodes", "in");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": userAgent },
  });

  if (!res.ok) {
    throw new Error(`Nominatim request failed: ${res.status} ${await res.text()}`);
  }

  const results = (await res.json()) as NominatimResult[];
  if (results.length === 0) {
    return null;
  }

  const top = results[0];
  const { confidence, needsReview, reason } = assessConfidence(params, results);

  return {
    lat: parseFloat(top.lat),
    lng: parseFloat(top.lon),
    displayName: top.display_name,
    confidence,
    needsReview,
    reason,
  };
}

function assessConfidence(
  params: { state: string | null; locationHints: string[] },
  results: NominatimResult[]
): { confidence: number; needsReview: boolean; reason: string } {
  const top = results[0];
  const resultState = top.address?.state ?? null;

  // Multiple candidate results is itself a signal of an ambiguous/common
  // name — Nominatim ranks by relevance, but "top result" isn't the same
  // as "confident result" when there were several plausible matches.
  const multipleCandidates = results.length > 1;

  const stateKnownAndMismatched =
    params.state != null && resultState != null && !statesMatch(params.state, resultState);

  if (stateKnownAndMismatched) {
    return {
      confidence: 0.2,
      needsReview: true,
      reason: `Geocoder's top result is in "${resultState}" but the video states "${params.state}" — likely resolved to the wrong same-named temple.`,
    };
  }

  const hintMatchesDisplayName = params.locationHints.some((hint) =>
    top.display_name.toLowerCase().includes(hint.toLowerCase())
  );

  if (multipleCandidates && !hintMatchesDisplayName) {
    return {
      confidence: 0.55,
      needsReview: true,
      reason: `Multiple candidate locations returned and none of the video's own location hints (${params.locationHints.join(", ") || "none given"}) appear in the top result's address — worth a manual check.`,
    };
  }

  return {
    confidence: 0.9,
    needsReview: false,
    reason: stateKnownAndMismatched
      ? "State mismatch"
      : hintMatchesDisplayName
        ? "Location hint corroborated by geocoder result."
        : "Single clear match, state agrees or unstated.",
  };
}

function statesMatch(a: string, b: string): boolean {
  return normalizeState(a) === normalizeState(b);
}

function normalizeState(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}
