import { callAction } from "@agent-native/core/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type Snippet = {
  id: string;
  ownerEmail: string;
  name: string;
  body: string;
  createdAt: number;
  updatedAt: number;
};

type SnippetsListResponse = {
  ok: true;
  snippets: Snippet[];
};

type SnippetMutationResponse = {
  ok: true;
  snippet: Snippet;
};

const SNIPPETS_KEY = ["snippets"];

export function useSnippets() {
  return useQuery<SnippetsListResponse>({
    queryKey: SNIPPETS_KEY,
    queryFn: () => callAction("manage-snippets", { operation: "list" }),
    staleTime: 30_000,
  });
}

export function useCreateSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; body: string }) =>
      callAction<SnippetMutationResponse>("manage-snippets", {
        ...input,
        operation: "create",
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SNIPPETS_KEY }),
  });
}

export function useUpdateSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; name?: string; body?: string }) =>
      callAction<SnippetMutationResponse>("manage-snippets", {
        ...input,
        operation: "update",
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: SNIPPETS_KEY });
      const previous =
        queryClient.getQueryData<SnippetsListResponse>(SNIPPETS_KEY);
      if (previous) {
        queryClient.setQueryData<SnippetsListResponse>(SNIPPETS_KEY, {
          ...previous,
          snippets: previous.snippets.map((snippet) =>
            snippet.id === input.id ? { ...snippet, ...input } : snippet,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(SNIPPETS_KEY, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SNIPPETS_KEY }),
  });
}

export function useDeleteSnippet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      callAction<{ ok: true; id: string }>("manage-snippets", {
        id,
        operation: "delete",
      }),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: SNIPPETS_KEY });
      const previous =
        queryClient.getQueryData<SnippetsListResponse>(SNIPPETS_KEY);
      if (previous) {
        queryClient.setQueryData<SnippetsListResponse>(SNIPPETS_KEY, {
          ...previous,
          snippets: previous.snippets.filter((snippet) => snippet.id !== id),
        });
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(SNIPPETS_KEY, context.previous);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SNIPPETS_KEY }),
  });
}
