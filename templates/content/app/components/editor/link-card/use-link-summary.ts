import { callAction, useSession } from "@agent-native/core/client/hooks";
import type { LinkSummary } from "@agent-native/core/shared";
import { useQuery } from "@tanstack/react-query";

const MAX_BATCH = 60;
const BATCH_WINDOW_MS = 20;
const SUMMARY_STALE_MS = 60_000;

/** The signed-in reader a card asks as: their email and current workspace. */
export interface LinkSummaryReader {
  email: string;
  orgId: string | null;
}

type Waiter = {
  resolve: (summary: LinkSummary) => void;
  reject: (error: unknown) => void;
};

type ReaderQueue = {
  reader: LinkSummaryReader;
  links: Map<string, Waiter[]>;
};

// One queue per reader, so a request never answers a card queued by someone
// else, even when the tab's session changes before the queue is sent.
let queued = new Map<string, ReaderQueue>();
let timer: ReturnType<typeof setTimeout> | null = null;

function readerKey(reader: LinkSummaryReader): string {
  return `${reader.email}\n${reader.orgId ?? ""}`;
}

function sameEmail(answeredAs: string | null | undefined, email: string) {
  return answeredAs?.trim().toLowerCase() === email.trim().toLowerCase();
}

async function askChunk(
  reader: LinkSummaryReader,
  links: Map<string, Waiter[]>,
  chunk: string[],
) {
  try {
    const result = (await callAction("read-link-summaries", {
      links: chunk,
    })) as {
      reader?: string | null;
      summaries: LinkSummary[];
    };
    // The server answers as whoever is signed in when the request arrives.
    // Answers for anyone but the reader who queued these cards are dropped,
    // never cached under this reader.
    if (!sameEmail(result.reader, reader.email)) {
      throw new Error("Link summaries were answered for another reader");
    }
    const answers = result.summaries[Symbol.iterator]();
    for (const link of chunk) {
      const answer = answers.next();
      for (const waiter of links.get(link) ?? []) {
        if (answer.done) waiter.reject(new Error("Missing link summary"));
        else waiter.resolve(answer.value);
      }
    }
  } catch (error) {
    for (const link of chunk) {
      for (const waiter of links.get(link) ?? []) waiter.reject(error);
    }
  }
}

function flush() {
  timer = null;
  const batches = queued;
  queued = new Map();
  // Every chunk is asked at once, so a slow app delays each card by one
  // request's timeout at most, however many cards the page holds.
  for (const { reader, links } of batches.values()) {
    const all = [...links.keys()];
    for (let start = 0; start < all.length; start += MAX_BATCH) {
      void askChunk(reader, links, all.slice(start, start + MAX_BATCH));
    }
  }
}

export function requestLinkSummary(
  reader: LinkSummaryReader,
  link: string,
): Promise<LinkSummary> {
  return new Promise((resolve, reject) => {
    const key = readerKey(reader);
    const queue = queued.get(key) ?? { reader, links: new Map() };
    queue.links.set(link, [
      ...(queue.links.get(link) ?? []),
      { resolve, reject },
    ]);
    queued.set(key, queue);
    timer ??= setTimeout(flush, BATCH_WINDOW_MS);
  });
}

export type LinkSummaryState =
  | { state: "loading" }
  | { state: "available"; title: string }
  | { state: "untitled" };

export function useLinkSummary(link: string): LinkSummaryState {
  const { session, status } = useSession();
  const reader: LinkSummaryReader | null =
    status === "authenticated" && session?.email
      ? { email: session.email, orgId: session.orgId ?? null }
      : null;
  const query = useQuery({
    queryKey: ["link-summary", reader?.email, reader?.orgId, link],
    queryFn: () =>
      reader
        ? requestLinkSummary(reader, link)
        : Promise.reject(new Error("No signed-in reader")),
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
