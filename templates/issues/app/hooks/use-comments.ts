import { useActionQuery, useActionMutation } from "@agent-native/core/client";

export function useComments(issueKey: string | undefined) {
  return useActionQuery<any>(
    "get-comments",
    issueKey ? { key: issueKey } : undefined,
    {
      enabled: !!issueKey,
      staleTime: 30_000,
    },
  );
}

export function useAddComment() {
  const mutation = useActionMutation<any, { key: string; body: string }>(
    "add-comment",
  );

  return {
    ...mutation,
    mutate: (
      vars: { issueKey: string; body: string },
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ key: vars.issueKey, body: vars.body }, options),
    mutateAsync: (
      vars: { issueKey: string; body: string },
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) => mutation.mutateAsync({ key: vars.issueKey, body: vars.body }, options),
  };
}

export function useEditComment() {
  const mutation = useActionMutation<
    any,
    { key: string; commentId: string; body: string }
  >("update-comment");

  return {
    ...mutation,
    mutate: (
      vars: { issueKey: string; commentId: string; body: string },
      options?: Parameters<typeof mutation.mutate>[1],
    ) =>
      mutation.mutate(
        { key: vars.issueKey, commentId: vars.commentId, body: vars.body },
        options,
      ),
    mutateAsync: (
      vars: { issueKey: string; commentId: string; body: string },
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) =>
      mutation.mutateAsync(
        { key: vars.issueKey, commentId: vars.commentId, body: vars.body },
        options,
      ),
  };
}

export function useDeleteComment() {
  const mutation = useActionMutation<any, { key: string; commentId: string }>(
    "delete-comment",
  );

  return {
    ...mutation,
    mutate: (
      vars: { issueKey: string; commentId: string },
      options?: Parameters<typeof mutation.mutate>[1],
    ) =>
      mutation.mutate(
        { key: vars.issueKey, commentId: vars.commentId },
        options,
      ),
    mutateAsync: (
      vars: { issueKey: string; commentId: string },
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) =>
      mutation.mutateAsync(
        { key: vars.issueKey, commentId: vars.commentId },
        options,
      ),
  };
}
