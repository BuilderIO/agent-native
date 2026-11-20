import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Empty, ErrorNote, Field, Page, TableSkeleton, Toolbar, selectCls, tableCls } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ACTIVITY_EVENTS, type ConversionRow, type JourneyRow } from "../../shared/types";

export default function Conversions() {
  const query = useActionQuery("list-conversions", {});
  const journeys = useActionQuery("list-journeys", {});
  const save = useActionMutation("save-conversion");
  const remove = useActionMutation("delete-conversion");
  const [draft, setDraft] = useState<{ name: string; eventType: string; windowDays: number; journeyId: string } | null>(null);
  const rows = (query.data?.conversions ?? []) as unknown as ConversionRow[];
  const jr = (journeys.data?.journeys ?? []) as unknown as JourneyRow[];
  const jname = (id: string | null) => jr.find((j) => j.id === id)?.name ?? "All journeys";
  return (
    <Page>
      <Toolbar>
        <div className="flex-1" />
        <Button onClick={() => setDraft({ name: "", eventType: "form_submitted", windowDays: 14, journeyId: "" })}><IconPlus size={16} />New conversion</Button>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton rows={3} /> : rows.length === 0 ? <Empty>No conversions yet.</Empty> : (
        <table className={tableCls}>
          <thead><tr><th>Conversion</th><th>Event</th><th className="text-right">Window</th><th>Journey</th><th className="text-right">Conversions</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td><td>{ACTIVITY_EVENTS.find((a) => a.key === c.eventType)?.label ?? c.eventType}</td>
                <td className="text-right tabular-nums">{c.windowDays} days</td><td>{jname(c.journeyId)}</td><td className="text-right tabular-nums">{c.count}</td>
                <td className="text-right"><Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => remove.mutate({ id: c.id }, { onSuccess: () => toast.success("Conversion deleted") })}><IconTrash size={16} /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>New conversion</DialogTitle></DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <Field label="Name"><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
              <Field label="Counts when a contact">
                <select className={`${selectCls} w-full`} value={draft.eventType} onChange={(e) => setDraft({ ...draft, eventType: e.target.value })}>{ACTIVITY_EVENTS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select>
              </Field>
              <Field label="Within (days of entering the journey)"><Input type="number" min={1} value={draft.windowDays} onChange={(e) => setDraft({ ...draft, windowDays: Number(e.target.value) })} /></Field>
              <Field label="Journey">
                <select className={`${selectCls} w-full`} value={draft.journeyId} onChange={(e) => setDraft({ ...draft, journeyId: e.target.value })}>
                  <option value="">All journeys</option>{jr.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                </select>
              </Field>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Cancel</Button>
            <Button disabled={!draft?.name.trim()} onClick={() => draft && save.mutate({ name: draft.name, eventType: draft.eventType, windowDays: draft.windowDays, journeyId: draft.journeyId || null }, { onSuccess: () => { setDraft(null); toast.success("Conversion saved"); }, onError: (e) => toast.error(e.message) })}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
