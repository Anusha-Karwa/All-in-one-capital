export default function Home() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Inbox</h1>
      <p className="text-sm text-muted-foreground">
        Applications arrive in Phase 3. For now: the knowledge base (
        <a className="underline" href="/memos">
          memos
        </a>
        ,{" "}
        <a className="underline" href="/notes">
          notes
        </a>
        ) and{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
        .
      </p>
    </div>
  );
}
