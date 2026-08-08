import { getServiceSupabase } from "@/lib/supabase";
import type { Category, Temple } from "@/lib/types";
import TempleMap from "@/app/components/TempleMap";
import {
  approveTemple,
  rejectTemple,
  reverifyTemple,
  updateTemple,
  addTempleManually,
  renameCategory,
  mergeCategory,
  retireCategory,
} from "@/app/admin/actions";

// /admin — protected by basic auth via src/middleware.ts (spec Section 6).
export default async function AdminPage() {
  const supabase = getServiceSupabase();
  const [{ data: pending }, { data: published }, { data: categoryRows }] = await Promise.all([
    supabase
      .from("temples")
      .select("*")
      .eq("status", "pending")
      .order("needs_review", { ascending: false })
      .order("created_at", { ascending: true }),
    supabase.from("temples").select("*").eq("status", "published").order("name"),
    supabase.from("categories").select("*").order("name"),
  ]);

  const pendingRows = (pending ?? []) as Temple[];
  const publishedRows = (published ?? []) as Temple[];
  const categories = (categoryRows ?? []) as Category[];

  return (
    <main className="p-8 max-w-5xl mx-auto space-y-12">
      <header>
        <h1 className="text-2xl font-semibold mb-1">Temple Atlas — Admin</h1>
        <p className="text-sm text-neutral-500">
          {pendingRows.length} pending · {publishedRows.length} published
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-3">Pending queue</h2>
        {pendingRows.length === 0 && (
          <p className="text-neutral-500">Nothing waiting on review right now.</p>
        )}
        <ul className="space-y-3">
          {pendingRows.map((t) => (
            <PendingRow key={t.id} temple={t} />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Published ({publishedRows.length})</h2>
        <ul className="space-y-2">
          {publishedRows.map((t) => (
            <li
              key={t.id}
              className="border border-neutral-200 rounded-lg p-3 flex items-center justify-between"
            >
              <div>
                <span className="font-medium">{t.name}</span>{" "}
                <span className="text-sm text-neutral-500">
                  · {t.state ?? "state unknown"}
                  {t.last_verified_at &&
                    ` · verified ${new Date(t.last_verified_at).toLocaleDateString()}`}
                </span>
              </div>
              <form action={reverifyTemple.bind(null, t.id)}>
                <button className="text-xs text-blue-600 underline" type="submit">
                  Re-verify
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Add a temple manually</h2>
        <p className="text-sm text-neutral-500 mb-3">
          For anything the pipeline misses or gets wrong. This is also where Instagram reel
          links get added (spec 4a — never populated automatically).
        </p>
        <TempleForm action={addTempleManually} submitLabel="Add temple" />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Categories ({categories.length})</h2>
        <p className="text-sm text-neutral-500 mb-3">
          Merge, rename, or retire as the taxonomy grows. These always go through the SQL
          cascade functions so a change here can&apos;t drift out of sync with temples that already
          carry the old value (spec 4b).
        </p>
        <ul className="space-y-2 mb-4">
          {categories.map((c) => (
            <li key={c.id} className="text-sm border border-neutral-200 rounded-lg p-2">
              <span className="font-medium">{c.name}</span>{" "}
              <span className="text-neutral-500">
                ({c.slug}) · {c.temple_count} temple{c.temple_count === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <CategoryActionForm
            action={renameCategory}
            title="Rename"
            fields={["Old name", "New name"]}
          />
          <CategoryActionForm
            action={mergeCategory}
            title="Merge"
            fields={["From (folded away)", "Into (kept)"]}
          />
          <CategoryActionForm action={retireCategory} title="Retire" fields={["Name"]} />
        </div>
      </section>
    </main>
  );
}

function PendingRow({ temple: t }: { temple: Temple }) {
  return (
    <li
      className={`border rounded-lg p-4 ${
        t.needs_review ? "border-amber-400 bg-amber-50" : "border-neutral-200"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium">{t.name || "(untitled)"}</span>
        <div className="flex items-center gap-3">
          {t.needs_review && (
            <span className="text-xs font-semibold text-amber-700 uppercase">Needs review</span>
          )}
          <form action={approveTemple.bind(null, t.id)}>
            <button className="text-xs text-green-700 font-medium" type="submit">
              Approve
            </button>
          </form>
          <form action={rejectTemple.bind(null, t.id)}>
            <button className="text-xs text-red-700 font-medium" type="submit">
              Reject
            </button>
          </form>
        </div>
      </div>
      <p className="text-sm text-neutral-600 mb-2">
        {t.state ?? "state unknown"} · {t.deity ?? "deity unknown"}
        {t.video_url && (
          <>
            {" · "}
            <a href={t.video_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
              source video
            </a>
          </>
        )}
      </p>

      {t.lat != null && t.lng != null ? (
        <div className="h-40 mb-3 rounded overflow-hidden">
          <TempleMap temples={[t]} />
        </div>
      ) : (
        <p className="text-xs text-neutral-400 mb-3">No coordinates yet.</p>
      )}

      <details>
        <summary className="text-sm text-neutral-500 cursor-pointer">Edit</summary>
        <div className="mt-3">
          <TempleForm action={updateTemple.bind(null, t.id)} submitLabel="Save" temple={t} />
        </div>
      </details>
    </li>
  );
}

function TempleForm({
  action,
  submitLabel,
  temple,
}: {
  action: (formData: FormData) => Promise<void>;
  submitLabel: string;
  temple?: Temple;
}) {
  return (
    <form action={action} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
      <Field label="Name" name="name" defaultValue={temple?.name} required />
      <Field label="Deity" name="deity" defaultValue={temple?.deity ?? ""} />
      <Field label="State" name="state" defaultValue={temple?.state ?? ""} />
      <Field label="District" name="district" defaultValue={temple?.district ?? ""} />
      <Field label="Latitude" name="lat" defaultValue={temple?.lat?.toString() ?? ""} />
      <Field label="Longitude" name="lng" defaultValue={temple?.lng?.toString() ?? ""} />
      <Field label="Video URL" name="video_url" defaultValue={temple?.video_url ?? ""} />
      <Field label="Video title" name="video_title" defaultValue={temple?.video_title ?? ""} />
      <Field label="Video ID" name="video_id" defaultValue={temple?.video_id ?? ""} />
      <Field
        label="Categories (comma-separated)"
        name="categories"
        defaultValue={temple?.categories?.join(", ") ?? ""}
      />
      <Field
        label="Instagram reel URLs (comma-separated)"
        name="instagram_urls"
        defaultValue={temple?.instagram_urls?.join(", ") ?? ""}
      />
      <label className="col-span-full flex flex-col gap-1">
        <span className="text-neutral-600">Description</span>
        <textarea
          name="description"
          defaultValue={temple?.description ?? ""}
          className="border border-neutral-300 rounded px-2 py-1"
          rows={2}
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" name="needs_review" defaultChecked={temple?.needs_review} />
        <span className="text-neutral-600">Needs review</span>
      </label>
      <div className="col-span-full">
        <button
          type="submit"
          className="bg-neutral-900 text-white text-sm px-4 py-1.5 rounded"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-neutral-600">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="border border-neutral-300 rounded px-2 py-1"
      />
    </label>
  );
}

function CategoryActionForm({
  action,
  title,
  fields,
}: {
  action: (...args: string[]) => Promise<void>;
  title: string;
  fields: string[];
}) {
  // Binds all field values positionally into the server action call. Needs
  // its own "use server" directive since it's an inline closure defined in
  // a Server Component, not a top-level export from a "use server" file.
  async function handle(formData: FormData) {
    "use server";
    const values = fields.map((_, i) => String(formData.get(`f${i}`) ?? ""));
    await action(...values);
  }

  return (
    <form action={handle} className="border border-neutral-200 rounded-lg p-3 space-y-2">
      <p className="font-medium">{title}</p>
      {fields.map((label, i) => (
        <input
          key={i}
          name={`f${i}`}
          placeholder={label}
          required
          className="w-full border border-neutral-300 rounded px-2 py-1"
        />
      ))}
      <button type="submit" className="text-xs bg-neutral-900 text-white px-3 py-1 rounded">
        {title}
      </button>
    </form>
  );
}
