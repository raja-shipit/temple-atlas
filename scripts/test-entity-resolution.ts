// Sanity-checks entity resolution (spec 5b) against a handful of scenarios
// that matter in practice:
//
//   1. Exact repeat — same name, same state -> should auto-attach
//   2. Spelling/phrasing variant ("Temple" vs "Mandir") -> should auto-attach
//   3. Same name, different state -> should NOT auto-attach (common temple
//      names repeat across many states)
//   4. Genuinely unrelated temple -> no match, no meaningful candidate
//
// Run with: npx tsx scripts/test-entity-resolution.ts
import { resolveTempleEntity } from "@/lib/entity-resolution";
import type { ExtractedTemple, Temple } from "@/lib/types";

function fakeTemple(overrides: Partial<Temple>): Temple {
  return {
    id: "id",
    name: "Placeholder",
    deity: null,
    state: null,
    district: null,
    lat: null,
    lng: null,
    categories: [],
    video_url: null,
    video_title: null,
    video_id: "existing-video",
    additional_sources: [],
    description: null,
    thumbnail_url: null,
    thumbnail_cached_at: null,
    instagram_urls: [],
    status: "published",
    needs_review: false,
    source: "auto",
    last_verified_at: null,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function fakeExtracted(overrides: Partial<ExtractedTemple>): ExtractedTemple {
  return {
    templeName: "Placeholder",
    deity: null,
    state: null,
    district: null,
    locationHints: [],
    categories: [],
    description: "",
    ...overrides,
  };
}

const existingTemples: Temple[] = [
  fakeTemple({ id: "t1", name: "Somnath Temple", state: "Gujarat", district: "Gir Somnath" }),
  fakeTemple({ id: "t2", name: "Durga Mandir", state: "Bihar", district: "Patna" }),
  fakeTemple({ id: "t3", name: "Meenakshi Amman Temple", state: "Tamil Nadu", district: "Madurai" }),
];

const scenarios: { label: string; extracted: ExtractedTemple }[] = [
  {
    label: "1. Exact repeat (same name, same state) -> expect auto-attach to t1",
    extracted: fakeExtracted({ templeName: "Somnath Temple", state: "Gujarat" }),
  },
  {
    label: '2. Phrasing variant ("Temple" vs "Mandir", same state) -> expect auto-attach to t1',
    extracted: fakeExtracted({ templeName: "Somnath Mandir", state: "Gujarat" }),
  },
  {
    label: "3. Same name, different state -> expect NO auto-attach",
    extracted: fakeExtracted({ templeName: "Durga Mandir", state: "Uttar Pradesh" }),
  },
  {
    label: "4. Unrelated temple -> expect no match at all",
    extracted: fakeExtracted({ templeName: "Kedarnath Temple", state: "Uttarakhand" }),
  },
];

for (const { label, extracted } of scenarios) {
  const result = resolveTempleEntity(extracted, existingTemples);
  console.log(`\n${label}`);
  console.log(`  Input: "${extracted.templeName}" (${extracted.state ?? "state unknown"})`);
  if (result.match) {
    console.log(
      `  MATCH -> "${result.match.temple.name}" (${result.match.temple.state}), confidence ${result.match.confidence.toFixed(2)} — ${result.match.reason}`
    );
  } else {
    console.log("  No auto-attach match.");
  }
  if (result.candidates.length > 0) {
    console.log("  Candidates considered:");
    for (const c of result.candidates) {
      console.log(
        `    - "${c.temple.name}" (${c.temple.state}): ${c.confidence.toFixed(2)} — ${c.reason}`
      );
    }
  }
}
