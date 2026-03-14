import { useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { QueryEditor } from "@/components/query/QueryEditor";
import { QueryResults } from "@/components/query/QueryResults";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { queryMetrics } from "@/lib/query-metrics";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

interface QueryHistoryEntry {
  sql: string;
  timestamp: number;
  rowCount: number;
}

const HISTORY_KEY = "query_explorer_history";

function loadHistory(): QueryHistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: QueryHistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 20)));
}

export default function QueryExplorer() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSql = searchParams.get("sql") || "";

  const [results, setResults] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [history, setHistory] = useState<QueryHistoryEntry[]>(loadHistory);

  const handleExecute = useCallback(
    async (sql: string) => {
      // Clear the URL param once a query is run
      if (searchParams.has("sql")) {
        setSearchParams({}, { replace: true });
      }

      setIsLoading(true);
      setError(undefined);
      setResults([]);

      const result = await queryMetrics(sql);

      setIsLoading(false);

      if (result.error) {
        setError(result.error);
        return;
      }

      setResults(result.rows);

      const entry: QueryHistoryEntry = {
        sql,
        timestamp: Date.now(),
        rowCount: result.rows.length,
      };
      const updated = [entry, ...history.filter((h) => h.sql !== sql)].slice(
        0,
        20
      );
      setHistory(updated);
      saveHistory(updated);
    },
    [history, searchParams, setSearchParams]
  );

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight">Query Explorer</h2>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base">SQL Query</CardTitle>
          </CardHeader>
          <CardContent>
            <QueryEditor
              onExecute={handleExecute}
              isLoading={isLoading}
              initialSql={initialSql}
            />
          </CardContent>
        </Card>

        <QueryResults data={results} isLoading={isLoading} error={error} />

        {history.length > 0 && (
          <Card className="bg-card border-border/50">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Query History</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearHistory}
                className="h-7 text-xs text-muted-foreground"
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {history.map((entry, i) => (
                  <button
                    key={i}
                    onClick={() => handleExecute(entry.sql)}
                    className="w-full text-left rounded-lg border border-border p-3 hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">
                        {entry.rowCount} rows &middot;{" "}
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm font-mono truncate">{entry.sql}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
