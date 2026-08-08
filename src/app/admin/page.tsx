import { getServiceSupabase } from "@/lib/supabase";
import type { Temple } from "@/lib/types";

// /admin — protected by basic auth via src/middleware.ts (spec Section 6).
// Shows the pending queue. needs_review rows are visually distinguished per
// spec: "Queue should visually distinguish needs_review rows from ordinary
// pending ones."
//
// Still to build: editable fields per row, map preview, approve/reject
// actions (approve sets last_verified_at = now(), spec Section 6/7), the
// manual "add temple" form (where instagram_urls gets populated, spec 4a),
// and the category merge/rename/retire controls that call
// rename_category_cascade / merge_category_cascade (spec 4b, see the SQL
// migration) instead of touching `categories` directly.
export default async function AdminPage() {
  const supabase = getServiceSupabase();
  const { data: pending } = await supabase
    .from("temples")
    .select("*")
    .eq("status", "pending")
    .order("needs_review", { ascending: false })
    .order("created_at", { ascending: true });

  const rows = (pending ?? []) as Temple[];

  return (
    <main className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Temple Atlas — Admin</h1>
      <p className="text-sm text-neutral-500 mb-6">
        {rows.length} pending entr{rows.length === 1 ? "y" : "ies"}
      </p>

      {rows.length === 0 && (
        <p className="text-neutral-500">Nothing waiting on review right now.</p>
      )}

      <ul className="space-y-3">
        {rows.map((t) => (
          <li
            key={t.id}
            className={`border rounded-lg p-4 ${
              t.needs_review ? "border-amber-400 bg-amber-50" : "border-neutral-200"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium">{t.name || "(untitled)"}</span>
              {t.needs_review && (
                <span className="text-xs font-semibold text-amber-700 uppercase">
                  Needs review
                </span>
              )}
            </div>
            <p className="text-sm text-neutral-600">
              {t.state ?? "state unknown"} · {t.deity ?? "deity unknown"}
            </p>
            {t.video_url && (
              <a
                href={t.video_url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-600 underline"
              >
                Source video
              </a>
            )}
            {/* TODO: edit form, map preview, approve/reject buttons */}
          </li>
        ))}
      </ul>
    </main>
  );
}
