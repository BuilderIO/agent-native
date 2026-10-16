import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

type Handoff = {
  scope: string;
  owner: string;
  action: string;
  ticketUrl?: string;
};

type Parent = {
  ts: string;
  threadParentTs: string;
  reactionChecked: boolean;
  reactionSummary: string;
  reactionOwners: Record<string, string[]>;
  disposition: string;
  statusReply?: {
    ts: string;
    threadParentTs: string;
    actorId: string;
    disposition: string;
    evidence: string;
    text: string;
  };
  reactionDecision?: {
    checkmark: { state: "present" | "none"; reason: string };
    ticket: { state: "present" | "none"; reason: string };
  };
  fixedScopes?: Array<{ scope: string; verification: string }>;
  handoff?: Handoff;
  handoffs?: Handoff[];
};

type Page = {
  cursor: string | null;
  nextCursor: string | null;
  exhausted: boolean;
  messageCount: number;
  sourceTimestamps: string[];
  parents: Parent[];
};

type Channel = {
  channelId: string;
  oldestQuery: string | null;
  pages: Page[];
  // Actual Slack root timestamps fetched for replies whose roots are off-page.
  threadRoots?: string[];
};

type Inventory = {
  cutoffTs: string;
  permalinkTs?: string;
  sweepActorId: string;
  channels: Channel[];
};

const canonicalDispositions = new Set([
  "Fixed",
  "Partially fixed",
  "Shipped",
  "Live verified",
  "Open - no question",
  "Resolved elsewhere",
  "Skipped",
  "Clustered",
  "Abandoned - no answer in 4 days",
  "Verified locally",
  "Built - live unverified",
  "Deployed - live unverified",
  "Not reproducible - attempted",
  "In progress",
  "Asked",
  "Clarification needed",
  "Blocked on reporter",
  "Owned elsewhere",
]);

function slackTimestamp(value: unknown, label: string): bigint {
  const match = /^(\d+)\.(\d{1,6})$/.exec(String(value ?? ""));
  if (!match) throw new Error(`${label} must be a Slack timestamp`);
  return BigInt(match[1]) * 1_000_000n + BigInt(match[2].padEnd(6, "0"));
}

function isSlackUserId(value: unknown): value is string {
  return typeof value === "string" && /^[UW][A-Z0-9]+$/.test(value);
}

function validateReactionOwners(
  parentName: string,
  reactionSummary: string,
  reactionOwners: Record<string, string[]>,
): void {
  const summary = reactionSummary.trim();
  if (summary === "none") {
    if (Object.keys(reactionOwners).length > 0) {
      throw new Error(
        `${parentName}: reactionOwners must be empty when the observed reaction state is none`,
      );
    }
    return;
  }

  const observed = new Map<string, string[]>();
  for (const [reactionIndex, entry] of summary.split(/;\s*/).entries()) {
    const match = /^(.+?)\s+\((\d+)\):\s*(.+)$/.exec(entry);
    if (!match) {
      throw new Error(
        `${parentName}: reactionSummary must list each emoji, count, and exact owner IDs`,
      );
    }
    const emoji = match[1].trim();
    const count = Number(match[2]);
    const summaryOwners = match[3].split(/,\s*/);
    if (!emoji || observed.has(emoji)) {
      throw new Error(
        `${parentName}: reactionSummary has a missing or duplicate emoji entry at ${reactionIndex + 1}`,
      );
    }
    if (
      !Number.isInteger(count) ||
      count < 1 ||
      summaryOwners.length !== count ||
      summaryOwners.some((owner) => !isSlackUserId(owner)) ||
      new Set(summaryOwners).size !== summaryOwners.length
    ) {
      throw new Error(
        `${parentName}: reactionSummary counts and owner IDs must agree`,
      );
    }
    observed.set(emoji, summaryOwners);
  }

  for (const [emoji, summaryOwners] of observed) {
    const owners = reactionOwners[emoji];
    if (!Array.isArray(owners)) {
      throw new Error(
        `${parentName}: reactionOwners is missing the observed ${emoji} owners`,
      );
    }
    if (
      owners.some((owner) => !isSlackUserId(owner)) ||
      new Set(owners).size !== owners.length ||
      owners.length !== summaryOwners.length ||
      owners.some((owner) => !summaryOwners.includes(owner))
    ) {
      throw new Error(
        `${parentName}: reactionOwners must match every exact owner in reactionSummary`,
      );
    }
  }

  for (const [emoji, owners] of Object.entries(reactionOwners)) {
    if (!observed.has(emoji) || !Array.isArray(owners) || owners.length === 0) {
      throw new Error(
        `${parentName}: reactionOwners has an unobserved or empty ${emoji} entry`,
      );
    }
  }
}

