import { useActionQuery } from "@agent-native/core/client/hooks";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  ProjectAccessCell,
  type ProjectAccessSummary,
} from "./ProjectAccessCell";

type AccessState = {
  status: "loading" | "error" | "ready";
  summary?: ProjectAccessSummary | undefined;
};
const ProjectAccessContext = createContext<ReadonlyMap<string, AccessState>>(
  new Map(),
);

export function ProjectAccessProvider({
  items,
  enabled,
  children,
}: {
  items: readonly {
    id: string;
    accessSummary?: ProjectAccessSummary | undefined;
  }[];
  enabled: boolean;
  children: ReactNode;
}) {
  const ids = items
    .filter((item) => !item.accessSummary)
    .map((item) => item.id);
  if (!enabled || !ids.length) return children;
  return <ProjectAccessChunk ids={ids}>{children}</ProjectAccessChunk>;
}

function ProjectAccessChunk({
  ids,
  children,
}: {
  ids: readonly string[];
  children: ReactNode;
}) {
  const parent = useContext(ProjectAccessContext);
  const batch = useMemo(() => ids.slice(0, 100), [ids]);
  const remaining = useMemo(() => ids.slice(100), [ids]);
  const query = useActionQuery<{
    summaries: (ProjectAccessSummary & { id: string })[];
  }>("list-dashboard-access-summaries", { ids: batch });
  const states = useMemo(() => {
    const result = new Map(parent);
    const summaries = new Map(
      (query.data?.summaries ?? []).map((entry) => [entry.id, entry]),
    );
    for (const id of batch) {
      const summary = summaries.get(id);
      result.set(
        id,
        query.isPending
          ? { status: "loading" }
          : query.error || !summary
            ? { status: "error" }
            : { status: "ready", summary },
      );
    }
    return result;
  }, [parent, batch, query.data, query.isPending, query.error]);
  return (
    <ProjectAccessContext.Provider value={states}>
      {remaining.length ? (
        <ProjectAccessChunk ids={remaining}>{children}</ProjectAccessChunk>
      ) : (
        children
      )}
    </ProjectAccessContext.Provider>
  );
}

export function ProjectAccessValue({
  id,
  summary,
  field,
  workspaceName,
}: {
  id: string;
  summary?: ProjectAccessSummary | undefined;
  field: "yourAccess" | "sharedWith";
  workspaceName?: string | undefined;
}) {
  const states = useContext(ProjectAccessContext);
  const state: AccessState = summary
    ? { status: "ready", summary }
    : (states.get(id) ?? { status: "error" });
  return (
    <ProjectAccessCell
      summary={state.summary}
      status={state.status}
      field={field}
      workspaceName={workspaceName}
    />
  );
}
