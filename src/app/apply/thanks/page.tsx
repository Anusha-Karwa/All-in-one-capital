export default async function Thanks({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="text-xl font-semibold">Application received</h1>
      {ref && (
        <p>
          Your reference number is <span className="font-mono font-semibold">{ref}</span>. Please quote it if you write
          to us.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        A person on the team reviews every application. If we&apos;d like to talk, we&apos;ll email you to find a time.
      </p>
    </div>
  );
}
