export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">All In Capital — Inbound Screening</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Phase 0 scaffold. The inbox arrives in Phase 3. Health:{" "}
        <a className="underline" href="/api/health">
          /api/health
        </a>
      </p>
    </main>
  );
}
