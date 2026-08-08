import type Anthropic from "@anthropic-ai/sdk";
import type { Category, VideoForExtraction } from "@/lib/types";

// The extraction step (spec Section 4 & 5). Two hard rules this prompt has
// to enforce, both called out explicitly in the spec because they're easy
// to get wrong:
//
//   1. Category membership is only ever claimed by the video ITSELF — a
//      series name, playlist title, hashtag, or explicit statement in the
//      title/description. Never infer that a temple belongs to a
//      well-known circuit (Jyotirlinga, Shakti Peetha, etc.) just because
//      it happens to be one, if the video doesn't say so.
//   2. Not every video is a single-temple deep dive. Interviews, vlogs, and
//      shorts should produce an EMPTY temples array, not a forced entry.
//      Compilation/day-trip videos should produce MULTIPLE entries, not one
//      merged or truncated one.

export function buildExtractionSystemPrompt(existingCategories: Category[]): string {
  const categoryList =
    existingCategories.length > 0
      ? existingCategories.map((c) => `- ${c.name} (slug: ${c.slug})`).join("\n")
      : "(none yet — this is the first video processed, so every category proposal will be new)";

  return `You extract structured temple data from a single YouTube video's own title and description, for a catalog of Hindu temples covered by the creator @thetemplegirl.

You will be told the video's title, description, and (if known) the playlists it belongs to. Use ONLY what the video itself states or clearly implies. Do not use outside knowledge about temples, circuits, or traditions to add claims the video doesn't make.

Rules:

1. Most videos feature one temple, but some feature several (a compilation or "day trip" video), and some feature none (interviews, vlogs, shorts, channel updates). Report one entry per temple actually covered — zero, one, or several. Do not force a video into having exactly one entry.

2. For each temple, extract:
   - templeName: the temple's common name as stated in the video
   - deity: primary deity, if stated
   - state: Indian state/UT, if stated or clearly identifiable from the video's own content
   - district: if stated
   - locationHints: any other place names mentioned for this temple (nearby town, landmark, region) — used later to disambiguate temples with common names, so include anything specific even if it seems redundant with state/district
   - description: a 1–2 sentence factual summary drawn from the video's own description of the temple
   - categories: see below

3. Categories — this is the part most likely to go wrong, so read carefully. A category is a label like "Jyotirlinga," "Char Dham," or one of her own recurring series names. A temple gets a category ONLY if the video's own title, description, playlist membership, or explicit narration frames it that way. If the temple is popularly known as part of some circuit but the video does not say so, do NOT add that category — leave it uncategorized instead.

   Existing categories already in the system:
${categoryList}

   For each category you assign:
   - Check it against the existing list first. If it's clearly the same concept under different phrasing (e.g. "Jyotirlinga" vs "Jyotirlingas of Shiva"), use the EXISTING name and slug — do not create a near-duplicate.
   - Set isNew: true only if this genuinely isn't represented in the existing list.
   - justification: quote or closely paraphrase the specific evidence from the title/description/playlist that supports this category. If you can't point to specific evidence, don't assign the category — use an empty categories array for that temple instead (the pipeline will bucket it as uncategorized).

4. If nothing in the video qualifies as temple coverage under rule 1, return an empty temples array. Don't stretch a vlog or interview into a fabricated entry.

Call the report_temples tool with your results. Do not respond in plain text.`;
}

export function buildExtractionUserPrompt(video: VideoForExtraction): string {
  const playlists =
    video.playlistTitles && video.playlistTitles.length > 0
      ? video.playlistTitles.join(", ")
      : "(unknown / not provided)";

  return `Video ID: ${video.videoId}
Title: ${video.title}
Playlists this video belongs to: ${playlists}

Description:
${video.description}`;
}

// Forced tool-use schema — the extraction call sets tool_choice to this tool
// so the response is always structured, never prose. Not `as const`: the
// Anthropic SDK's Tool type wants a mutable string[] for `required`, and a
// readonly tuple from `as const` doesn't satisfy that.
export const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "report_temples",
  description:
    "Report the temples (zero, one, or several) actually covered in this video, per the rules in the system prompt.",
  input_schema: {
    type: "object",
    properties: {
      temples: {
        type: "array",
        items: {
          type: "object",
          properties: {
            templeName: { type: "string" },
            deity: { type: ["string", "null"] },
            state: { type: ["string", "null"] },
            district: { type: ["string", "null"] },
            locationHints: {
              type: "array",
              items: { type: "string" },
            },
            description: { type: "string" },
            categories: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  isNew: { type: "boolean" },
                  justification: { type: "string" },
                },
                required: ["name", "isNew", "justification"],
              },
            },
          },
          required: [
            "templeName",
            "deity",
            "state",
            "district",
            "locationHints",
            "description",
            "categories",
          ],
        },
      },
    },
    required: ["temples"],
  },
};
