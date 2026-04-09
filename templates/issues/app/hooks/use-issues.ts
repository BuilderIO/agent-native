import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import type { IssueListParams } from "@shared/types";

export function useIssues(params: IssueListParams) {
  const actionParams: Record<string, string> = {};
  if (params.view) actionParams.view = params.view;
  if (params.projectKey) actionParams.projectKey = params.projectKey;
  if (params.jql) actionParams.jql = params.jql;
  if (params.q) actionParams.q = params.q;
  if (params.nextPageToken) actionParams.nextPageToken = params.nextPageToken;
  if (params.maxResults !== undefined)
    actionParams.maxResults = String(params.maxResults);

  return useActionQuery<any>("list-issues", actionParams, {
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
  });
}

export function useIssue(issueKey: string | undefined) {
  return useActionQuery<any>(
    "get-issue",
    issueKey ? { key: issueKey } : undefined,
    {
      enabled: !!issueKey,
      staleTime: 30_000,
      retry: 2,
    },
  );
}

export function useCreateIssue() {
  return useActionMutation<any>("create-issue");
}

export function useUpdateIssue() {
  const mutation = useActionMutation<
    any,
    { key: string; fields?: Record<string, unknown> }
  >("update-issue");

  return {
    ...mutation,
    mutate: (
      vars: { issueKey: string; body: Record<string, unknown> },
      options?: Parameters<typeof mutation.mutate>[1],
    ) => mutation.mutate({ key: vars.issueKey, fields: vars.body }, options),
    mutateAsync: (
      vars: { issueKey: string; body: Record<string, unknown> },
      options?: Parameters<typeof mutation.mutateAsync>[1],
    ) =>
      mutation.mutateAsync({ key: vars.issueKey, fields: vars.body }, options),
  };
}
