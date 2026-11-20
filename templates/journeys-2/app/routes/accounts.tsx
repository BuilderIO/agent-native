import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useState } from "react";
import { toast } from "sonner";

import { Empty, ErrorNote, Page, Pill, TableSkeleton, Toolbar, selectCls, tableCls, when } from "@/components/bits";
import { Input } from "@/components/ui/input";
import type { AccountView } from "../../shared/types";

const OWNERS = ["Priya Shah", "Marcus Lee", "Elena Petrova", "Sam Ortiz"];

export default function Accounts() {
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const query = useActionQuery("list-accounts", { minScore, ...(search && { search }) });
  const owner = useActionMutation("update-account-owner");
  const rows = (query.data?.accounts ?? []) as unknown as AccountView[];
  return (
    <Page wide>
      <Toolbar>
        <Input aria-label="Search accounts" placeholder="Search accounts" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Minimum score" className={selectCls} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))}>
          <option value={0}>Any score</option><option value={50}>Score 50+</option><option value={80}>Score 80+ (hot)</option>
        </select>
      </Toolbar>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton /> : rows.length === 0 ? <Empty>No accounts match.</Empty> : (
        <table className={tableCls}>
          <thead><tr><th>Account</th><th>Score</th><th>Plan</th><th>Owner</th><th className="text-right">Contacts</th><th>Renewal</th><th>Signals</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.domain} · {a.industry}</div></td>
                <td><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${a.score}%` }} /></div><span className="tabular-nums">{a.score}</span><Pill value={a.tier} /></div></td>
                <td>{a.plan}</td>
                <td>
                  <select aria-label={`Owner of ${a.name}`} className={selectCls} value={a.owner} onChange={(e) => owner.mutate({ id: a.id, owner: e.target.value }, { onSuccess: () => toast.success("Owner updated") })}>
                    {OWNERS.map((o) => <option key={o}>{o}</option>)}
                  </select>
                </td>
                <td className="text-right tabular-nums">{a.contacts}</td><td>{when(a.renewalDate)}</td>
                <td className="text-xs text-muted-foreground">{a.signals.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
