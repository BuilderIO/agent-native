import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronLeft } from "@tabler/icons-react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

import { ErrorNote, Pill, selectCls, tableCls, when } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ACTIVITY_EVENTS } from "../../shared/types";

const STAGES = ["lead", "marketing qualified", "sales qualified", "opportunity", "customer"];

interface Detail {
  id: string; name: string; email: string; title: string; country: string; state: string; lifecycleStage: string; source: string; subscribed: number;
  activity: Record<string, number>; account: { id: string; name: string; plan: string; score: number } | null;
  journeys: { journeyId: string; name: string; status: string; enteredAt: string; exitedAt: string | null }[];
}

export default function ContactDetail() {
  const { id = "" } = useParams();
  const query = useActionQuery("get-contact", { id });
  const update = useActionMutation("update-contact");
  const c = (query.data?.contact ?? null) as unknown as Detail | null;
  if (query.error) return <div className="p-6"><ErrorNote error={query.error} /></div>;
  if (!c) return <div className="p-6"><Skeleton className="h-80 w-full" /></div>;
  const patch = (values: { lifecycleStage?: string; subscribed?: boolean }) => update.mutate({ id, ...values }, { onSuccess: () => toast.success("Contact updated"), onError: (e) => toast.error(e.message) });
  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex items-center gap-3">
        <Button asChild size="icon-sm" variant="ghost"><Link aria-label="Back to contacts" to="/contacts"><IconChevronLeft size={18} /></Link></Button>
        <div><h1 className="text-lg font-semibold">{c.name}</h1><div className="text-sm text-muted-foreground">{c.title} · {c.email}</div></div>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-3 rounded-lg border p-4 text-sm">
          <div><div className="text-xs text-muted-foreground">Account</div>{c.account ? `${c.account.name} · ${c.account.plan} · score ${c.account.score}` : "—"}</div>
          <div><div className="text-xs text-muted-foreground">Location</div>{[c.state, c.country].filter(Boolean).join(", ") || "—"}</div>
          <div><div className="text-xs text-muted-foreground">Source</div>{c.source || "—"}</div>
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Lifecycle stage</div>
            <select aria-label="Lifecycle stage" className={`${selectCls} w-full`} value={c.lifecycleStage} onChange={(e) => patch({ lifecycleStage: e.target.value })}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <label className="flex items-center gap-2"><Switch checked={!!c.subscribed} onCheckedChange={(v) => patch({ subscribed: v })} />Subscribed to marketing email</label>
        </div>
        <div className="rounded-lg border p-4 md:col-span-2">
          <div className="mb-2 text-sm font-medium">Activity, last 30 days</div>
          <table className={tableCls}><tbody>{ACTIVITY_EVENTS.map((a) => <tr key={a.key}><td>{a.label}</td><td className="text-right tabular-nums">{c.activity[a.key] ?? 0}</td></tr>)}</tbody></table>
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium">Journeys</div>
        {c.journeys.length === 0 ? <p className="text-sm text-muted-foreground">Not in any journey.</p> : (
          <table className={tableCls}>
            <thead><tr><th>Journey</th><th>Status</th><th>Entered</th><th>Exited</th></tr></thead>
            <tbody>{c.journeys.map((j) => <tr key={j.journeyId}><td><Link className="hover:underline" to={`/journeys/${j.journeyId}`}>{j.name}</Link></td><td><Pill value={j.status} /></td><td>{when(j.enteredAt)}</td><td>{when(j.exitedAt)}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}
