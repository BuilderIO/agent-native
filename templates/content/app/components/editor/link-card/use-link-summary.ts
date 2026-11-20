import { callAction, useSession } from "@agent-native/core/client/hooks";
import type { LinkSummary } from "@agent-native/core/shared";
import { useQuery } from "@tanstack/react-query";

const MAX_BATCH = 60;
const BATCH_WINDOW_MS = 20;
const SUMMARY_STALE_MS = 60_000;

type Waiter = {
  resolve: (summary: LinkSummary) => void;
  reject: (error: unknown) => void;
};

let queued = new Map<string, Waiter[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = queued;
  queued = new Map();
  const links = [...batch.keys()];
  for (let start = 0; start < links.length; start += MAX_BATCH) {
    const chunk = links.slice(start, start + MAX_BATCH);
    try {
      const result = (await callAction("read-link-summaries", {
        links: chunk,
      })) as { summaries: LinkSummary[] };
      const answers = result.summaries[Symbol.iterator]();
      for (const link of chunk) {
        const answer = answers.next();
        for (const waiter of batch.get(link) ?? []) {
          if (answer.done) waiter.reject(new Error("Missing link summary"));
          else waiter.resolve(answer.value);
        }
      }
    } catch (error) {
      for (const link of chunk) {
        for (const waiter of batch.get(link) ?? []) waiter.reject(error);
      }
    }
  }
}

function requestLinkSummary(link: string): Promise<LinkSummary> {
  return new Promise((resolve, reject) => {
    queued.set(link, [...(queued.get(link) ?? []), { resolve, reject }]);
    timer ??= setTimeout(() => void flush(), BATCH_WINDOW_MS);
  });
}

export type LinkSummaryState =
  | { state: "loading" }
  | { state: "available"; title: string }
  | { state: "untitled" };

export function useLinkSummary(link: string): LinkSummaryState {
  const { session, status } = useSession();
  const reader = status === "authenticated" ? (session?.email ?? null) : null;
  const query = useQuery({
    queryKey: ["link-summary", reader, link],
    queryFn: () => requestLinkSummary(link),
    enabled: reader !== null,
    staleTime: SUMMARY_STALE_MS,
    retry: false,
    refetchOnWindowFocus: false,
  });
  if (reader === null) {
    return status === "loading" ? { state: "loading" } : { state: "untitled" };
  }
  if (query.isPending) return { state: "loading" };
  if (query.data?.status === "available") {
    return { state: "available", title: query.data.title };
  }
  return { state: "untitled" };
}
