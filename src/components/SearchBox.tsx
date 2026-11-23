import { Input } from "@/components/ui/input";

export function SearchBox({ q, placeholder }: { q: string; placeholder: string }) {
  return (
    <form className="flex gap-2" role="search">
      <Input name="q" defaultValue={q} placeholder={placeholder} className="max-w-md" />
      <button className="rounded-md border px-3 text-sm hover:bg-muted" type="submit">
        Search
      </button>
    </form>
  );
}

export function ModeNote({ mode, note }: { mode: string; note?: string }) {
  if (mode === "all" && !note) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {mode === "semantic" ? "Semantic (vector) matches, closest first." : mode === "keyword" ? "Keyword matches." : ""}{" "}
      {note}
    </p>
  );
}

export function NotConfigured({ reason }: { reason: string }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
      {reason} Set it in <code>.env.local</code>, run <code>npm run db:migrate</code> and <code>npm run kb:import</code>
      .
    </div>
  );
}
