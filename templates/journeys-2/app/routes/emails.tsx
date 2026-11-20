import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Empty, ErrorNote, Page, Pill, TableSkeleton, Toolbar, selectCls, tableCls, when } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EmailRow } from "../../shared/types";

export default function Emails() {
  const navigate = useNavigate();
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const query = useActionQuery("list-emails", { ...(kind && { kind: kind as "marketing" }), ...(search && { search }) });
  const save = useActionMutation("save-email");
  const remove = useActionMutation("delete-email");
  const rows = (query.data?.emails ?? []) as unknown as EmailRow[];
  return (
    <Page>
      <Toolbar>
        <Input aria-label="Search emails" placeholder="Search emails" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option><option value="marketing">Marketing</option><option value="internal">Internal alert</option><option value="transactional">Transactional</option>
        </select>
        <div className="flex-1" />
        <Button onClick={() => save.mutate({}, { onSuccess: (r) => navigate(`/emails/${(r as { id: string }).id}`) })}><IconPlus size={16} />New email</Button>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton /> : rows.length === 0 ? <Empty>No emails yet.</Empty> : (
        <table className={tableCls}>
          <thead><tr><th>Name</th><th>Subject</th><th>Kind</th><th>Status</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-muted/40">
                <td><Link className="font-medium hover:underline" to={`/emails/${e.id}`}>{e.name}</Link></td>
                <td className="text-muted-foreground">{e.subject}</td>
                <td className="capitalize">{e.kind}</td>
                <td><Pill value={e.status} /></td>
                <td className="text-muted-foreground">{when(e.updatedAt)}</td>
                <td className="text-right"><Button size="icon-sm" variant="ghost" aria-label={`Delete ${e.name}`} onClick={() => remove.mutate({ id: e.id }, { onSuccess: () => toast.success("Email deleted") })}><IconTrash size={16} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
