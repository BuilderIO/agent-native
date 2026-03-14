import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getIdToken } from "@/lib/auth";
import { TablePagination, usePagination } from "./TablePagination";

interface GongCall {
  id: string;
  title?: string;
  started: string;
  duration?: number;
  parties?: { name: string; emailAddress?: string; affiliation?: string }[];
}

interface GongCallsProps {
  companyName: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDuration(seconds?: number): string {
  if (!seconds) return "—";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function getExternalParties(parties?: GongCall["parties"]): string {
  if (!parties?.length) return "—";
  return parties
    .filter((p) => p.affiliation?.toLowerCase() === "external")
    .map((p) => p.name)
    .join(", ") || "—";
}

function getInternalParties(parties?: GongCall["parties"]): string {
  if (!parties?.length) return "—";
  return parties
    .filter((p) => p.affiliation?.toLowerCase() === "internal")
    .map((p) => p.name)
    .join(", ") || "—";
}

export function GongCalls({ companyName }: GongCallsProps) {
  const [calls, setCalls] = useState<GongCall[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchCalls() {
      setIsLoading(true);
      setError(null);
      try {
        const token = await getIdToken();
        const res = await fetch(
          `/api/gong/calls?company=${encodeURIComponent(companyName)}&days=90`,
          { headers: token ? { Authorization: `Bearer ${token}` } : {} }
        );
        if (!res.ok) {
          if (res.status === 500) {
            const body = await res.json().catch(() => null);
            if (body?.error?.includes("401") || body?.error?.includes("credentials")) {
              throw new Error("Gong credentials are invalid or expired. Please update GONG_ACCESS_KEY and GONG_ACCESS_SECRET.");
            }
          }
          throw new Error(`Failed to fetch calls (${res.status})`);
        }
        const data = await res.json();

        if (!cancelled) {
          // Sort by most recent first
          const sorted = (data.calls ?? []).sort(
            (a: GongCall, b: GongCall) => new Date(b.started).getTime() - new Date(a.started).getTime()
          );
          setCalls(sorted);
          setIsLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message);
          setIsLoading(false);
        }
      }
    }

    fetchCalls();
    return () => { cancelled = true; };
  }, [companyName]);

  const { page, totalPages, pageItems, setPage } = usePagination(calls);

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Recent Calls (Gong)</CardTitle>
          {!isLoading && !error && (
            <span className="text-xs text-muted-foreground">
              {calls.length} call{calls.length !== 1 ? "s" : ""} in last 90d
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[160px] w-full" />
        ) : error ? (
          <p className="text-sm text-red-400 py-4 text-center">{error}</p>
        ) : calls.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No calls found in the last 90 days</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Title</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Date</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">Duration</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">External</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-left">Internal</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((call) => (
                    <tr key={call.id} className="border-b border-border/30 hover:bg-muted/30">
                      <td className="py-1.5 px-2 truncate max-w-[240px]">{call.title ?? "Untitled"}</td>
                      <td className="py-1.5 px-2">{formatDate(call.started)}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums">{formatDuration(call.duration)}</td>
                      <td className="py-1.5 px-2 truncate max-w-[180px]">{getExternalParties(call.parties)}</td>
                      <td className="py-1.5 px-2 truncate max-w-[180px]">{getInternalParties(call.parties)}</td>
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
