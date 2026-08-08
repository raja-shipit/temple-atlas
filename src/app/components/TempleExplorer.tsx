"use client";

import { useMemo, useState } from "react";
import type { Temple } from "@/lib/types";
import TempleMap from "@/app/components/TempleMap";

// Public frontend requirements (spec Section 7): search, category filter
// (multi-select), state filter, card list synced to the same filters, and
// a trip planner that adds temples to a plan and draws a straight-line
// connector between stops (explicitly not driving directions) with basic
// reordering.
export default function TempleExplorer({ temples }: { temples: Temple[] }) {
  const [query, setQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedState, setSelectedState] = useState<string>("");
  const [tripPlan, setTripPlan] = useState<string[]>([]); // ordered temple ids

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    temples.forEach((t) => t.categories.forEach((c) => set.add(c)));
    return [...set].sort();
  }, [temples]);

  const allStates = useMemo(() => {
    const set = new Set<string>();
    temples.forEach((t) => t.state && set.add(t.state));
    return [...set].sort();
  }, [temples]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return temples.filter((t) => {
      if (q) {
        const haystack = `${t.name} ${t.deity ?? ""} ${t.description ?? ""}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (selectedState && t.state !== selectedState) return false;
      if (
        selectedCategories.length > 0 &&
        !selectedCategories.some((c) => t.categories.includes(c))
      ) {
        return false;
      }
      return true;
    });
  }, [temples, query, selectedState, selectedCategories]);

  const tripTemples = useMemo(
    () =>
      tripPlan
        .map((id) => temples.find((t) => t.id === id))
        .filter((t): t is Temple => Boolean(t)),
    [tripPlan, temples]
  );

  const tripPlanCoords = useMemo<[number, number][]>(
    () =>
      tripTemples
        .filter((t) => t.lat != null && t.lng != null)
        .map((t) => [t.lng as number, t.lat as number]),
    [tripTemples]
  );

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  function addToTrip(id: string) {
    setTripPlan((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }

  function removeFromTrip(id: string) {
    setTripPlan((prev) => prev.filter((x) => x !== id));
  }

  function moveInTrip(id: string, direction: -1 | 1) {
    setTripPlan((prev) => {
      const idx = prev.indexOf(id);
      const swapWith = idx + direction;
      if (idx === -1 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }

  return (
    <main className="flex h-screen">
      <aside className="w-96 border-r border-neutral-200 p-4 overflow-y-auto flex flex-col gap-6">
        <div>
          <h1 className="text-lg font-semibold mb-1">Temple Atlas</h1>
          <p className="text-sm text-neutral-500">
            Temples covered by @thetemplegirl on YouTube.
          </p>
        </div>

        <div className="space-y-3">
          <input
            type="search"
            placeholder="Search by name or deity..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full border border-neutral-300 rounded px-3 py-1.5 text-sm"
          />

          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="w-full border border-neutral-300 rounded px-3 py-1.5 text-sm"
          >
            <option value="">All states</option>
            {allStates.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          {allCategories.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {allCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  className={`text-xs px-2 py-1 rounded-full border ${
                    selectedCategories.includes(cat)
                      ? "bg-amber-700 text-white border-amber-700"
                      : "border-neutral-300 text-neutral-600"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {tripTemples.length > 0 && (
          <div className="border border-sky-200 bg-sky-50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-sky-900">
                Trip plan ({tripTemples.length})
              </h2>
              <button
                onClick={() => setTripPlan([])}
                className="text-xs text-sky-700 underline"
              >
                Clear
              </button>
            </div>
            <p className="text-xs text-sky-700 mb-2">
              The line on the map connects your stops in order as a straight line — it&apos;s
              not a driving route.
            </p>
            <ol className="space-y-1">
              {tripTemples.map((t, i) => (
                <li key={t.id} className="flex items-center justify-between text-sm">
                  <span>
                    {i + 1}. {t.name}
                  </span>
                  <span className="flex gap-1">
                    <button
                      onClick={() => moveInTrip(t.id, -1)}
                      disabled={i === 0}
                      className="text-xs disabled:opacity-30"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveInTrip(t.id, 1)}
                      disabled={i === tripTemples.length - 1}
                      className="text-xs disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => removeFromTrip(t.id)}
                      className="text-xs text-red-600"
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div>
          <p className="text-xs text-neutral-400 mb-2">
            {filtered.length} temple{filtered.length === 1 ? "" : "s"}
          </p>

          {filtered.length === 0 ? (
            <p className="text-sm text-neutral-500">
              {temples.length === 0
                ? "No published temples yet — check back once the pipeline and admin review are wired up."
                : "Nothing matches these filters. Try clearing a filter or broadening your search."}
            </p>
          ) : (
            <ul className="space-y-3">
              {filtered.map((t) => (
                <li key={t.id} className="border border-neutral-200 rounded-lg p-3">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs text-neutral-500">{t.state}</p>
                  <div className="flex items-center gap-3 mt-1">
                    {t.video_url && (
                      <a
                        href={t.video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-blue-600 underline"
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
                    <button
                      onClick={() =>
                        tripPlan.includes(t.id) ? removeFromTrip(t.id) : addToTrip(t.id)
                      }
                      className="text-xs text-sky-700 underline ml-auto"
                    >
                      {tripPlan.includes(t.id) ? "Remove from trip" : "Add to trip"}
                    </button>
                  </div>
                  {t.last_verified_at && (
                    <p className="text-xs text-neutral-400 mt-1">
                      Last verified {new Date(t.last_verified_at).toLocaleDateString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      <div className="flex-1">
        <TempleMap temples={filtered} tripPlanCoords={tripPlanCoords} />
      </div>
    </main>
  );
}
