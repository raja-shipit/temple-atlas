import { getPublicSupabase } from "@/lib/supabase";
import type { Temple } from "@/lib/types";
import TempleExplorer from "@/app/components/TempleExplorer";

// Public homepage (spec Section 7). Fetches published temples server-side,
// then hands off to the client component for search/filter/trip-planner
// interactivity — see src/app/components/TempleExplorer.tsx.
export default async function Home() {
  const supabase = getPublicSupabase();
  const { data: temples } = await supabase
    .from("temples")
    .select("*")
    .eq("status", "published")
    .order("name");

  return <TempleExplorer temples={(temples ?? []) as Temple[]} />;
}
