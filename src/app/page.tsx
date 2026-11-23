import { desc } from "drizzle-orm";
import { NotConfigured } from "@/components/SearchBox";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { applications } from "@/db/schema";
import { withDb } from "@/lib/pageData";

export const dynamic = "force-dynamic";

const age = (d: Date) => {
  const h = (Date.now() - d.getTime()) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))}m` : h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
};
const statusTone = (s: string) =>
  (s === "needs_attention" ? "destructive" : s === "scored" || s === "in_review" ? "default" : "secondary") as
    "destructive" | "default" | "secondary";

export default async function Inbox() {
  const res = await withDb((d) => d.select().from(applications).orderBy(desc(applications.createdAt)).limit(500));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Every application, newest first. Scores, recommendations and flags appear once screening runs (needs model
          keys).
        </p>
      </div>
      {!res.ok ? (
        <NotConfigured reason={res.reason} />
      ) : res.data.length === 0 ? (
        <p className="text-sm">
          No applications yet. Try{" "}
          <a className="underline" href="/apply">
            /apply
          </a>{" "}
          or <code>npm run seed:apps</code>.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Sector (claimed)</TableHead>
              <TableHead>Stage</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {res.data.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-mono text-xs">
                  {a.publicRef}
                  {a.isTest && (
                    <Badge variant="outline" className="ml-2">
                      test
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-medium">{a.companyName}</TableCell>
                <TableCell>
                  {a.sectorClaimed ?? <span className="text-muted-foreground">from form (pending)</span>}
                </TableCell>
                <TableCell>{a.stageClaimed ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>{a.source}</TableCell>
                <TableCell>
                  <Badge variant={statusTone(a.status)}>{a.status}</Badge>
                  {a.statusReason && <span className="ml-2 text-xs text-muted-foreground">{a.statusReason}</span>}
                </TableCell>
                <TableCell>{age(a.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
