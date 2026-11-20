import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconChartBar, IconCopy, IconPlayerPause, IconPlayerPlay, IconPlus, IconTrash } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

import { Empty, ErrorNote, Page, Pill, TableSkeleton, Toolbar, selectCls, tableCls, when } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AudienceRow, JourneyRow } from "../../shared/types";

const STATUSES = ["all", "active", "paused", "draft", "finished"];

export default function Journeys() {
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<JourneyRow | null>(null);
  const query = useActionQuery("list-journeys", { ...(status !== "all" && { status: status as "active" }), ...(search && { search }) });
  const duplicate = useActionMutation("duplicate-journey");
  const remove = useActionMutation("delete-journey");
  const setStatusMutation = useActionMutation("set-journey-status");
  const rows = (query.data?.journeys ?? []) as unknown as JourneyRow[];

  const run = (action: "pause" | "resume", id: string) =>
    setStatusMutation.mutate({ id, action }, { onError: (e) => toast.error(e.message) });

  return (
    <Page>
      <Toolbar>
        <Input aria-label="Search journeys" placeholder="Search journeys" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s[0]!.toUpperCase() + s.slice(1)}</option>)}
        </select>
        <div className="flex-1" />
        <Button onClick={() => setCreating(true)}><IconPlus size={16} />New journey</Button>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton /> : rows.length === 0 ? <Empty>No journeys match. Create one to get started.</Empty> : (
        <table className={tableCls}>
          <thead><tr><th>Name</th><th>Status</th><th>Entry</th><th className="text-right">Steps</th><th className="text-right">Entered</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className="hover:bg-muted/40">
                <td><Link className="font-medium hover:underline" to={`/journeys/${j.id}`}>{j.name}</Link></td>
                <td><Pill value={j.status} /></td>
                <td className="text-muted-foreground">{j.kind === "trigger" ? "Event trigger" : j.audienceName ?? "No audience"}</td>
                <td className="text-right tabular-nums">{j.steps}</td>
                <td className="text-right tabular-nums">{j.entered.toLocaleString()}</td>
                <td className="text-muted-foreground">{when(j.updatedAt)}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    {j.status === "active" ? <Button size="icon-sm" variant="ghost" aria-label={`Pause ${j.name}`} onClick={() => run("pause", j.id)}><IconPlayerPause size={16} /></Button> : null}
                    {j.status === "paused" ? <Button size="icon-sm" variant="ghost" aria-label={`Resume ${j.name}`} onClick={() => run("resume", j.id)}><IconPlayerPlay size={16} /></Button> : null}
                    <Button size="icon-sm" variant="ghost" asChild><Link aria-label={`Report for ${j.name}`} to={`/journeys/${j.id}/report`}><IconChartBar size={16} /></Link></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Duplicate ${j.name}`} onClick={() => duplicate.mutate({ id: j.id }, { onSuccess: () => toast.success("Journey duplicated") })}><IconCopy size={16} /></Button>
                    <Button size="icon-sm" variant="ghost" aria-label={`Delete ${j.name}`} onClick={() => setRemoving(j)}><IconTrash size={16} /></Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NewJourneyDialog open={creating} onOpenChange={setCreating} />
      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete “{removing?.name}”?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Its canvas, members and reports are removed permanently.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => removing && remove.mutate({ id: removing.id }, { onSuccess: () => { setRemoving(null); toast.success("Journey deleted"); } })}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function NewJourneyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"audience" | "trigger">("audience");
  const [audienceId, setAudienceId] = useState("");
  const audiences = useActionQuery("list-audiences", {});
  const create = useActionMutation("create-journey");
  const options = (audiences.data?.audiences ?? []) as unknown as AudienceRow[];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New journey</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input aria-label="Journey name" placeholder="Journey name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <select aria-label="Entry type" className={`${selectCls} w-full`} value={kind} onChange={(e) => setKind(e.target.value as "audience" | "trigger")}>
            <option value="audience">Audience journey: enroll an audience</option>
            <option value="trigger">Trigger journey: enroll on an event</option>
          </select>
          {kind === "audience" ? (
            <select aria-label="Audience" className={`${selectCls} w-full`} value={audienceId} onChange={(e) => setAudienceId(e.target.value)}>
              <option value="">Choose an audience later</option>
              {options.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate({ name: name.trim(), kind, goal: "", ...(audienceId && { audienceId }) }, {
              onSuccess: (r) => { onOpenChange(false); setName(""); navigate(`/journeys/${(r as { id: string }).id}`); },
              onError: (e) => toast.error(e.message),
            })}
          >Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
