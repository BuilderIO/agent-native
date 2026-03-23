import { useState } from "react";
import { useJiraBoards, useJiraSprints, type JiraSprint } from "./hooks";

export function JiraSprintView() {
  const { data: boards, isLoading: boardsLoading } = useJiraBoards();
  const [selectedBoard, setSelectedBoard] = useState<number | null>(null);
  const { data: sprints, isLoading: sprintsLoading } =
    useJiraSprints(selectedBoard);

  if (boardsLoading) {
    return (
      <div className="text-sm text-muted-foreground animate-pulse py-8 text-center">
        Loading boards...
      </div>
    );
  }

  if (!boards || boards.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-8">
        No Agile boards found
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground">Board:</label>
        <select
          value={selectedBoard ?? ""}
          onChange={(e) =>
            setSelectedBoard(e.target.value ? Number(e.target.value) : null)
          }
          className="px-3 py-1.5 rounded-md border border-border bg-card text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">Select a board</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {selectedBoard && sprintsLoading && (
        <div className="text-sm text-muted-foreground animate-pulse py-8 text-center">
          Loading sprints...
        </div>
      )}

      {sprints && sprints.length > 0 && (
        <div className="space-y-3">
          {groupSprints(sprints).map(({ label, items }) => (
            <div key={label}>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {label}
              </h3>
              <div className="space-y-2">
                {items.map((sprint) => (
                  <SprintCard key={sprint.id} sprint={sprint} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {sprints && sprints.length === 0 && (
        <div className="text-sm text-muted-foreground text-center py-6">
          No sprints found for this board
        </div>
      )}
    </div>
  );
}

function SprintCard({ sprint }: { sprint: JiraSprint }) {
  const stateColor =
    sprint.state === "active"
      ? "bg-green-500/20 text-green-400"
      : sprint.state === "future"
        ? "bg-blue-500/20 text-blue-400"
        : "bg-muted text-muted-foreground";

  const startDate = sprint.startDate
    ? new Date(sprint.startDate).toLocaleDateString()
    : null;
  const endDate = sprint.endDate
    ? new Date(sprint.endDate).toLocaleDateString()
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {sprint.name}
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${stateColor}`}
          >
            {sprint.state}
          </span>
        </div>
        {startDate && endDate && (
          <span className="text-xs text-muted-foreground">
            {startDate} — {endDate}
          </span>
        )}
      </div>
      {sprint.goal && (
        <p className="text-xs text-muted-foreground mt-1">{sprint.goal}</p>
      )}
    </div>
  );
}

function groupSprints(sprints: JiraSprint[]) {
  const groups: { label: string; items: JiraSprint[] }[] = [];
  const active = sprints.filter((s) => s.state === "active");
  const future = sprints.filter((s) => s.state === "future");
  const closed = sprints
    .filter((s) => s.state === "closed")
    .sort(
      (a, b) =>
        new Date(b.completeDate ?? 0).getTime() -
        new Date(a.completeDate ?? 0).getTime(),
    )
    .slice(0, 5);

  if (active.length) groups.push({ label: "Active", items: active });
  if (future.length) groups.push({ label: "Future", items: future });
  if (closed.length) groups.push({ label: "Recently Closed", items: closed });
  return groups;
}
