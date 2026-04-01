import { useState } from "react";
import { useSearchParams, useParams, useNavigate } from "react-router";
import { IconPlus, IconSearch, IconCircleDot } from "@tabler/icons-react";
import { useIssues } from "@/hooks/use-issues";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { IssueList } from "@/components/issues/IssueList";
import { IssueDetail } from "@/components/issues/IssueDetail";
import { CreateIssueDialog } from "@/components/issues/CreateIssueDialog";

interface MyIssuesPageProps {
  selectedIssueKey?: string;
}

export function MyIssuesPage({ selectedIssueKey: propKey }: MyIssuesPageProps) {
  const params = useParams();
  const navigate = useNavigate();
  const selectedIssueKey = propKey || params.issueKey;
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get("q") || "");
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, error } = useIssues({
    view: "my-issues",
    q: search || undefined,
  });

  const issues = data?.issues || [];
  const isAuthError =
    error && "status" in error && (error as any).status === 401;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(search ? { q: search } : {});
  };

  useKeyboardShortcuts({
    onNext: () => setFocusedIndex((i) => Math.min(i + 1, issues.length - 1)),
    onPrev: () => setFocusedIndex((i) => Math.max(i - 1, 0)),
    onCreate: () => setCreateOpen(true),
    onClose: () => {
      if (selectedIssueKey) navigate("/my-issues");
    },
    onSearch: () => document.getElementById("issue-search")?.focus(),
  });

  return (
    <div className="flex h-full">
      {/* Issue list — hidden when detail is open to give it full width */}
      <div
        className={`flex flex-col overflow-hidden ${selectedIssueKey ? "hidden" : "flex-1"}`}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <h1 className="text-sm font-semibold text-foreground">My Issues</h1>
          <div className="flex-1" />
          <form onSubmit={handleSearch} className="relative">
            <IconSearch className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
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
            <IconPlus className="h-3.5 w-3.5" />
            New
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {isAuthError ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="mb-3 text-2xl">🔑</div>
              <p className="text-sm font-medium text-foreground">
                Jira connection expired
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                Your Atlassian session has expired. Reconnect to continue
                viewing issues.
              </p>
              <a
                href="/settings"
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                Reconnect in Settings
              </a>
            </div>
          ) : isLoading ? (
            <div className="space-y-1 p-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                  <div className="h-3 flex-1 rounded bg-muted animate-pulse" />
                  <div className="h-5 w-12 rounded-full bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <IconCircleDot className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">No issues found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                {search
                  ? "Try a different search"
                  : "Issues assigned to you will appear here"}
              </p>
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
          {data?.issues &&
            `${data.issues.length}${data.nextPageToken ? "+" : ""} issue${data.issues.length !== 1 ? "s" : ""}`}
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
