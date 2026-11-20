import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Empty, ErrorNote, Field, Page, TableSkeleton, Toolbar, selectCls, tableCls } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PROPERTY_FIELDS, type TokenRow } from "../../shared/types";

export default function Tokens() {
  const query = useActionQuery("list-tokens", {});
  const save = useActionMutation("save-token");
  const remove = useActionMutation("delete-token");
  const [editing, setEditing] = useState<Partial<TokenRow> | null>(null);
  const rows = (query.data?.tokens ?? []) as unknown as TokenRow[];
  return (
    <Page>
      <Toolbar>
        <div className="flex-1" />
        <Button onClick={() => setEditing({ name: "", kind: "text", source: "name", fallback: "", rules: [] })}><IconPlus size={16} />New token</Button>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton rows={4} /> : rows.length === 0 ? <Empty>No tokens yet.</Empty> : (
        <table className={tableCls}>
          <thead><tr><th>Token</th><th>Reads</th><th>Fallback</th><th>Rules</th><th /></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="cursor-pointer hover:bg-muted/40" onClick={() => setEditing(t)}>
                <td><code className="text-xs">{`{{${t.name}}}`}</code></td><td>{t.source}</td><td className="text-muted-foreground">{t.fallback || "—"}</td><td>{t.rules.length}</td>
                <td className="text-right"><Button size="icon-sm" variant="ghost" aria-label={`Delete ${t.name}`} onClick={(e) => { e.stopPropagation(); remove.mutate({ id: t.id }, { onSuccess: () => toast.success("Token deleted") }); }}><IconTrash size={16} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit token" : "New token"}</DialogTitle></DialogHeader>
          {editing ? (
            <div className="space-y-3">
              <Field label="Name (snake_case)"><Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Reads field">
                <select className={`${selectCls} w-full`} value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })}>
                  {PROPERTY_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              </Field>
              <Field label="Fallback value"><Input value={editing.fallback ?? ""} onChange={(e) => setEditing({ ...editing, fallback: e.target.value })} /></Field>
              <Field label="Rules, one per line as value=output">
                <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={(editing.rules ?? []).map((r) => `${r.when}=${r.then}`).join("\n")} onChange={(e) => setEditing({ ...editing, rules: e.target.value.split("\n").filter((l) => l.includes("=")).map((l) => ({ when: l.split("=")[0]!.trim(), then: l.slice(l.indexOf("=") + 1).trim() })) })} />
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => editing && save.mutate({ ...(editing.id && { id: editing.id }), name: editing.name, source: editing.source, fallback: editing.fallback, rules: editing.rules } as never, { onSuccess: () => { setEditing(null); toast.success("Token saved"); }, onError: (e) => toast.error(e.message) })}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
