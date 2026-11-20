import { useActionQuery } from "@agent-native/core/client/hooks";
import { IconChevronLeft } from "@tabler/icons-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { ErrorNote, Page, Pill, Stat, TableSkeleton, Toolbar, selectCls, tableCls, when } from "@/components/bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface Totals { sent: number; delivered: number; opened: number; clicked: number; bounced: number; unsubscribed: number }
interface Report {
  journey: { name: string; status: string; entered: number; exited: number };
  totals: Totals; rates: Record<string, number>;
  perEmail: (Totals & { emailId: string; name: string; openRate: number; clickRate: number })[];
  daily: ({ day: string } & Totals)[];
  topLinks: { url: string; clicks: number }[]; clients: { name: string; share: number }[];
}
interface Member { id: string; name: string; email: string; status: string; enteredAt: string; exitedAt: string | null }

export default function JourneyReport() {
  const { id = "" } = useParams();
  const [range, setRange] = useState<"30d" | "all">("30d");
  const [tab, setTab] = useState<"emails" | "members">("emails");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const query = useActionQuery("get-journey-report", { id, range });
  const members = useActionQuery("list-journey-members", { id, ...(status && { status: status as "active" }), ...(search && { search }) });
  const report = (query.data?.report ?? null) as unknown as Report | null;
  const rows = (members.data?.members ?? []) as unknown as Member[];
  const peak = Math.max(1, ...(report?.daily.map((d) => d.sent) ?? [1]));

  return (
    <Page wide>
      <Toolbar>
        <Button asChild size="icon-sm" variant="ghost"><Link aria-label="Back to journey" to={`/journeys/${id}`}><IconChevronLeft size={18} /></Link></Button>
        <h1 className="text-base font-semibold">{report?.journey.name ?? "Report"}</h1>
        {report ? <Pill value={report.journey.status} /> : null}
        <div className="flex-1" />
        <select aria-label="Timeframe" className={selectCls} value={range} onChange={(e) => setRange(e.target.value as "30d" | "all")}>
          <option value="30d">Last one month</option><option value="all">All time</option>
        </select>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : !report ? <TableSkeleton rows={4} /> : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            <Stat label="Sent" value={report.totals.sent.toLocaleString()} />
            <Stat label="Delivered" value={report.totals.delivered.toLocaleString()} hint={`${report.rates.delivered}%`} />
            <Stat label="Opened" value={report.totals.opened.toLocaleString()} hint={`${report.rates.opened}%`} />
            <Stat label="Clicked" value={report.totals.clicked.toLocaleString()} hint={`${report.rates.clicked}%`} />
            <Stat label="Bounced" value={report.totals.bounced.toLocaleString()} hint={`${report.rates.bounced}%`} />
            <Stat label="Unsubscribed" value={report.totals.unsubscribed.toLocaleString()} hint={`${report.rates.unsubscribed}%`} />
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">Emails sent per day</div>
            <div className="flex h-28 items-end gap-1 rounded-lg border p-3" role="img" aria-label="Emails sent per day">
              {report.daily.map((d) => <div key={d.day} title={`${d.day}: ${d.sent} sent`} className="flex-1 rounded-t bg-primary/70" style={{ height: `${(d.sent / peak) * 100}%` }} />)}
            </div>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 text-sm font-medium">Top links</div>
              <table className={tableCls}><tbody>{report.topLinks.map((l) => <tr key={l.url}><td className="truncate">{l.url}</td><td className="text-right tabular-nums">{l.clicks}</td></tr>)}</tbody></table>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium">Email clients</div>
              <table className={tableCls}><tbody>{report.clients.map((c) => <tr key={c.name}><td>{c.name}</td><td className="text-right tabular-nums">{Math.round(c.share * 100)}%</td></tr>)}</tbody></table>
            </div>
          </div>
          <div>
            <div className="mb-3 flex gap-1" role="tablist">
              {(["emails", "members"] as const).map((t) => <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "secondary" : "ghost"} onClick={() => setTab(t)}>{t === "emails" ? "Emails" : "Journey members"}</Button>)}
            </div>
            {tab === "emails" ? (
              <table className={tableCls}>
                <thead><tr><th>Email</th><th className="text-right">Sent</th><th className="text-right">Delivered</th><th className="text-right">Open rate</th><th className="text-right">Click rate</th><th className="text-right">Bounced</th></tr></thead>
                <tbody>{report.perEmail.map((e) => <tr key={e.emailId}><td>{e.name}</td><td className="text-right tabular-nums">{e.sent}</td><td className="text-right tabular-nums">{e.delivered}</td><td className="text-right tabular-nums">{e.openRate}%</td><td className="text-right tabular-nums">{e.clickRate}%</td><td className="text-right tabular-nums">{e.bounced}</td></tr>)}</tbody>
              </table>
            ) : (
              <>
                <Toolbar>
                  <Input aria-label="Search members" placeholder="Search contacts" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
                  <select aria-label="Member status" className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                    <option value="">All statuses</option><option value="active">Active</option><option value="completed">Completed</option><option value="exited">Exited</option>
                  </select>
                </Toolbar>
                <table className={tableCls}>
                  <thead><tr><th>Contact</th><th>Entry date</th><th>Exit date</th><th>Status</th></tr></thead>
                  <tbody>{rows.map((m) => <tr key={m.id}><td>{m.name}<div className="text-xs text-muted-foreground">{m.email}</div></td><td>{when(m.enteredAt)}</td><td>{when(m.exitedAt)}</td><td><Pill value={m.status} /></td></tr>)}</tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}
