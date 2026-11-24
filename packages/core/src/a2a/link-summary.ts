import { mapWithConcurrency } from "../resources/actions/map-with-concurrency.js";
import {
  LINK_SUMMARY_KINDS,
  LINK_SUMMARY_TITLE_CHARS,
  UNAVAILABLE_LINK_SUMMARY,
  linkSummaryItemFromPath,
  linkSummaryResultSchema,
  parseLinkSummaryUrl,
  pathBelowAppBase,
  type LinkSummary,
  type LinkSummaryApp,
  type LinkSummaryItem,
} from "../shared/link-summary.js";
import { resolveA2ACallerAuth } from "./caller-auth.js";
import { invokeAgentAction } from "./invoke.js";

export const READ_LINK_SUMMARY_ACTION = "read-link-summary";

/** A card waits this long for the owning app before it shows no title. */
export const LINK_SUMMARY_TIMEOUT_MS = 5000;

/** How many of a request's items the owning app reads at a time. */
export const LINK_SUMMARY_READ_CONCURRENCY = 4;

function unavailable(count: number): LinkSummary[] {
  return Array.from({ length: count }, () => UNAVAILABLE_LINK_SUMMARY);
}

/**
 * Asks the app that owns `links` what each one is, as the signed-in reader.
 * Returns one summary per link, in order. A signed-out reader makes no call;
 * a refusal, timeout, or answer that doesn't fit the contract makes every
 * link `unavailable`, never an error.
 */
export async function readPeerLinkSummaries(options: {
  app: LinkSummaryApp;
  links: readonly string[];
  selfAppId: string;
  target?: string;
  timeoutMs?: number;
}): Promise<LinkSummary[]> {
  const { app, links, selfAppId } = options;
  if (links.length === 0) return [];
  const timeoutMs = options.timeoutMs ?? LINK_SUMMARY_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const askAsReader = async () => {
    const auth = await resolveA2ACallerAuth();
    if (!auth.userEmail) return "signed-out" as const;
    return invokeAgentAction({
      target: options.target ?? app,
      selfAppId,
      action: READ_LINK_SUMMARY_ACTION,
      input: { links: [...links] },
      userEmail: auth.userEmail,
      ...(auth.orgDomain !== undefined ? { orgDomain: auth.orgDomain } : {}),
      ...(auth.orgSecret !== undefined ? { orgSecret: auth.orgSecret } : {}),
      requestTimeoutMs: timeoutMs,
    });
  };
  let response:
    | Awaited<ReturnType<typeof invokeAgentAction>>
    | "signed-out"
    | "timeout";
  try {
    response = await Promise.race([askAsReader(), timedOut]);
  } catch (error) {
    console.warn("[link-summary] peer request failed", {
      app,
      error: error instanceof Error ? error.message : String(error),
    });
    return unavailable(links.length);
  } finally {
    clearTimeout(timer);
  }
  if (response === "signed-out") return unavailable(links.length);
  if (response === "timeout") {
    console.warn("[link-summary] peer did not answer in time", {
      app,
      timeoutMs,
    });
    return unavailable(links.length);
  }
  if (response.result.status !== "completed") {
    console.warn("[link-summary] peer refused the request", { app });
    return unavailable(links.length);
  }
  let output: unknown;
  try {
    output = JSON.parse(response.result.output);
  } catch {
    console.warn("[link-summary] peer answered with text that isn't JSON", {
      app,
      chars: response.result.output.length,
    });
    return unavailable(links.length);
  }
  const parsed = linkSummaryResultSchema.safeParse(output);
  if (!parsed.success || parsed.data.summaries.length !== links.length) {
    console.warn("[link-summary] peer answered outside the contract", { app });
    return unavailable(links.length);
  }
  return parsed.data.summaries.map((summary, index) =>
    summary.status === "available" &&
    (summary.app !== app ||
      summary.kind !== LINK_SUMMARY_KINDS[app] ||
      summary.url !== links[index])
      ? UNAVAILABLE_LINK_SUMMARY
      : summary,
  );
}

/**
 * The owning app's side: parses each link against this app's item routes
 * below `basePath`, reads each item's title as the caller through `readTitle`
 * (null when the caller can't open it or it doesn't exist), and answers in
 * the shape `readPeerLinkSummaries` accepts. A link that names no item, or
 * whose read throws, is `unavailable` like a private one.
 */
export async function answerLinkSummaries(options: {
  app: LinkSummaryApp;
  links: readonly string[];
  basePath: string;
  readTitle: (item: LinkSummaryItem) => Promise<string | null>;
}): Promise<{ summaries: LinkSummary[] }> {
  const { app, basePath, readTitle } = options;
  const summaries = await mapWithConcurrency(
    options.links,
    LINK_SUMMARY_READ_CONCURRENCY,
    async (link): Promise<LinkSummary> => {
      const url = parseLinkSummaryUrl(link);
      const path = url ? pathBelowAppBase(url, basePath) : null;
      const item = path === null ? null : linkSummaryItemFromPath(app, path);
      if (!item) return UNAVAILABLE_LINK_SUMMARY;
      let title: string | null;
      try {
        title = await readTitle(item);
      } catch (error) {
        console.warn("[link-summary] could not read an item", {
          app,
          error: error instanceof Error ? error.message : String(error),
        });
        return UNAVAILABLE_LINK_SUMMARY;
      }
      if (title === null) return UNAVAILABLE_LINK_SUMMARY;
      return {
        status: "available",
        app,
        kind: LINK_SUMMARY_KINDS[app],
        title: title
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, LINK_SUMMARY_TITLE_CHARS),
        url: link,
      };
    },
  );
  return { summaries };
}
