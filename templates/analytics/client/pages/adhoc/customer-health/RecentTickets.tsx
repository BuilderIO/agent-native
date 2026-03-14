import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getIdToken } from "@/lib/auth";
import { TablePagination, usePagination } from "./TablePagination";

interface PylonIssue {
  id: string;
  title: string;
  state: string;
  priority?: string;
  created_at: string;
  updated_at: string;
}

interface RecentTicketsProps {
  companyName: string;
}

function StateBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    open: "bg-yellow-500/10 text-yellow-500",
    closed: "bg-green-500/10 text-green-500",
    pending: "bg-blue-500/10 text-blue-500",
    snoozed: "bg-muted text-muted-foreground",
  };
  const color = colors[state.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${color}`}>
      {state}
    </span>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function RecentTickets({ companyName }: RecentTicketsProps) {
  const [issues, setIssues] = useState<PylonIssue[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchIssues() {
      setIsLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        // First find the Pylon account matching this company
        const accountsRes = await fetch(
          `/api/pylon/accounts?query=${encodeURIComponent(companyName)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!accountsRes.ok) throw new Error(`Failed to fetch accounts (${accountsRes.status})`);
        const accountsData = await accountsRes.json();
        const accounts = accountsData.accounts ?? [];

        if (accounts.length === 0) {
          if (!cancelled) {
            setIssues([]);
            setIsLoading(false);
          }
          return;
        }

        // Fetch issues for the first matching account
        const accountId = accounts[0].id;
        const issuesRes = await fetch(
          `/api/pylon/issues?account_id=${encodeURIComponent(accountId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!issuesRes.ok) throw new Error(`Failed to fetch issues (${issuesRes.status})`);
        const issuesData = await issuesRes.json();

        if (!cancelled) {
          setIssues(issuesData.issues ?? []);
          setIsLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      }
    }

    fetchIssues();
    return () => { cancelled = true; };
  }, [companyName]);

  const openCount = issues.filter((i) => i.state.toLowerCase() !== "closed").length;
  const { page, totalPages, pageItems, setPage } = usePagination(issues);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Support Tickets (Pylon)</CardTitle>
          {!isLoading && !error && (
            <span className="text-xs text-muted-foreground">
              {openCount} open / {issues.length} total
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[160px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : issues.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No tickets found</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Title</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Status</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Priority</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Created</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((issue) => (
                    <tr key={issue.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-2 truncate max-w-[280px]">{issue.title}</td>
                      <td className="py-1.5 px-2"><StateBadge state={issue.state} /></td>
                      <td className="py-1.5 px-2 capitalize">{issue.priority ?? "—"}</td>
                      <td className="py-1.5 px-2">{formatDate(issue.created_at)}</td>
                      <td className="py-1.5 px-2">{formatDate(issue.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
