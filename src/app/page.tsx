import { getPublicSupabase } from "@/lib/supabase";
import type { Temple } from "@/lib/types";
import TempleMap from "@/app/components/TempleMap";

// Public homepage — map + sidebar per spec Section 7. Still to build:
// search, category filter (multi-select), state filter, card list synced
// to map viewport, trip planner, and the "Watch reel" link for
// instagram_urls when present. Card should show "Last verified: <date>"
// from last_verified_at (spec Section 7, resolved decision 4).
export default async function Home() {
  const supabase = getPublicSupabase();
  const { data: temples } = await supabase
    .from("temples")
    .select("*")
    .eq("status", "published")
    .order("name");

  const rows = (temples ?? []) as Temple[];

  return (
    <main className="flex h-screen">
      <aside className="w-80 border-r border-neutral-200 p-4 overflow-y-auto">
        <h1 className="text-lg font-semibold mb-1">Temple Atlas</h1>
        <p className="text-sm text-neutral-500 mb-4">
          Temples covered by @thetemplegirl on YouTube.
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No published temples yet — check back once the pipeline and
            admin review are wired up.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((t) => (
              <li key={t.id} className="border border-neutral-200 rounded-lg p-3">
                <p className="font-medium">{t.name}</p>
                <p className="text-xs text-neutral-500">{t.state}</p>
                {t.video_url && (
                  <a
                    href={t.video_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-blue-600 underline mr-2"
                  >
                    Watch video
                  </a>
                )}
                {t.instagram_urls?.length > 0 && (
                  <a
                    href={t.instagram_urls[0]}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-pink-600 underline"
                  >
                    Watch reel
                  </a>
                )}
                {t.last_verified_at && (
                  <p className="text-xs text-neutral-400 mt-1">
                    Last verified{" "}
                    {new Date(t.last_verified_at).toLocaleDateString()}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className="flex-1">
        <TempleMap temples={rows} />
      </div>
    </main>
  );
}
