"use server";

import { revalidatePath } from "next/cache";
import { getServiceSupabase } from "@/lib/supabase";

// Server actions backing the /admin UI (spec Section 6). Kept as plain
// functions rather than API routes since they're only ever called from the
// admin forms, which are already behind basic auth via src/middleware.ts.

export async function approveTemple(templeId: string) {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("temples")
    .update({ status: "published", last_verified_at: new Date().toISOString() })
    .eq("id", templeId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function rejectTemple(templeId: string) {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("temples")
    .update({ status: "rejected" })
    .eq("id", templeId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

// Re-verify an already-published entry without editing it — bumps
// last_verified_at so the public "Last verified" timestamp (spec Section
// 7, resolved decision 4) stays honest without forcing a no-op edit.
export async function reverifyTemple(templeId: string) {
  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from("temples")
    .update({ last_verified_at: new Date().toISOString() })
    .eq("id", templeId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
}

export interface TempleFormFields {
  name: string;
  deity: string;
  state: string;
  district: string;
  lat: string;
  lng: string;
  description: string;
  video_url: string;
  video_title: string;
  video_id: string;
  categories: string; // comma-separated in the form, split before saving
  instagram_urls: string; // comma-separated
  needs_review: boolean;
}

function parseTempleForm(formData: FormData): Record<string, unknown> {
  return {
    name: String(formData.get("name") ?? ""),
    deity: emptyToNull(formData.get("deity")),
    state: emptyToNull(formData.get("state")),
    district: emptyToNull(formData.get("district")),
    lat: numberOrNull(formData.get("lat")),
    lng: numberOrNull(formData.get("lng")),
    description: emptyToNull(formData.get("description")),
    video_url: emptyToNull(formData.get("video_url")),
    video_title: emptyToNull(formData.get("video_title")),
    video_id: emptyToNull(formData.get("video_id")),
    categories: splitCsv(formData.get("categories")),
    instagram_urls: splitCsv(formData.get("instagram_urls")),
    needs_review: formData.get("needs_review") === "on",
  };
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

function numberOrNull(v: FormDataEntryValue | null): number | null {
  const s = v == null ? "" : String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function splitCsv(v: FormDataEntryValue | null): string[] {
  const s = v == null ? "" : String(v);
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// Manual "add temple" form (spec Section 6) — also where instagram_urls
// gets populated (spec 4a), since the pipeline never touches that field.
export async function addTempleManually(formData: FormData) {
  const supabase = getServiceSupabase();
  const fields = parseTempleForm(formData);

  const { error } = await supabase.from("temples").insert({
    ...fields,
    status: "pending",
    source: "manual",
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
}

export async function updateTemple(templeId: string, formData: FormData) {
  const supabase = getServiceSupabase();
  const fields = parseTempleForm(formData);

  const { error } = await supabase.from("temples").update(fields).eq("id", templeId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
}

// Category merge/rename/retire (spec 4b) — routed through the SQL cascade
// functions in the migration so a rename can never drift out of sync with
// the denormalized temples.categories array. Never update `categories`
// directly from the admin UI for a rename/merge — always go through these.
export async function renameCategory(oldName: string, newName: string) {
  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc("rename_category_cascade", {
    old_name: oldName,
    new_name: newName,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
}

export async function mergeCategory(fromName: string, toName: string) {
  const supabase = getServiceSupabase();
  const { error } = await supabase.rpc("merge_category_cascade", {
    from_name: fromName,
    to_name: toName,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  revalidatePath("/");
}

// Retire = delete the category row and strip it from every temple that
// carries it, without folding it into another category (unlike merge).
export async function retireCategory(name: string) {
  const supabase = getServiceSupabase();

  const { data: affected, error: fetchError } = await supabase
    .from("temples")
    .select("id, categories")
    .contains("categories", [name]);
  if (fetchError) throw new Error(fetchError.message);

  for (const row of affected ?? []) {
    const next = (row.categories as string[]).filter((c) => c !== name);
    const { error: updateError } = await supabase
      .from("temples")
      .update({ categories: next })
      .eq("id", row.id);
    if (updateError) throw new Error(updateError.message);
  }

  const { error: deleteError } = await supabase.from("categories").delete().eq("name", name);
  if (deleteError) throw new Error(deleteError.message);

  revalidatePath("/admin");
  revalidatePath("/");
}
