import type { JiraIssue } from "./hooks";

interface Props {
  issue: JiraIssue;
}

export function JiraIssueDetail({ issue }: Props) {
  const f = issue.fields;
  const statusColor = getStatusColor(f.status.statusCategory.key);

  return (
    <div className="bg-muted/20 border-t border-border px-4 py-3 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {issue.key}: {f.summary}
          </h4>
          <div className="flex flex-wrap gap-2 mt-1.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusColor}`}
            >
              {f.status.name}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
              {f.issuetype?.name}
            </span>
            {f.priority && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                {f.priority.name}
              </span>
            )}
            {f.labels?.map((label) => (
              <span
                key={label}
                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <DetailField
          label="Assignee"
          value={f.assignee?.displayName ?? "Unassigned"}
        />
        <DetailField
          label="Reporter"
          value={f.reporter?.displayName ?? "Unknown"}
        />
        <DetailField
          label="Created"
          value={new Date(f.created).toLocaleDateString()}
        />
        <DetailField
          label="Updated"
          value={new Date(f.updated).toLocaleDateString()}
        />
        {f.resolutiondate && (
          <DetailField
            label="Resolved"
            value={new Date(f.resolutiondate).toLocaleDateString()}
          />
        )}
        <DetailField
          label="Project"
          value={`${f.project.name} (${f.project.key})`}
        />
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="text-foreground font-medium mt-0.5">{value}</div>
    </div>
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
