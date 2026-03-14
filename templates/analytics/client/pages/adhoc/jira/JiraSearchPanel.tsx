import { useState, useCallback } from "react";
import { Search } from "lucide-react";
import { useJiraSearch, type JiraIssue } from "./hooks";
import { JiraIssueDetail } from "./JiraIssueDetail";

interface Props {
  defaultProject?: string;
}

const EXAMPLE_QUERIES = [
  'project = ENG AND status = "In Progress"',
  "assignee = currentUser() AND resolution = Unresolved",
  'priority = High AND statusCategory != "Done"',
  "created >= -7d ORDER BY created DESC",
];

export function JiraSearchPanel({ defaultProject }: Props) {
  const [jql, setJql] = useState(
    defaultProject ? `project = ${defaultProject} ORDER BY created DESC` : "",
  );
  const [submittedJql, setSubmittedJql] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const { data, isLoading, error } = useJiraSearch(submittedJql);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (jql.trim()) setSubmittedJql(jql.trim());
    },
    [jql],
  );

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={jql}
            onChange={(e) => setJql(e.target.value)}
            placeholder="Enter JQL query..."
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Search
        </button>
      </form>

      {!submittedJql && (
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium">Example queries:</p>
          {EXAMPLE_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => {
                setJql(q);
                setSubmittedJql(q);
              }}
              className="block text-left text-primary/80 hover:text-primary hover:underline"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {(error as Error).message}
        </div>
      )}

      {isLoading && (
        <div className="text-sm text-muted-foreground animate-pulse py-8 text-center">
          Searching...
        </div>
      )}

      {data && (
        <div>
          <div className="text-xs text-muted-foreground mb-2">
            {data.total} result{data.total !== 1 ? "s" : ""} found
          </div>
          <IssuesTable
            issues={data.issues}
            expandedKey={expandedKey}
            onToggle={(key) => setExpandedKey(expandedKey === key ? null : key)}
          />
        </div>
      )}
    </div>
  );
}

function IssuesTable({
  issues,
  expandedKey,
  onToggle,
}: {
  issues: JiraIssue[];
  expandedKey: string | null;
  onToggle: (key: string) => void;
}) {
  if (issues.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        No issues found
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
              Key
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">
              Summary
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
              Status
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden md:table-cell">
              Priority
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">
              Assignee
            </th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden lg:table-cell">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <IssueRow
              key={issue.key}
              issue={issue}
              expanded={expandedKey === issue.key}
              onToggle={() => onToggle(issue.key)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IssueRow({
  issue,
  expanded,
  onToggle,
}: {
  issue: JiraIssue;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusColor = getStatusColor(issue.fields.status.statusCategory.key);

  return (
    <>
      <tr
        className="border-b border-border hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-mono text-xs text-primary">
          {issue.key}
        </td>
        <td className="px-3 py-2 text-foreground max-w-md truncate">
          {issue.fields.summary}
        </td>
        <td className="px-3 py-2 hidden md:table-cell">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}
          >
            {issue.fields.status.name}
          </span>
        </td>
        <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">
          {issue.fields.priority?.name ?? "-"}
        </td>
        <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">
          {issue.fields.assignee?.displayName ?? "Unassigned"}
        </td>
        <td className="px-3 py-2 text-muted-foreground text-xs hidden lg:table-cell">
          {new Date(issue.fields.created).toLocaleDateString()}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="p-0">
            <JiraIssueDetail issue={issue} />
          </td>
        </tr>
      )}
    </>
  );
}

function getStatusColor(categoryKey: string): string {
  switch (categoryKey) {
    case "new":
      return "bg-blue-500/20 text-blue-400";
    case "indeterminate":
      return "bg-yellow-500/20 text-yellow-400";
    case "done":
      return "bg-green-500/20 text-green-400";
    default:
      return "bg-muted text-muted-foreground";
  }
}
