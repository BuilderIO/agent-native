import { useState } from "react";
import { Copy, Check, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { KeywordSuggestion } from "@shared/api";

interface KeywordResultsProps {
  suggestions: KeywordSuggestion[];
  source: "autocomplete" | "dataforseo";
  query: string;
}

type SortField = "keyword" | "volume" | "cpc" | "competition";
type SortDir = "asc" | "desc";

export function KeywordResults({ suggestions, source, query }: KeywordResultsProps) {
  const [sortField, setSortField] = useState<SortField>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);

  const hasMetrics = source === "dataforseo";

  const sorted = [...suggestions].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    if (sortField === "keyword") {
      return a.keyword.localeCompare(b.keyword) * dir;
    }
    const aVal = a[sortField] ?? -1;
    const bVal = b[sortField] ?? -1;
    return (aVal - bVal) * dir;
  });

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const toggleSelect = (keyword: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === sorted.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(sorted.map((s) => s.keyword)));
    }
  };

  const copySelected = async () => {
    const keywords = selected.size > 0
      ? sorted.filter((s) => selected.has(s.keyword))
      : sorted;
    const text = keywords.map((k) => k.keyword).join("\n");
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="opacity-30" />;
    return sortDir === "asc"
      ? <ArrowUp size={12} className="text-primary" />
      : <ArrowDown size={12} className="text-primary" />;
  };

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">No suggestions found for "{query}"</p>
        <p className="text-xs mt-1">Try a different keyword or broader term</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {sorted.length} keyword{sorted.length !== 1 ? "s" : ""} found
          <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-muted">
            {source === "dataforseo" ? "DataForSEO" : "Google Suggest"}
          </span>
        </p>
        <button
          onClick={copySelected}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "Copied!" : selected.size > 0 ? `Copy ${selected.size}` : "Copy all"}
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="w-8 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.size === sorted.length && sorted.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded border-border accent-primary"
                />
              </th>
              <th className="text-left px-3 py-2.5">
                <button
                  onClick={() => toggleSort("keyword")}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Keyword <SortIcon field="keyword" />
                </button>
              </th>
              {hasMetrics && (
                <>
                  <th className="text-right px-3 py-2.5 w-24">
                    <button
                      onClick={() => toggleSort("volume")}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto"
                    >
                      Volume <SortIcon field="volume" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2.5 w-28">
                    <button
                      onClick={() => toggleSort("competition")}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto"
                    >
                      Competition <SortIcon field="competition" />
                    </button>
                  </th>
                  <th className="text-right px-3 py-2.5 w-20">
                    <button
                      onClick={() => toggleSort("cpc")}
                      className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground ml-auto"
                    >
                      CPC <SortIcon field="cpc" />
                    </button>
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr
                key={s.keyword}
                className={`border-b border-border last:border-0 hover:bg-muted/30 transition-colors ${
                  selected.has(s.keyword) ? "bg-muted/40" : ""
                }`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(s.keyword)}
                    onChange={() => toggleSelect(s.keyword)}
                    className="rounded border-border accent-primary"
                  />
                </td>
                <td className="px-3 py-2 text-foreground">{s.keyword}</td>
                {hasMetrics && (
                  <>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                      {formatVolume(s.volume)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <CompetitionBadge value={s.competition} />
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground tabular-nums">
                      {s.cpc != null ? `$${s.cpc.toFixed(2)}` : "—"}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatVolume(vol?: number): string {
  if (vol == null) return "—";
  if (vol >= 1_000_000) return `${(vol / 1_000_000).toFixed(1)}M`;
  if (vol >= 1_000) return `${(vol / 1_000).toFixed(1)}K`;
  return vol.toString();
}

/** DataForSEO competition_index is 0–100 scale */
function CompetitionBadge({ value }: { value?: number }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;

  let label: string;
  let color: string;
  if (value <= 33) {
    label = "Low";
    color = "text-green-500 bg-green-500/10";
  } else if (value <= 66) {
    label = "Medium";
    color = "text-yellow-500 bg-yellow-500/10";
  } else {
    label = "High";
    color = "text-red-400 bg-red-400/10";
  }

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded ${color}`}>
      {value} <span className="opacity-70">{label}</span>
    </span>
  );
}
