import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconUpload } from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { Empty, ErrorNote, Page, Pill, TableSkeleton, Toolbar, selectCls, tableCls, when } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ContactRowView } from "../../shared/types";

const PAGE = 25;
const STAGES = ["lead", "marketing qualified", "sales qualified", "opportunity", "customer"];

function parseCsv(text: string) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = (head ?? "").split(",").map((c) => c.trim().toLowerCase());
  return lines.map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const row: Record<string, string> = {};
    cols.forEach((c, i) => { row[c] = cells[i] ?? ""; });
    return { email: row.email ?? "", name: row.name, title: row.title, country: row.country, company: row.company };
  });
}

export default function Contacts() {
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [page, setPage] = useState(0);
  const [importing, setImporting] = useState(false);
  const query = useActionQuery("list-contacts", { limit: PAGE, offset: page * PAGE, ...(search && { search }), ...(stage && { lifecycleStage: stage }) });
  const rows = (query.data?.contacts ?? []) as unknown as ContactRowView[];
  const total = query.data?.total ?? 0;
  return (
    <Page wide>
      <Toolbar>
        <Input aria-label="Search contacts" placeholder="Search name, email, company" className="w-72" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        <select aria-label="Lifecycle stage" className={selectCls} value={stage} onChange={(e) => { setStage(e.target.value); setPage(0); }}>
          <option value="">All stages</option>{STAGES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground tabular-nums">{total} contacts</span>
        <Button onClick={() => setImporting(true)}><IconUpload size={16} />Import contacts</Button>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton /> : rows.length === 0 ? <Empty>No contacts match.</Empty> : (
        <table className={tableCls}>
          <thead><tr><th>Name</th><th>Company</th><th>Title</th><th>Stage</th><th>Source</th><th>Last active</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-muted/40">
                <td><Link className="font-medium hover:underline" to={`/contacts/${c.id}`}>{c.name}</Link><div className="text-xs text-muted-foreground">{c.email}{c.subscribed ? "" : " · unsubscribed"}</div></td>
                <td>{c.company}</td><td className="text-muted-foreground">{c.title}</td><td><Pill value={c.lifecycleStage} /></td><td>{c.source}</td><td className="text-muted-foreground">{when(c.lastActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </Page>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [csv, setCsv] = useState("email,name,title,country,company\njamie.rivera@example.com,Jamie Rivera,Growth Lead,United States,Northwind Labs");
  const run = useActionMutation("import-contacts");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Import contacts</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Paste CSV with a header row. Existing emails are updated.</p>
        <textarea aria-label="CSV" className="min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={run.isPending} onClick={() => run.mutate({ rows: parseCsv(csv) }, {
            onSuccess: (r) => { const x = r as { created: number; updated: number; skipped: number }; toast.success(`${x.created} created, ${x.updated} updated, ${x.skipped} skipped`); onOpenChange(false); },
            onError: (e) => toast.error(e.message),
          })}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
