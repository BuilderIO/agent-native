import { useEffect, useState } from "react";
import { useActionQuery } from "@agent-native/core/client";
import { compositions } from "@/remotion/registry";
import {
  databaseRowToComposition,
  type DatabaseCompositionRow,
} from "@/lib/database-compositions";

function compositionChanged(
  existing: (typeof compositions)[number],
  next: (typeof compositions)[number],
) {
  return (
    existing.title !== next.title ||
    existing.description !== next.description ||
    existing.durationInFrames !== next.durationInFrames ||
    existing.fps !== next.fps ||
    existing.width !== next.width ||
    existing.height !== next.height ||
    JSON.stringify(existing.defaultProps) !==
      JSON.stringify(next.defaultProps) ||
    JSON.stringify(existing.tracks) !== JSON.stringify(next.tracks)
  );
}

export function useDatabaseCompositions() {
  const [version, setVersion] = useState(0);
  const query = useActionQuery<DatabaseCompositionRow[]>(
    "list-compositions",
    undefined,
    {
      retry: 1,
      staleTime: 2000,
    },
  );

  useEffect(() => {
    if (!query.data) return;

    let changed = false;
    for (const row of query.data) {
      const entry = databaseRowToComposition(row);
      const index = compositions.findIndex((c) => c.id === entry.id);
      if (index === -1) {
        compositions.push(entry);
        changed = true;
      } else if (compositionChanged(compositions[index], entry)) {
        const existing = compositions[index];
        compositions[index] = {
          ...entry,
          component: existing.component ?? entry.component,
        };
        changed = true;
      }
    }

    if (changed) setVersion((v) => v + 1);
  }, [query.data]);

  return {
    rows: query.data ?? [],
    version,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
