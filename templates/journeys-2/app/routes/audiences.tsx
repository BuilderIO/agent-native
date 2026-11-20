import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Empty, ErrorNote, Page, TableSkeleton, Toolbar, selectCls, tableCls, when } from "@/components/bits";
import { Button } from "@/components/ui/button";
import type { AudienceRow } from "../../shared/types";

const KIND: Record<string, string> = { dynamic: "Dynamic list", static: "Static list", segment: "Segment" };

export default function Audiences() {
  const navigate = useNavigate();
  const [kind, setKind] = useState("");
  const query = useActionQuery("list-audiences", kind ? { kind: kind as "dynamic" } : {});
  const save = useActionMutation("save-audience");
  const remove = useActionMutation("delete-audience");
  const rows = (query.data?.audiences ?? []) as unknown as AudienceRow[];
  const create = (k: "dynamic" | "static" | "segment") => save.mutate({ kind: k, name: `New ${KIND[k]!.toLowerCase()}` }, { onSuccess: (r) => navigate(`/audiences/${(r as { id: string }).id}`) });
  return (
    <Page>
      <Toolbar>
        <select aria-label="Kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All audiences</option>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => create("static")}><IconPlus size={16} />Static list</Button>
        <Button variant="outline" onClick={() => create("segment")}><IconPlus size={16} />Segment</Button>
        <Button onClick={() => create("dynamic")}><IconPlus size={16} />Dynamic list</Button>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton /> : rows.length === 0 ? <Empty>No audiences yet.</Empty> : (
        <table className={tableCls}>
          <thead><tr><th>Name</th><th>Type</th><th className="text-right">Members</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} className="hover:bg-muted/40">
                <td><Link className="font-medium hover:underline" to={`/audiences/${a.id}`}>{a.name}</Link></td>
                <td>{KIND[a.kind] ?? a.kind}</td>
                <td className="text-right tabular-nums">{a.size}</td>
                <td className="text-muted-foreground">{when(a.updatedAt)}</td>
                <td className="text-right"><Button size="icon-sm" variant="ghost" aria-label={`Delete ${a.name}`} onClick={() => remove.mutate({ id: a.id }, { onSuccess: () => toast.success("Audience deleted") })}><IconTrash size={16} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
