// Quick way to sanity-check the extraction prompt without wiring up the
// full cron pipeline. Run with:
//
//   npx tsx scripts/test-extraction.ts scripts/fixtures/sample-video.json
//
// If ANTHROPIC_API_KEY is set (e.g. via `.env.local`, loaded manually or
// with `dotenv -e .env.local -- npx tsx ...`), it actually calls the API and
// prints the parsed result. Without a key, it just prints the system/user
// prompts that would be sent, so you can review the wording itself.
import { readFileSync } from "fs";
import type { Category, VideoForExtraction } from "@/lib/types";
import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
} from "@/lib/extraction-prompt";

// Pretend the catalog already has a couple of categories, to exercise the
// "match existing vs. propose new" instruction.
const EXISTING_CATEGORIES: Category[] = [
  {
    id: "1",
    name: "Jyotirlinga",
    slug: "jyotirlinga",
    color: "#b45309",
    first_seen_video_id: "abc",
    temple_count: 3,
    created_at: "",
    updated_at: "",
  },
  {
    id: "2",
    name: "Char Dham",
    slug: "char-dham",
    color: "#0369a1",
    first_seen_video_id: "def",
    temple_count: 1,
    created_at: "",
    updated_at: "",
  },
];

async function main() {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error(
      "Usage: npx tsx scripts/test-extraction.ts <path-to-fixture.json>"
    );
    process.exit(1);
  }

  const video: VideoForExtraction = JSON.parse(readFileSync(fixturePath, "utf-8"));

  console.log("=== SYSTEM PROMPT ===\n");
  console.log(buildExtractionSystemPrompt(EXISTING_CATEGORIES));
  console.log("\n=== USER PROMPT ===\n");
  console.log(buildExtractionUserPrompt(video));

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "\n(No ANTHROPIC_API_KEY set — skipping the live API call. Set it to actually run extraction.)"
    );
    return;
  }

  const { extractTemplesFromVideo } = await import("@/lib/extraction");
  const result = await extractTemplesFromVideo(video, EXISTING_CATEGORIES);

  console.log("\n=== EXTRACTION RESULT ===\n");
  console.log(JSON.stringify(result, null, 2));
}

main();