function normalizeScope(scope: string): string {
  return scope.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeReplyPhrase(phrase: string): string {
  return (
    phrase
      .replace(/[*_`]/g, "")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter((word) => !["a", "an", "the"].includes(word))
      .join(" ") ?? ""
  );
}

function replyNamesHandoffs(text: string, handoffs: Handoff[]): boolean {
  const reply = ` ${normalizeReplyPhrase(text)} `;
  return handoffs.every((handoff) =>
    [handoff.owner, handoff.action].every((phrase) => {
      const normalizedPhrase = normalizeReplyPhrase(phrase);
      return normalizedPhrase !== "" && reply.includes(` ${normalizedPhrase} `);
    }),
  );
}

function replyStatesDisposition(text: string, disposition: string): boolean {
  const visibleText = text.replace(/[*_`]/g, "");
  if (
    disposition.toLowerCase() === "fixed" &&
    (/\b(?:(?:is|was|remains)\s+)?(?:not|never)\s+(?:(?:yet|fully)\s+)*fixed\b|\bunfixed\b/i.test(
      visibleText,
    ) ||
      /\b(?:still|remains)\s+broken\b/i.test(visibleText))
  ) {
    return false;
  }
  const escapedDisposition = disposition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const label = new RegExp(
    `(?:^|[\\n.!?;:]\\s*)${escapedDisposition}(?=$|[\\s:—–.!?;,()-])`,
    "i",
  );
  if (label.test(visibleText)) return true;

  return (
    disposition.toLowerCase() === "fixed" &&
    /\bis\s+fixed(?=$|[\s:—–.!?;,()-])/i.test(visibleText)
  );
}

function validateInventory(inventory: Inventory): string[] {
  if (!inventory || !Array.isArray(inventory.channels)) {
    throw new Error("Expected { cutoffTs, channels } in the inventory JSON");
  }

  const cutoff = slackTimestamp(inventory.cutoffTs, "cutoffTs");
  if (!isSlackUserId(inventory.sweepActorId)) {
    throw new Error(
      "sweepActorId must be the exact Slack user ID used by the connector",
    );
  }
  const permalink = inventory.permalinkTs
    ? slackTimestamp(inventory.permalinkTs, "permalinkTs")
    : null;
  if (permalink !== null && permalink !== cutoff) {
    throw new Error("permalinkTs must equal the inclusive cutoffTs");
  }
  if (!inventory.channels.length)
    throw new Error("No channels were inventoried");

  const channelIds = new Set<string>();
  const summaries: string[] = [];
  let permalinkFound = false;

  for (const [channelIndex, channel] of inventory.channels.entries()) {
    const name = channel.channelId || `channel ${channelIndex + 1}`;
    if (!channel.channelId || channelIds.has(channel.channelId)) {
      throw new Error(`${name}: channelId is missing or duplicated`);
    }
    channelIds.add(channel.channelId);

    const oldestQuery = channel.oldestQuery
      ? slackTimestamp(channel.oldestQuery, `${name}.oldestQuery`)
      : null;
    if (oldestQuery !== null && oldestQuery > cutoff - 1_000_000n) {
      throw new Error(
        `${name}: oldestQuery must start at least one second before cutoffTs`,
      );
    }
    if (!Array.isArray(channel.pages) || !channel.pages.length) {
      throw new Error(
        `${name}: record every Slack page, including an empty page`,
      );
    }
    if (
      channel.threadRoots !== undefined &&
      !Array.isArray(channel.threadRoots)
    ) {
      throw new Error(
        `${name}: threadRoots must be an array of Slack timestamps`,
      );
    }

    let expectedCursor: string | null = null;
    let previousTimestamp: bigint | null = null;
    let parentCount = 0;
    let overlapCount = 0;
    let cursorOverlapCount = 0;
    const seen = new Set<string>();
    const seenCursors = new Set<string>();
    const uniqueInWindow = new Set<string>();
    const parentsByTimestamp = new Map<string, Parent>();

    for (const [pageIndex, page] of channel.pages.entries()) {
      const pageName = `${name} page ${pageIndex + 1}`;
      const cursor = page.cursor ?? null;
      if (cursor !== expectedCursor) {
        throw new Error(`${pageName}: cursor does not follow the prior page`);
      }
      if (cursor !== null) {
        if (typeof cursor !== "string" || !cursor) {
          throw new Error(`${pageName}: cursor must be a non-empty string`);
        }
        if (seenCursors.has(cursor)) {
          throw new Error(
            `${pageName}: cursor was already used by an earlier page`,
          );
        }
        seenCursors.add(cursor);
      }
      if (
        !Number.isInteger(page.messageCount) ||
        !Array.isArray(page.parents)
      ) {
        throw new Error(`${pageName}: include messageCount and source rows`);
      }
      if (!Array.isArray(page.sourceTimestamps)) {
        throw new Error(`${pageName}: include all sourceTimestamps from Slack`);
      }
      if (page.messageCount !== page.sourceTimestamps.length) {
        throw new Error(
          `${pageName}: messageCount does not match the source timestamp manifest`,
        );
      }
      if (page.messageCount !== page.parents.length) {
        throw new Error(`${pageName}: a source message has no disposition row`);
      }

      let previousSourceTimestamp: bigint | null = null;
      for (const [sourceIndex, sourceTs] of page.sourceTimestamps.entries()) {
        const sourceTimestamp = slackTimestamp(
          sourceTs,
          `${pageName} source timestamp ${sourceIndex + 1}`,
        );
        if (oldestQuery !== null && sourceTimestamp <= oldestQuery) {
          throw new Error(
            `${pageName} source timestamp ${sourceIndex + 1}: Slack's exclusive oldest bound excludes it`,
          );
        }
        if (
          previousSourceTimestamp !== null &&
          sourceTimestamp >= previousSourceTimestamp
        ) {
          throw new Error(
            `${pageName}: source timestamps are not newest-first`,
          );
        }
        previousSourceTimestamp = sourceTimestamp;
        if (permalink !== null && sourceTimestamp === permalink) {
          permalinkFound = true;
        }
      }

      for (const [parentIndex, parent] of page.parents.entries()) {
        const parentName = `${pageName} parent ${parentIndex + 1}`;
        const timestamp = slackTimestamp(parent.ts, `${parentName}.ts`);
        const threadParentTimestamp = slackTimestamp(
          parent.threadParentTs,
          `${parentName}.threadParentTs`,
        );
        if (threadParentTimestamp > timestamp) {
          throw new Error(
            `${parentName}: threadParentTs cannot be newer than the source message`,
          );
        }
        const key = timestamp.toString();
        if (page.sourceTimestamps[parentIndex] !== parent.ts) {
          throw new Error(
            `${parentName}: disposition rows do not match the source timestamp manifest`,
          );
        }
        if (oldestQuery !== null && timestamp <= oldestQuery) {
          throw new Error(
            `${parentName}: Slack's exclusive oldest bound excludes it`,
          );
        }
        const isCursorOverlap =
          pageIndex > 0 &&
          parentIndex === 0 &&
          previousTimestamp !== null &&
          timestamp === previousTimestamp;
        if (seen.has(key) && !isCursorOverlap) {
          throw new Error(`${parentName}: duplicate parent timestamp`);
        }
        if (
          previousTimestamp !== null &&
          timestamp >= previousTimestamp &&
          !isCursorOverlap
        ) {
          throw new Error(
            `${parentName}: parents are not newest-first across pages`,
          );
        }
        if (parent.reactionChecked !== true) {
          throw new Error(`${parentName}: check reactions before triage`);
        }
        if (
          typeof parent.disposition !== "string" ||
          !canonicalDispositions.has(parent.disposition)
        ) {
          throw new Error(
            `${parentName}: use an exact canonical disposition for every parent`,
          );
        }
        if (
          typeof parent.reactionSummary !== "string" ||
          !parent.reactionSummary.trim()
        ) {
          throw new Error(`${parentName}: record the observed reaction state`);
        }
        if (
          !parent.reactionOwners ||
          typeof parent.reactionOwners !== "object" ||
          Array.isArray(parent.reactionOwners)
        ) {
          throw new Error(
            `${parentName}: record exact user IDs for every reaction`,
          );
        }
        validateReactionOwners(
          parentName,
          parent.reactionSummary,
          parent.reactionOwners,
        );

        const ownsEye = (parent.reactionOwners.eyes ?? []).includes(
          inventory.sweepActorId,
        );
        const hasCheckmark = (
          parent.reactionOwners.white_check_mark ?? []
        ).includes(inventory.sweepActorId);
        const hasTicket = (parent.reactionOwners.ticket ?? []).includes(
          inventory.sweepActorId,
        );
        const reconcilesOwnedStatus = ownsEye || hasCheckmark || hasTicket;
        if (reconcilesOwnedStatus) {
          const fixedScopes = parent.fixedScopes ?? [];
          if (!Array.isArray(fixedScopes)) {
            throw new Error(`${parentName}: fixedScopes must be an array`);
          }
          const fixedScopeNames = new Set<string>();
          for (const [scopeIndex, fixedScope] of fixedScopes.entries()) {
            if (
              !fixedScope ||
              typeof fixedScope.scope !== "string" ||
              !fixedScope.scope.trim() ||
              typeof fixedScope.verification !== "string" ||
              !fixedScope.verification.trim()
            ) {
              throw new Error(
                `${parentName}: fixed scope ${scopeIndex + 1} needs scope and verification evidence`,
              );
            }
            const normalizedScope = normalizeScope(fixedScope.scope);
            if (fixedScopeNames.has(normalizedScope)) {
              throw new Error(`${parentName}: fixed scopes must be distinct`);
            }
            fixedScopeNames.add(normalizedScope);
          }
          const reactionDecision = parent.reactionDecision;
          if (!reactionDecision) {
            throw new Error(
              `${parentName}: record a ✅ and 🎫 decision for every owned eye or own status mark`,
            );
          }
          for (const reaction of ["checkmark", "ticket"] as const) {
            const decision = reactionDecision[reaction];
            const present = reaction === "checkmark" ? hasCheckmark : hasTicket;
            if (
              !decision ||
              decision.state !== (present ? "present" : "none") ||
              !decision.reason?.trim()
            ) {
              throw new Error(
                `${parentName}: ${reaction} decision must match the observed reaction and include a reason`,
              );
            }
          }
          const reply = parent.statusReply;
          if (!reply) {
            throw new Error(
              `${parentName}: an owned 👀 or own ✅/🎫 needs a same-parent status reply by the same actor`,
            );
          }
          const replyTs = slackTimestamp(
            reply.ts,
            `${parentName}.statusReply.ts`,
          );
          if (replyTs <= timestamp) {
            throw new Error(
              `${parentName}: status reply must be newer than its parent`,
            );
          }
          if (
            slackTimestamp(
              reply.threadParentTs,
              `${parentName}.statusReply.threadParentTs`,
            ) !== threadParentTimestamp
          ) {
            throw new Error(
              `${parentName}: status reply must belong to the source message's root thread`,
            );
          }
          if (reply.actorId !== inventory.sweepActorId) {
            throw new Error(
              `${parentName}: status reply author must match this actor's owned eye or status mark`,
            );
          }
          if (
            reply.disposition !== parent.disposition ||
            typeof reply.evidence !== "string" ||
            !reply.evidence.trim() ||
            typeof reply.text !== "string" ||
            !reply.text.trim() ||
            !replyStatesDisposition(reply.text, parent.disposition) ||
            !reply.text.includes(reply.evidence.trim())
          ) {
            throw new Error(
              `${parentName}: status reply must state the exact disposition and include its recorded evidence`,
            );
          }
          if (
            fixedScopes.some(
              (fixedScope) =>
                !reply.evidence.includes(fixedScope.verification.trim()),
            )
          ) {
            throw new Error(
              `${parentName}: status reply evidence must include every fixed scope's recorded verification`,
            );
          }
          if (fixedScopes.length > 0 && !hasCheckmark) {
            throw new Error(
              `${parentName}: verified fixed scope needs this actor's ✅`,
            );
          }
          if (
            fixedScopes.length > 0 &&
            !["Fixed", "Partially fixed"].includes(parent.disposition)
          ) {
            throw new Error(
              `${parentName}: verified fixed scope needs Fixed or Partially fixed disposition`,
            );
          }
          if (parent.disposition === "Fixed" && fixedScopes.length === 0) {
            throw new Error(
              `${parentName}: Fixed disposition needs verified fixed-scope evidence`,
            );
          }
          if (
            parent.disposition === "Partially fixed" &&
            fixedScopes.length === 0
          ) {
            throw new Error(
              `${parentName}: Partially fixed disposition needs verified fixed-scope evidence`,
            );
          }
          if (hasCheckmark && fixedScopes.length === 0) {
            throw new Error(
              `${parentName}: this actor's ✅ needs a verified fixed scope`,
            );
          }
          if (
            hasCheckmark &&
            !["Fixed", "Partially fixed"].includes(parent.disposition)
          ) {
            throw new Error(
              `${parentName}: this actor's ✅ requires Fixed or Partially fixed disposition`,
            );
          }
          if (parent.handoff && parent.handoffs !== undefined) {
            throw new Error(`${parentName}: use handoff or handoffs, not both`);
          }
          if (
            parent.handoffs !== undefined &&
            !Array.isArray(parent.handoffs)
          ) {
            throw new Error(`${parentName}: handoffs must be an array`);
          }
          const handoffs =
            parent.handoffs ?? (parent.handoff ? [parent.handoff] : []);
          const handoffScopes = new Set<string>();
          for (const [handoffIndex, handoff] of handoffs.entries()) {
            if (
              !handoff ||
              typeof handoff.scope !== "string" ||
              !handoff.scope.trim() ||
              typeof handoff.owner !== "string" ||
              !handoff.owner.trim() ||
              typeof handoff.action !== "string" ||
              !handoff.action.trim()
            ) {
              throw new Error(
                `${parentName}: handoff ${handoffIndex + 1} needs a distinct scope, owner, and action`,
              );
            }
            const normalizedScope = normalizeScope(handoff.scope);
            if (handoffScopes.has(normalizedScope)) {
              throw new Error(`${parentName}: handoff scopes must be distinct`);
            }
            handoffScopes.add(normalizedScope);
            if (fixedScopeNames.has(normalizedScope)) {
              throw new Error(
                `${parentName}: 🎫 handoff scope must be distinct from verified fixed scopes`,
              );
            }
          }
          if (handoffs.length > 0 && !hasTicket) {
            throw new Error(
              `${parentName}: every handoff needs this actor's 🎫`,
            );
          }
          if (handoffs.length === 0 && hasTicket) {
            throw new Error(
              `${parentName}: this actor's 🎫 needs a distinct handoff owner and action`,
            );
          }
          if (parent.disposition === "Fixed" && handoffs.length > 0) {
            throw new Error(
              `${parentName}: Fixed disposition cannot retain unfinished handoffs; use Partially fixed`,
            );
          }
          if (
            handoffs.length > 0 &&
            !replyNamesHandoffs(parent.statusReply!.text, handoffs)
          ) {
            throw new Error(
              `${parentName}: status reply must name each handoff's owner and action`,
            );
          }
        }

        if (seen.has(key)) {
          const previousParent = parentsByTimestamp.get(key);
          if (!isCursorOverlap || !isDeepStrictEqual(previousParent, parent)) {
            throw new Error(
              `${parentName}: cursor-overlap row must exactly match the prior page's last source row`,
            );
          }
        } else {
          seen.add(key);
          parentsByTimestamp.set(key, parent);
        }
        previousTimestamp = timestamp;
        parentCount += 1;
        if (isCursorOverlap) cursorOverlapCount += 1;
        if (timestamp >= cutoff) uniqueInWindow.add(key);
        if (permalink !== null && timestamp === permalink)
          permalinkFound = true;
        if (timestamp < cutoff) overlapCount += 1;
      }

      const nextCursor = page.nextCursor || null;
      if (nextCursor !== null && typeof nextCursor !== "string") {
        throw new Error(`${pageName}: nextCursor must be a string`);
      }
      const isLastPage = pageIndex === channel.pages.length - 1;
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(
          `${pageName}: nextCursor repeats a cursor already used`,
        );
      }
      if (!isLastPage) {
        if (!nextCursor) {
          throw new Error(
            `${pageName}: missing nextCursor before another page`,
          );
        }
        if (page.exhausted === true) {
          throw new Error(
            `${pageName}: exhausted page cannot have a next page`,
          );
        }
        expectedCursor = nextCursor;
      } else {
        const crossedCutoff = page.parents.some(
          (parent) => slackTimestamp(parent.ts, `${pageName}.ts`) < cutoff,
        );
        if (nextCursor && !crossedCutoff) {
          throw new Error(
            `${pageName}: fetch the next cursor or include a parent older than cutoffTs`,
          );
        }
        if (!nextCursor && page.exhausted !== true && !crossedCutoff) {
          throw new Error(
            `${pageName}: mark Slack exhaustion or include a parent older than cutoffTs`,
          );
        }
      }
    }

    const supplementalRoots = new Set<string>();
    for (const [rootIndex, root] of (channel.threadRoots ?? []).entries()) {
      const rootTime = slackTimestamp(
        root,
        `${name}.threadRoots[${rootIndex}]`,
      );
      if (rootTime >= cutoff) {
        throw new Error(
          `${name}: a supplemental thread root must predate cutoffTs; include roots within the scoped window in the source manifest`,
        );
      }
      const rootTimestamp = rootTime.toString();
      if (supplementalRoots.has(rootTimestamp)) {
        throw new Error(`${name}: threadRoots contains a duplicate root`);
      }
      if (parentsByTimestamp.has(rootTimestamp)) {
        throw new Error(
          `${name}: threadRoots must include only roots outside page manifests`,
        );
      }
      supplementalRoots.add(rootTimestamp);
    }

    const referencedSupplementalRoots = new Set<string>();
    for (const [timestamp, parent] of parentsByTimestamp) {
      const rootTimestamp = slackTimestamp(
        parent.threadParentTs,
        `${name} source ${parent.ts}.threadParentTs`,
      ).toString();
      if (rootTimestamp === timestamp) continue;
      const root = parentsByTimestamp.get(rootTimestamp);
      if (root) {
        if (
          slackTimestamp(
            root.threadParentTs,
            `${name} root ${root.ts}.threadParentTs`,
          ) !== slackTimestamp(root.ts, `${name} root ${root.ts}.ts`)
        ) {
          throw new Error(
            `${name} source ${parent.ts}: threadParentTs resolves to a reply, not the actual root`,
          );
        }
      } else if (supplementalRoots.has(rootTimestamp)) {
        referencedSupplementalRoots.add(rootTimestamp);
      } else {
        throw new Error(
          `${name} source ${parent.ts}: threadParentTs does not resolve to an in-page root or verified threadRoots entry`,
        );
      }
    }
    if (referencedSupplementalRoots.size !== supplementalRoots.size) {
      throw new Error(`${name}: threadRoots contains an unreferenced root`);
    }

    summaries.push(
      `${channel.channelId}: ${parentCount} source occurrences, ${uniqueInWindow.size} unique in window, ${overlapCount} cutoff overlap, ${cursorOverlapCount} page overlap, ${channel.pages.length} page(s)`,
    );
  }

  if (permalink !== null && !permalinkFound) {
    throw new Error(
      "The requested permalink timestamp is missing from the inventory",
    );
  }

  return summaries;
}

const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (args[0] === "--self-test" && args.length === 1) {
  const valid: Inventory = {
    cutoffTs: "10.000000",
    permalinkTs: "10.000000",
    sweepActorId: "USWEEPER",
    channels: [
      {
        channelId: "C_TEST",
        oldestQuery: "9.000000",
        pages: [
          {
            cursor: null,
            nextCursor: null,
            exhausted: true,
            messageCount: 3,
            sourceTimestamps: ["11.000000", "10.000000", "9.500000"],
            parents: [
              {
                ts: "11.000000",
                threadParentTs: "11.000000",
                reactionChecked: true,
                reactionSummary: "none",
                reactionOwners: {},
                disposition: "Skipped",
              },
              {
                ts: "10.000000",
                threadParentTs: "10.000000",
                reactionChecked: true,
                reactionSummary:
                  "eyes (1): USWEEPER; white_check_mark (1): USWEEPER",
                reactionOwners: {
                  eyes: ["USWEEPER"],
                  white_check_mark: ["USWEEPER"],
                },
                disposition: "Fixed",
                reactionDecision: {
                  checkmark: {
                    state: "present",
                    reason: "Verified initial route screen fix",
                  },
                  ticket: {
                    state: "none",
                    reason: "No separate human-owned action remains",
                  },
                },
                statusReply: {
                  ts: "12.000000",
                  threadParentTs: "10.000000",
                  actorId: "USWEEPER",
                  disposition: "Fixed",
                  evidence: "focused test passed in the open PR; merge pending",
                  text: "Fixed: focused test passed in the open PR; merge pending",
                },
                fixedScopes: [
                  {
                    scope: "initial route screen",
                    verification:
                      "focused test passed in the open PR; merge pending",
                  },
                ],
              },
              {
                ts: "9.500000",
                threadParentTs: "9.500000",
                reactionChecked: true,
                reactionSummary: "eyes (1): UOTHER",
                reactionOwners: { eyes: ["UOTHER"] },
                disposition: "Skipped",
              },
            ],
          },
        ],
      },
    ],
  };
  const firstPage = valid.channels[0].pages[0];
  const withHandoffReply = (text: string): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) =>
          parent.ts === "10.000000"
            ? {
                ...parent,
                disposition: "Partially fixed",
                reactionSummary:
                  "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                reactionOwners: {
                  eyes: ["USWEEPER"],
                  white_check_mark: ["USWEEPER"],
                  ticket: ["USWEEPER"],
                },
                reactionDecision: {
                  checkmark: {
                    state: "present",
                    reason: "Verified route-picker fix",
                  },
                  ticket: {
                    state: "present",
                    reason: "A product owner has a distinct follow-up",
                  },
                },
                handoffs: [
                  {
                    scope: "secondary request",
                    owner: "Product owner",
                    action: "choose the remaining behavior",
                  },
                ],
                fixedScopes: [
                  {
                    scope: "route-picker behavior",
                    verification:
                      "focused route-picker test passed; merge pending",
                  },
                ],
                statusReply: {
                  ...parent.statusReply!,
                  disposition: "Partially fixed",
                  evidence: "focused route-picker test passed; merge pending",
                  text,
                },
              }
            : parent,
        ),
      })),
    })),
  });
  const withUnownedCheckmark = (
    overrides: Partial<Parent> = {},
  ): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) =>
          parent.ts === "10.000000"
            ? {
                ...parent,
                reactionSummary:
                  "1+ (1): UOTHER; white_check_mark (1): USWEEPER",
                reactionOwners: {
                  "1+": ["UOTHER"],
                  white_check_mark: ["USWEEPER"],
                },
                reactionDecision: {
                  checkmark: {
                    state: "present",
                    reason: "Verified initial route screen fix",
                  },
                  ticket: {
                    state: "none",
                    reason: "No separate human-owned action remains",
                  },
                },
                ...overrides,
              }
            : parent,
        ),
      })),
    })),
  });
  const withUnownedTicket = (overrides: Partial<Parent> = {}): Inventory => ({
    ...valid,
    channels: valid.channels.map((channel) => ({
      ...channel,
      pages: channel.pages.map((page) => ({
        ...page,
        parents: page.parents.map((parent) =>
          parent.ts === "10.000000"
            ? {
                ...parent,
                disposition: "In progress",
                reactionSummary: "ticket (1): USWEEPER",
                reactionOwners: { ticket: ["USWEEPER"] },
                reactionDecision: {
                  checkmark: {
                    state: "none",
                    reason: "No verified scope is complete yet",
                  },
                  ticket: {
                    state: "present",
                    reason: "A product owner owns the remaining action",
                  },
                },
                fixedScopes: [],
                handoffs: [
                  {
                    scope: "remaining design choice",
                    owner: "Product owner",
                    action: "choose the remaining behavior",
                  },
                ],
                statusReply: {
                  ...parent.statusReply!,
                  disposition: "In progress",
                  evidence: "Product owner will choose the remaining behavior",
                  text: "In progress: Product owner will choose the remaining behavior. Handoff: Product owner — choose the remaining behavior.",
                },
                ...overrides,
              }
            : parent,
        ),
      })),
    })),
  });
  const invalid = [
    {
      name: "noncanonical disposition label",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? { ...parent, disposition: "Reviewed by another actor" }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "missing disposition row",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.slice(1),
          })),
        })),
      },
    },
    {
      name: "missing permalink",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            messageCount: 1,
            sourceTimestamps: ["11.000000"],
            parents: page.parents.slice(0, 1),
          })),
        })),
      },
    },
    {
      name: "permalink is not the inclusive cutoff",
      inventory: { ...valid, cutoffTs: "10.000001" },
    },
    {
      name: "owned eye missing a status reply",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, statusReply: undefined }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "owned eye missing explicit reaction decisions",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, reactionDecision: undefined }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "reaction owner map omits an observed eye",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionOwners: {
                      white_check_mark: ["USWEEPER"],
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply from a different actor",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: { ...parent.statusReply!, actorId: "UOTHER" },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "reply row status is posted in a different thread",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, threadParentTs: "9.500000" }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "checkmark without an owned eye still needs a status reply",
      inventory: withUnownedCheckmark({ statusReply: undefined }),
    },
    {
      name: "checkmark without an owned eye still needs its recorded evidence",
      inventory: withUnownedCheckmark({
        statusReply: {
          ts: "12.000000",
          threadParentTs: "10.000000",
          actorId: "USWEEPER",
          disposition: "Fixed",
          evidence: "focused test passed in the open PR; merge pending",
          text: "Fixed: a different note",
        },
      }),
    },
    {
      name: "ticket without an owned eye still needs reaction decisions",
      inventory: withUnownedTicket({ reactionDecision: undefined }),
    },
    {
      name: "reply root is missing from page rows and threadRoots",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "9.500000"
                ? { ...parent, threadParentTs: "8.500000" }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "supplemental root inside the cutoff bypasses the source manifest",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadRoots: ["10.500000"],
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "11.000000"
                ? { ...parent, threadParentTs: "10.500000" }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "reply points to an in-page reply instead of its root",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          threadRoots: ["9.000000"],
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    threadParentTs: "9.500000",
                    statusReply: {
                      ...parent.statusReply!,
                      threadParentTs: "9.500000",
                    },
                  }
                : parent.ts === "9.500000"
                  ? { ...parent, threadParentTs: "9.000000" }
                  : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply text omits its disposition",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      text: "Verified the UI",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply does not claim the disposition inside a negated phrase",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      evidence: "Not fixed — the route is still broken",
                      text: "Not fixed — the route is still broken",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "Fixed label cannot contradict a later unfixed claim",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      evidence: "the route is still not fixed",
                      text: "Fixed: the route is still not fixed",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply must include its recorded evidence",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    statusReply: {
                      ...parent.statusReply!,
                      text: "Fixed — a different note",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "status reply evidence must match fixed-scope verification",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    fixedScopes: [
                      {
                        ...parent.fixedScopes![0]!,
                        verification: "a separate check that the reply omits",
                      },
                    ],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "handoff reply must name the recorded owner",
      inventory: withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. Handoff: secondary request — choose the remaining behavior.",
      ),
    },
    {
      name: "handoff reply must name the recorded action",
      inventory: withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. Handoff: secondary request — Product owner will follow up.",
      ),
    },
    {
      name: "handoff reply must match owner word boundaries",
      inventory: withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. Handoff: secondary request — Product ownership will choose the remaining behavior.",
      ),
    },
    {
      name: "fixed scope without a checkmark",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionSummary: "eyes (1): USWEEPER",
                    reactionOwners: { eyes: ["USWEEPER"] },
                    reactionDecision: {
                      checkmark: {
                        state: "none",
                        reason: "No verified fixed scope",
                      },
                      ticket: {
                        state: "none",
                        reason: "No separate human-owned action remains",
                      },
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "checkmark without verified fixed scope",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? { ...parent, fixedScopes: [] }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "partially fixed without verified fixed-scope evidence",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionSummary: "eyes (1): USWEEPER",
                    reactionOwners: { eyes: ["USWEEPER"] },
                    reactionDecision: {
                      checkmark: {
                        state: "none",
                        reason: "No verified scope is complete yet",
                      },
                      ticket: {
                        state: "none",
                        reason: "No separate human-owned action remains",
                      },
                    },
                    disposition: "Partially fixed",
                    statusReply: {
                      ...parent.statusReply!,
                      disposition: "Partially fixed",
                      evidence: "further work remains in progress.",
                      text: "Partially fixed: further work remains in progress.",
                    },
                    fixedScopes: [],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "ticket reaction without a human handoff",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionOwners: {
                      eyes: ["USWEEPER"],
                      white_check_mark: ["USWEEPER"],
                      ticket: ["USWEEPER"],
                    },
                    reactionSummary:
                      "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                    reactionDecision: {
                      checkmark: {
                        state: "present",
                        reason: "Verified initial route screen fix",
                      },
                      ticket: {
                        state: "present",
                        reason: "A separate human-owned action remains",
                      },
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "human handoff without a ticket reaction",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    handoff: {
                      scope: "review approval",
                      owner: "Steve",
                      action: "approve PR #1",
                    },
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "Fixed disposition cannot retain an unfinished handoff",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    reactionOwners: {
                      eyes: ["USWEEPER"],
                      white_check_mark: ["USWEEPER"],
                      ticket: ["USWEEPER"],
                    },
                    reactionSummary:
                      "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                    reactionDecision: {
                      checkmark: {
                        state: "present",
                        reason: "Verified initial route screen fix",
                      },
                      ticket: {
                        state: "present",
                        reason: "Another distinct human-owned action remains",
                      },
                    },
                    handoffs: [
                      {
                        scope: "secondary request",
                        owner: "Product owner",
                        action: "choose the remaining behavior",
                      },
                    ],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "duplicate handoff scopes are not distinct",
      inventory: {
        ...valid,
        channels: valid.channels.map((channel) => ({
          ...channel,
          pages: channel.pages.map((page) => ({
            ...page,
            parents: page.parents.map((parent) =>
              parent.ts === "10.000000"
                ? {
                    ...parent,
                    handoffs: [
                      {
                        scope: "remaining setup",
                        owner: "Owner A",
                        action: "finish setup",
                      },
                      {
                        scope: "  Remaining   setup ",
                        owner: "Owner B",
                        action: "verify setup",
                      },
                    ],
                  }
                : parent,
            ),
          })),
        })),
      },
    },
    {
      name: "cursor overlap row differs from the prior page snapshot",
      inventory: {
        ...valid,
        channels: [
          {
            ...valid.channels[0],
            pages: [
              {
                ...firstPage,
                cursor: null,
                nextCursor: "next-page",
                exhausted: false,
                messageCount: 2,
                sourceTimestamps: ["11.000000", "10.000000"],
                parents: firstPage.parents.slice(0, 2),
              },
              {
                cursor: "next-page",
                nextCursor: null,
                exhausted: true,
                messageCount: 2,
                sourceTimestamps: ["10.000000", "9.500000"],
                parents: [
                  {
                    ...firstPage.parents[1],
                    statusReply: {
                      ...firstPage.parents[1].statusReply!,
                      evidence: "A different snapshot was observed",
                    },
                  },
                  firstPage.parents[2],
                ],
              },
            ],
          },
        ],
      },
    },
    {
      name: "cursor cycle",
      inventory: {
        ...valid,
        channels: [
          {
            ...valid.channels[0],
            pages: [
              {
                ...firstPage,
                cursor: null,
                nextCursor: "next-page",
                exhausted: false,
                messageCount: 2,
                sourceTimestamps: ["11.000000", "10.000000"],
                parents: firstPage.parents.slice(0, 2),
              },
              {
                cursor: "next-page",
                nextCursor: "next-page",
                exhausted: true,
                messageCount: 2,
                sourceTimestamps: ["10.000000", "9.500000"],
                parents: [firstPage.parents[1], firstPage.parents[2]],
              },
            ],
          },
        ],
      },
    },
  ];
  try {
    validateInventory(valid);
    validateInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "10.000000"
              ? {
                  ...parent,
                  reactionSummary:
                    "eyes (1): UOTHER; white_check_mark (1): UOTHER; ticket (1): UOTHER",
                  reactionOwners: {
                    eyes: ["UOTHER"],
                    white_check_mark: ["UOTHER"],
                    ticket: ["UOTHER"],
                  },
                  disposition: "Partially fixed",
                  reactionDecision: undefined,
                  statusReply: undefined,
                  fixedScopes: [
                    {
                      scope: "verified route behavior",
                      verification: "another actor verified the route behavior",
                    },
                  ],
                  handoffs: [
                    {
                      scope: "remaining design choice",
                      owner: "Product owner",
                      action: "choose the remaining behavior",
                    },
                  ],
                }
              : parent,
          ),
        })),
      })),
    });
    validateInventory(withUnownedCheckmark());
    validateInventory(withUnownedTicket());
    validateInventory(
      withHandoffReply(
        "Partially fixed: focused route-picker test passed; merge pending. Handoff: secondary request — Product owner to choose the remaining behavior.",
      ),
    );
    validateInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "10.000000"
              ? {
                  ...parent,
                  disposition: "Clarification needed",
                  reactionSummary: "eyes (1): USWEEPER",
                  reactionOwners: { eyes: ["USWEEPER"] },
                  reactionDecision: {
                    checkmark: {
                      state: "none",
                      reason:
                        "No scope is verified while clarification is pending",
                    },
                    ticket: {
                      state: "none",
                      reason:
                        "The unanswered reporter request is not a human handoff",
                    },
                  },
                  fixedScopes: [],
                  statusReply: {
                    ...parent.statusReply!,
                    disposition: "Clarification needed",
                    evidence:
                      "waiting for the URL already requested in this thread",
                    text: "Clarification needed: waiting for the URL already requested in this thread. Evidence: waiting for the URL already requested in this thread.",
                  },
                }
              : parent,
          ),
        })),
      })),
    });
    validateInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        oldestQuery: null,
      })),
    });
    validateInventory({
      ...valid,
      channels: [
        {
          ...valid.channels[0],
          pages: [
            {
              ...firstPage,
              parents: firstPage.parents.map((parent) =>
                parent.ts === "10.000000"
                  ? {
                      ...parent,
                      threadParentTs: "9.500000",
                      disposition: "Partially fixed",
                      statusReply: {
                        ...parent.statusReply!,
                        threadParentTs: "9.500000",
                        disposition: "Partially fixed",
                        evidence:
                          "the verified scope is complete; a separate handoff remains.",
                        text: "Partially fixed: the verified scope is complete; a separate handoff remains. Handoffs: secondary request — Analytics product owner to choose the remaining behavior; release timing — Release owner to schedule the rollout.",
                      },
                      reactionOwners: {
                        eyes: ["USWEEPER"],
                        white_check_mark: ["USWEEPER"],
                        ticket: ["USWEEPER"],
                      },
                      reactionSummary:
                        "eyes (1): USWEEPER; white_check_mark (1): USWEEPER; ticket (1): USWEEPER",
                      handoffs: [
                        {
                          scope: "secondary request",
                          owner: "Analytics product owner",
                          action: "choose the remaining behavior",
                        },
                        {
                          scope: "release timing",
                          owner: "Release owner",
                          action: "schedule the rollout",
                        },
                      ],
                      fixedScopes: [
                        {
                          scope: "first scope",
                          verification:
                            "the verified scope is complete; a separate handoff remains.",
                        },
                      ],
                      reactionDecision: {
                        checkmark: {
                          state: "present",
                          reason: "Verified first scope before PR merge",
                        },
                        ticket: {
                          state: "present",
                          reason: "Secondary request needs a product decision",
                        },
                      },
                    }
                  : parent,
              ),
            },
          ],
        },
      ],
    });
    const sweepActorWInventory: Inventory = {
      ...valid,
      sweepActorId: "WACTOR",
      channels: valid.channels.map((channel) => ({
        ...channel,
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "10.000000"
              ? {
                  ...parent,
                  reactionSummary: parent.reactionSummary
                    .split("USWEEPER")
                    .join("WACTOR"),
                  reactionOwners: Object.fromEntries(
                    Object.entries(parent.reactionOwners).map(
                      ([emoji, owners]) => [
                        emoji,
                        owners.map((owner) =>
                          owner === "USWEEPER" ? "WACTOR" : owner,
                        ),
                      ],
                    ),
                  ),
                  statusReply: {
                    ...parent.statusReply!,
                    actorId: "WACTOR",
                  },
                }
              : parent,
          ),
        })),
      })),
    };
    validateInventory(sweepActorWInventory);
    validateInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        threadRoots: ["8.500000"],
        pages: channel.pages.map((page) => ({
          ...page,
          parents: page.parents.map((parent) =>
            parent.ts === "9.500000"
              ? { ...parent, threadParentTs: "8.500000" }
              : parent,
          ),
        })),
      })),
    });
    const cutoffOverlapSummary = validateInventory({
      ...valid,
      channels: [
        {
          ...valid.channels[0],
          oldestQuery: null,
          pages: [
            {
              ...firstPage,
              cursor: null,
              nextCursor: "next-page",
              exhausted: false,
              messageCount: 3,
              sourceTimestamps: ["11.000000", "10.000000", "9.500000"],
              parents: firstPage.parents,
            },
            {
              cursor: "next-page",
              nextCursor: null,
              exhausted: true,
              messageCount: 2,
              sourceTimestamps: ["9.500000", "9.000000"],
              parents: [
                firstPage.parents[2],
                {
                  ts: "9.000000",
                  threadParentTs: "9.000000",
                  reactionChecked: true,
                  reactionSummary: "none",
                  reactionOwners: {},
                  disposition: "Skipped",
                },
              ],
            },
          ],
        },
      ],
    });
    if (
      !cutoffOverlapSummary[0].includes(
        "5 source occurrences, 2 unique in window, 3 cutoff overlap, 1 page overlap",
      )
    ) {
      throw new Error(
        "self-test failed to count cursor and cutoff overlaps independently",
      );
    }
    const paginatedSummary = validateInventory({
      ...valid,
      channels: [
        {
          ...valid.channels[0],
          pages: [
            {
              ...firstPage,
              nextCursor: "next-page",
              exhausted: false,
              messageCount: 2,
              sourceTimestamps: ["11.000000", "10.000000"],
              parents: firstPage.parents.slice(0, 2),
            },
            {
              cursor: "next-page",
              nextCursor: null,
              exhausted: true,
              messageCount: 2,
              sourceTimestamps: ["10.000000", "9.500000"],
              parents: [firstPage.parents[1], firstPage.parents[2]],
            },
          ],
        },
      ],
    });
    if (
      !paginatedSummary[0].includes(
        "4 source occurrences, 2 unique in window, 1 cutoff overlap, 1 page overlap",
      )
    ) {
      throw new Error("self-test failed to count an inclusive cutoff overlap");
    }
    for (const testCase of invalid) {
      try {
        validateInventory(testCase.inventory as Inventory);
        throw new Error(`self-test failed to reject ${testCase.name}`);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("self-test failed")
        ) {
          throw error;
        }
      }
    }
    console.log(
      `Feedback inventory checker self-test passed (${invalid.length} negative cases; 12 positive cases).`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Feedback inventory checker self-test failed: ${message}`);
    process.exit(1);
  }
  process.exit(0);
}

const inputPath = args[0];
if (!inputPath || args.length !== 1) {
  console.error(
    "Usage: pnpm feedback:inventory-check -- .tmp/feedback-inventory.json",
  );
  process.exit(2);
}

try {
  const inventory = JSON.parse(readFileSync(inputPath, "utf8")) as Inventory;
  const summaries = validateInventory(inventory);
  console.log(
    `Feedback inventory is complete through the requested cutoff.\n${summaries.join("\n")}`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Feedback inventory check failed: ${message}`);
  process.exit(1);
}
