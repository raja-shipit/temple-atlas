import type { ExtractedTemple, Temple } from "@/lib/types";

// Implements spec 5b: `video_id` dedupes videos, not temples. If she
// revisits a temple in a later video, or a compilation covers one she's
// already featured, this decides whether a newly extracted temple is the
// same physical temple as an existing row (-> attach as an additional
// source) or genuinely new (-> insert a new pending row).
//
// Per the spec's data flow (Section 3), this runs BEFORE geocoding — so it
// can only use what the extraction step already produced (name, state,
// district, locationHints), not lat/lng. That's fine: temple names plus
// state/district are almost always enough to tell "Somnath Temple, Gujarat"
// apart from "Somnath Temple, Rajasthan" — coordinate proximity would only
// matter for entries this text-based pass leaves ambiguous, and none of
// that logic exists yet since geocoding hasn't run.

export interface EntityMatch {
  temple: Temple;
  confidence: number; // 0–1
  reason: string;
}

export interface ResolutionResult {
  match: EntityMatch | null;
  // Runner-up candidates below the auto-attach threshold but above the
  // "clearly unrelated" floor — surfaced so an admin reviewing a pending
  // entry can see what it was compared against, even when we chose not to
  // auto-attach.
  candidates: EntityMatch[];
}

// Auto-attach as an additional source on the matched temple rather than
// creating a new row.
const AUTO_ATTACH_THRESHOLD = 0.85;
// Below this, don't even bother surfacing it as a candidate — too weak to
// be useful signal for a reviewer.
const CANDIDATE_FLOOR = 0.55;

export function resolveTempleEntity(
  extracted: ExtractedTemple,
  existingTemples: Temple[]
): ResolutionResult {
  const scored = existingTemples
    .map((temple) => scoreMatch(extracted, temple))
    .filter((m): m is EntityMatch => m !== null && m.confidence >= CANDIDATE_FLOOR)
    .sort((a, b) => b.confidence - a.confidence);

  const top = scored[0];
  const match = top && top.confidence >= AUTO_ATTACH_THRESHOLD ? top : null;

  return { match, candidates: scored };
}

function scoreMatch(extracted: ExtractedTemple, temple: Temple): EntityMatch | null {
  const nameSim = nameSimilarity(extracted.templeName, temple.name);
  if (nameSim < CANDIDATE_FLOOR) return null;

  const sameState = sameLocationField(extracted.state, temple.state);
  const sameDistrict = sameLocationField(extracted.district, temple.district);

  // A hard mismatch on state is a strong signal these are different
  // temples even with an identical name — generic temple names ("Durga
  // Mandir", "Shiva Temple") repeat across many states, which is exactly
  // the collision the spec calls out. Always downweight heavily here; do
  // NOT special-case "near-exact" name matches back up, since normalizing
  // away generic words like "temple"/"mandir" can make two clearly
  // different common-name temples look identical (e.g. both normalize to
  // just "durga"). Only penalize when both sides actually state a value;
  // treat "unknown" as neutral rather than a false negative.
  const stateKnownAndDiffers =
    extracted.state != null && temple.state != null && !sameState;

  if (stateKnownAndDiffers) {
    return {
      temple,
      confidence: nameSim * 0.4,
      reason: `Name similarity ${nameSim.toFixed(2)}, but stated states differ ("${extracted.state}" vs "${temple.state}") — likely a different temple of the same/similar name.`,
    };
  }

  let confidence = nameSim;
  const reasons = [`name similarity ${nameSim.toFixed(2)}`];

  if (sameState) {
    confidence = Math.min(1, confidence + 0.08);
    reasons.push("same state");
  }
  if (sameDistrict) {
    confidence = Math.min(1, confidence + 0.05);
    reasons.push("same district");
  }

  // locationHints from the extraction step (e.g. a nearby town or landmark)
  // matching text already on the temple's name/state/district is a mild
  // corroborating signal, not proof on its own.
  const hintOverlap = extracted.locationHints.some(
    (hint) =>
      containsNormalized(temple.name, hint) ||
      (temple.district && containsNormalized(temple.district, hint))
  );
  if (hintOverlap) {
    confidence = Math.min(1, confidence + 0.03);
    reasons.push("location hint overlap");
  }

  return {
    temple,
    confidence,
    reason: reasons.join(", "),
  };
}

function sameLocationField(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return normalize(a) === normalize(b);
}

function containsNormalized(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

// Strip common temple-name suffixes/prefixes and punctuation so "Somnath
// Temple" and "Somnath Mandir" compare on the part that actually
// identifies the place, not the generic noun for "temple".
const GENERIC_TERMS = [
  "temple",
  "mandir",
  "kovil",
  "koil",
  "devasthanam",
  "shrine",
];

function normalize(value: string): string {
  let s = value.toLowerCase().trim();
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  for (const term of GENERIC_TERMS) {
    s = s.replace(new RegExp(`\\b${term}\\b`, "g"), "");
  }
  return s.replace(/\s+/g, " ").trim();
}

function nameSimilarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;
  if (na.length === 0 || nb.length === 0) return 0;

  const distance = levenshteinDistance(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - distance / maxLen;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}
