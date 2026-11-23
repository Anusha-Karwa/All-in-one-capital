import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModeNote, NotConfigured, SearchBox } from "@/components/SearchBox";
import { loadMemos } from "@/knowledge/queries";
import { tryEmbedQuery, withDb } from "@/lib/pageData";

export const dynamic = "force-dynamic";

const SECTION_LABEL: Record<string, string> = {
  what_it_does: "What it does",
  founder_assessment: "Founder assessment",
  risks: "Risks",
  why_decision: "Why we invested / passed",
};

export default async function MemosPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim();
  const emb = await tryEmbedQuery(q);
  const res = await withDb((d) => loadMemos(d, q, emb.vector));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Deal memos</h1>
        <p className="text-sm text-muted-foreground">
          The fund&apos;s 12 past decisions, split by section. Section ids (e.g. M3.risks) are what scorecards cite.
        </p>
      </div>
      <SearchBox q={q} placeholder="e.g. repeat rate, regulator, owns the risk" />
      {!res.ok ? (
        <NotConfigured reason={res.reason} />
      ) : res.data.memos.length === 0 ? (
        <p className="text-sm">
          No memos imported yet — run <code>npm run kb:import</code>.
        </p>
      ) : (
        <>
          <ModeNote mode={res.data.mode} note={emb.note} />
          <div className="grid gap-4">
            {res.data.memos
              .filter((m) => res.data.mode === "all" || res.data.sections.some((s) => s.memoId === m.id))
              .map((m) => (
                <Card key={m.id} id={`M${m.id}`}>
                  <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
                    <CardTitle className="text-base">
                      #{m.id} {m.company}
                    </CardTitle>
                    <Badge variant={m.decision === "INVESTED" ? "default" : "secondary"}>{m.decision}</Badge>
                    <Badge variant="outline">{m.sector}</Badge>
                    {m.stage && <Badge variant="outline">{m.stage}</Badge>}
                    <span className="ml-auto text-xs text-muted-foreground">{m.sourceRef}</span>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {res.data.sections
                      .filter((s) => s.memoId === m.id)
                      .map((s) => (
                        <section key={s.id} id={s.id}>
                          <h3 className="text-sm font-medium">
                            {SECTION_LABEL[s.section] ?? s.section}{" "}
                            <span className="font-mono text-xs text-muted-foreground">
                              {s.id} · {s.pageRef}
                            </span>
                          </h3>
                          <p className="whitespace-pre-line text-sm">{s.text}</p>
                        </section>
                      ))}
                  </CardContent>
                </Card>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
