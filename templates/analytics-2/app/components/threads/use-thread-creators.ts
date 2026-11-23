import {
  callAction,
  currentActionQueryCacheBinding,
  runActionQueryRead,
  useActionQueryCanFetch,
} from "@agent-native/core/client/hooks";
import { useOrg } from "@agent-native/core/client/org";
import { useSession } from "@agent-native/core/client/use-session";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

export const CREATOR_BATCH_SIZE = 100;

type Creator = {
  email: string;
  name: string | null;
  imageUrl: string | null;
};

export function useThreadCreators(ownerEmails: readonly string[]) {
  const { session, status } = useSession();
  const org = useOrg();
  const actor =
    status === "authenticated" ? session?.email?.toLowerCase() : undefined;
  const orgId = org.data?.orgId;
  const binding = currentActionQueryCacheBinding();
  const scopeKey = JSON.stringify([actor, orgId]);
  const lifetime = useRef({ scopeKey, binding, active: true });
  if (
    lifetime.current.scopeKey !== scopeKey ||
    lifetime.current.binding !== binding
  ) {
    lifetime.current.active = false;
    lifetime.current = { scopeKey, binding, active: true };
  }
  const owner = lifetime.current;
  useEffect(() => {
    owner.active = true;
    return () => {
      owner.active = false;
    };
  }, [owner]);
  const isActive = () =>
    owner.active &&
    lifetime.current === owner &&
    currentActionQueryCacheBinding() === owner.binding;
  const canFetch = useActionQueryCanFetch();
  const batches: string[][] = [];
  for (let i = 0; i < ownerEmails.length; i += CREATOR_BATCH_SIZE)
    batches.push(ownerEmails.slice(i, i + CREATOR_BATCH_SIZE));
  const queries = useQueries({
    queries: batches.map((batch) => {
      const params = { ownerEmails: batch };
      const queryKey = ["action", "list-thread-creators", params, actor, orgId];
      return {
        queryKey,
        enabled: Boolean(actor && orgId) && canFetch,
        queryFn: async ({
          signal,
          client,
        }: {
          signal: AbortSignal;
          client: import("@tanstack/react-query").QueryClient;
        }) => {
          signal.throwIfAborted();
          if (!isActive()) throw new Error("Creator read was cancelled");
          const result = await runActionQueryRead(
            client,
            queryKey,
            signal,
            (onResponse) =>
              callAction<{ creators: Creator[] }>(
                "list-thread-creators",
                params,
                { method: "GET", signal, onResponse },
              ),
          );
          signal.throwIfAborted();
          if (!isActive()) throw new Error("Creator read was cancelled");
          return result;
        },
      };
    }),
  });
  const creators = new Map<string, Creator>();
  for (const query of queries)
    for (const creator of query.data?.creators ?? [])
      creators.set(creator.email, creator);
  return {
    creators,
    isLoading: queries.some((query) => query.isLoading),
    error: queries.find((query) => query.error)?.error ?? null,
  };
}
