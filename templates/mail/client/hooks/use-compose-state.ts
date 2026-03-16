import { useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ComposeState } from "@shared/types";

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    if (res.status === 404) return undefined as T;
    throw new Error(`Request failed (${res.status})`);
  }
  return res.json();
}

export function useComposeState() {
  const qc = useQueryClient();
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const query = useQuery<ComposeState | undefined>({
    queryKey: ["compose-state"],
    queryFn: () =>
      apiFetch<ComposeState | undefined>("/api/application-state/compose"),
    staleTime: 5_000,
  });

  const putMutation = useMutation({
    mutationFn: (state: ComposeState) =>
      apiFetch("/api/application-state/compose", {
        method: "PUT",
        body: JSON.stringify(state),
      }),
  });

  const update = useCallback(
    (partial: Partial<ComposeState>) => {
      dirtyRef.current = true;

      // Optimistically update the cache
      qc.setQueryData<ComposeState | undefined>(["compose-state"], (old) => {
        if (!old) return undefined;
        return { ...old, ...partial };
      });

      // Debounced write to server
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const current = qc.getQueryData<ComposeState>(["compose-state"]);
        if (current) {
          putMutation.mutate(current, {
            onSettled: () => {
              dirtyRef.current = false;
            },
          });
        }
      }, 300);
    },
    [qc, putMutation],
  );

  const open = useCallback(
    (state: ComposeState) => {
      // Write to server immediately (not debounced)
      putMutation.mutate(state, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: ["compose-state"] });
        },
      });
    },
    [qc, putMutation],
  );

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/application-state/compose", { method: "DELETE" }),
    onSuccess: () => {
      qc.setQueryData(["compose-state"], undefined);
      qc.invalidateQueries({ queryKey: ["compose-state"] });
    },
  });

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    dirtyRef.current = false;
    deleteMutation.mutate();
  }, [deleteMutation]);

  // Flush: immediately write current state (for Generate button)
  const flush = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const current = qc.getQueryData<ComposeState>(["compose-state"]);
    if (current) {
      dirtyRef.current = false;
      return putMutation.mutateAsync(current);
    }
  }, [qc, putMutation]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    isDirty: dirtyRef.current,
    open,
    update,
    clear,
    flush,
  };
}
