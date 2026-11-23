import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeNote, NotConfigured, SearchBox } from "@/components/SearchBox";
import { loadNotes } from "@/knowledge/queries";
import { tryEmbedQuery, withDb } from "@/lib/pageData";

export const dynamic = "force-dynamic";

export default async function NotesPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const emb = await tryEmbedQuery(q);
  const res = await withDb((d) => loadNotes(d, q, emb.vector));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Partner meeting notes</h1>
        <p className="text-sm text-muted-foreground">
          5 meetings, chunked. Rules R1–R14 below link to the exact chunk they come from.
        </p>
      </div>
      {!res.ok ? (
        <NotConfigured reason={res.reason} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Thesis rules</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {res.data.rules.length === 0 && (
                <p className="text-sm">
                  No rules imported yet — run <code>npm run kb:import</code>.
                </p>
              )}
              {res.data.rules.map((r) => {
                const chunkId = r.source.split("#")[1];
                return (
                  <div key={r.id} className="text-sm">
                    <span className="mr-2 font-mono font-medium">{r.id}</span>
                    {r.text}
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      {r.quote ? (
                        <>
                          <a className="underline" href={`#${chunkId}`}>
                            {r.source}
                          </a>
                          <span className="italic text-muted-foreground">“{r.quote}”</span>
                        </>
                      ) : (
                        <Badge variant="destructive">source unverified — not found in imported notes</Badge>
                      )}
                      {r.sectors.length > 0 && <Badge variant="outline">{r.sectors.join(", ")}</Badge>}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <SearchBox q={q} placeholder="e.g. MeetRecord, defensive, thesis" />
          <ModeNote mode={res.data.mode} note={emb.note} />
          {res.data.notes
            .filter((n) => res.data.mode === "all" || res.data.chunks.some((c) => c.noteId === n.id))
            .map((n) => (
              <Card key={n.id}>
                <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
                  <CardTitle className="text-base">
                    Meeting {n.id}: {n.title}
                  </CardTitle>
                  {n.meetingDate && <Badge variant="outline">{n.meetingDate}</Badge>}
                  <span className="ml-auto text-xs text-muted-foreground">{n.sourceRef}</span>
                </CardHeader>
                <CardContent className="space-y-3">
                  {res.data.chunks
                    .filter((c) => c.noteId === n.id)
                    .map((c) => (
                      <p key={c.id} id={c.id} className="whitespace-pre-line text-sm">
                        <span className="mr-2 font-mono text-xs text-muted-foreground">{c.id}</span>
                        {c.text}
                      </p>
                    ))}
                </CardContent>
              </Card>
            ))}
        </>
      )}
    </div>
  );
}
