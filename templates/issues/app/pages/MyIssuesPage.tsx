import { useState, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { Plus, Search } from "lucide-react";
import { useIssues } from "@/hooks/use-issues";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { IssueList } from "@/components/issues/IssueList";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";

interface MyIssuesPageProps {
  selectedIssueKey?: string;
}

export function MyIssuesPage({ selectedIssueKey }: MyIssuesPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useIssues({
    view: "my-issues",
    q: search || undefined,
  });

  const issues = data?.issues || [];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(search ? { q: search } : {});
  };

  useKeyboardShortcuts({
    onNext: () => setFocusedIndex((i) => Math.min(i + 1, issues.length - 1)),
    onPrev: () => setFocusedIndex((i) => Math.max(i - 1, 0)),
    onCreate: () => setCreateOpen(true),
    onSearch: () => document.getElementById("issue-search")?.focus(),
  });

  return (
    <div className="flex h-full">
      {/* Issue list */}
      <div
        className={`flex flex-col overflow-hidden ${selectedIssueKey ? "w-[400px] shrink-0 border-r border-border" : "flex-1"}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">My Issues</h1>
          <div className="flex-1" />
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="issue-search"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-8 w-48 rounded-md border border-border bg-background pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </form>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <span className="text-sm text-muted-foreground">Loading...</span>
            </div>
          ) : issues.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <span className="text-sm text-muted-foreground">
                {search
                  ? "No issues match your search"
                  : "No issues assigned to you"}
              </span>
            </div>
          ) : (
            <IssueList
              issues={issues}
              basePath="/my-issues"
              selectedIssueKey={selectedIssueKey}
              focusedIndex={focusedIndex}
            />
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          {data?.issues && `${data.issues.length} issues`}
        </div>
      </div>

      {/* Detail panel */}
      {selectedIssueKey && (
        <div className="flex-1 overflow-hidden">
          <IssueDetail issueKey={selectedIssueKey} closePath="/my-issues" />
        </div>
      )}

      <CreateIssueDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
