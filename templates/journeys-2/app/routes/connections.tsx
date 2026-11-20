import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconRefresh } from "@tabler/icons-react";
import { toast } from "sonner";

import { ErrorNote, Page, Pill, TableSkeleton, tableCls, when } from "@/components/bits";
import { Button } from "@/components/ui/button";
import type { ConnectionRow } from "../../shared/types";

export default function Connections() {
  const query = useActionQuery("list-connections", {});
  const set = useActionMutation("set-connection");
  const rows = (query.data?.connections ?? []) as unknown as ConnectionRow[];
  const act = (id: string, action: "connect" | "disconnect" | "sync", done: string) =>
    set.mutate({ id, action }, { onSuccess: () => toast.success(done), onError: (e) => toast.error(e.message) });
  return (
    <Page>
      {query.error ? <ErrorNote error={query.error} /> : query.isLoading ? <TableSkeleton rows={6} /> : (
        <table className={tableCls}>
          <thead><tr><th>Connection</th><th>Category</th><th>Status</th><th>Last sync</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><div className="font-medium">{c.provider}</div><div className="text-xs text-muted-foreground">{c.detail}</div></td>
                <td>{c.category}</td><td><Pill value={c.status} /></td><td className="text-muted-foreground">{when(c.lastSyncAt)}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    {c.status === "connected" ? (
                      <>
                        <Button size="sm" variant="outline" onClick={() => act(c.id, "sync", `Synced ${c.provider}`)}><IconRefresh size={14} />Sync now</Button>
                        <Button size="sm" variant="ghost" onClick={() => act(c.id, "disconnect", `Disconnected ${c.provider}`)}>Disconnect</Button>
                      </>
                    ) : <Button size="sm" onClick={() => act(c.id, "connect", `Connected ${c.provider}`)}>Connect</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Page>
  );
}
