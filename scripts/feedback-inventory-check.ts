import { readFileSync } from "node:fs";

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
  handoff?: {
    scope: string;
    owner: string;
    action: string;
    ticketUrl?: string;
  };
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
};

type Inventory = {
  cutoffTs: string;
  permalinkTs?: string;
  sweepActorId: string;
  channels: Channel[];
};

function slackTimestamp(value: unknown, label: string): bigint {
  const match = /^(\d+)\.(\d{1,6})$/.exec(String(value ?? ""));
  if (!match) throw new Error(`${label} must be a Slack timestamp`);
  return BigInt(match[1]) * 1_000_000n + BigInt(match[2].padEnd(6, "0"));
}

function validateInventory(inventory: Inventory): string[] {
  if (!inventory || !Array.isArray(inventory.channels)) {
    throw new Error("Expected { cutoffTs, channels } in the inventory JSON");
  }

  const cutoff = slackTimestamp(inventory.cutoffTs, "cutoffTs");
  if (!/^U[A-Z0-9]+$/.test(inventory.sweepActorId || "")) {
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

    let expectedCursor: string | null = null;
    let previousTimestamp: bigint | null = null;
    let parentCount = 0;
    let overlapCount = 0;
    let cursorOverlapCount = 0;
    const seen = new Set<string>();

    for (const [pageIndex, page] of channel.pages.entries()) {
      const pageName = `${name} page ${pageIndex + 1}`;
      if ((page.cursor ?? null) !== expectedCursor) {
        throw new Error(`${pageName}: cursor does not follow the prior page`);
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
          !parent.disposition.trim()
        ) {
          throw new Error(
            `${parentName}: record a disposition for every parent`,
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
        for (const [emoji, owners] of Object.entries(parent.reactionOwners)) {
          if (
            !emoji ||
            !Array.isArray(owners) ||
            owners.some((owner) => !/^U[A-Z0-9]+$/.test(owner))
          ) {
            throw new Error(
              `${parentName}: reaction owners must be Slack user IDs`,
            );
          }
        }

        const ownsEye = (parent.reactionOwners.eyes ?? []).includes(
          inventory.sweepActorId,
        );
        const hasCheckmark = (
          parent.reactionOwners.white_check_mark ?? []
        ).includes(inventory.sweepActorId);
        const hasTicket = (parent.reactionOwners.ticket ?? []).includes(
          inventory.sweepActorId,
        );
        const fixedScopes = parent.fixedScopes ?? [];
        if (!Array.isArray(fixedScopes)) {
          throw new Error(`${parentName}: fixedScopes must be an array`);
        }
        for (const [scopeIndex, fixedScope] of fixedScopes.entries()) {
          if (!fixedScope.scope?.trim() || !fixedScope.verification?.trim()) {
            throw new Error(
              `${parentName}: fixed scope ${scopeIndex + 1} needs scope and verification evidence`,
            );
          }
        }
        if (ownsEye) {
          const reactionDecision = parent.reactionDecision;
          if (!reactionDecision) {
            throw new Error(
              `${parentName}: record a ✅ and 🎫 decision for every owned eye`,
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
              `${parentName}: an owned 👀 needs a same-parent status reply by the same actor`,
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
          if (reply.threadParentTs !== parent.threadParentTs) {
            throw new Error(
              `${parentName}: status reply must belong to the source message's root thread`,
            );
          }
          if (reply.actorId !== inventory.sweepActorId) {
            throw new Error(
              `${parentName}: status reply author must match the owned-eye actor ID`,
            );
          }
          if (
            reply.disposition !== parent.disposition ||
            !reply.evidence?.trim() ||
            !reply.text?.trim() ||
            !reply.text
              .toLocaleLowerCase()
              .includes(reply.disposition.toLocaleLowerCase())
          ) {
            throw new Error(
              `${parentName}: status reply must state the current disposition and its evidence`,
            );
          }
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
        if (parent.handoff) {
          if (
            !parent.handoff.scope?.trim() ||
            !parent.handoff.owner?.trim() ||
            !parent.handoff.action?.trim() ||
            !hasTicket
          ) {
            throw new Error(
              `${parentName}: 🎫 needs a distinct handoff scope, owner, and action`,
            );
          }
          if (
            fixedScopes.some(({ scope }) => scope === parent.handoff?.scope)
          ) {
            throw new Error(
              `${parentName}: 🎫 handoff scope must be distinct from the verified fixed scope`,
            );
          }
        } else if (hasTicket) {
          throw new Error(
            `${parentName}: this actor's 🎫 needs a distinct handoff owner and action`,
          );
        }

        seen.add(key);
        previousTimestamp = timestamp;
        parentCount += 1;
        if (isCursorOverlap) cursorOverlapCount += 1;
        if (permalink !== null && timestamp === permalink)
          permalinkFound = true;
        if (timestamp < cutoff) overlapCount += 1;
      }

      const nextCursor = page.nextCursor || null;
      const isLastPage = pageIndex === channel.pages.length - 1;
      if (!isLastPage) {
        if (!nextCursor) {
          throw new Error(
            `${pageName}: missing nextCursor before another page`,
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

    summaries.push(
      `${channel.channelId}: ${parentCount} source occurrences, ${parentCount - overlapCount - cursorOverlapCount} unique in window, ${overlapCount} cutoff overlap, ${cursorOverlapCount} page overlap, ${channel.pages.length} page(s)`,
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
                disposition: "bot report; reviewed",
              },
              {
                ts: "10.000000",
                threadParentTs: "10.000000",
                reactionChecked: true,
                reactionSummary: "eyes (1)",
                reactionOwners: {
                  eyes: ["USWEEPER"],
                  white_check_mark: ["USWEEPER"],
                  ticket: [],
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
                  evidence: "Focused test passed in the open PR; merge pending",
                  text: "Fixed: focused test passed in the open PR; merge pending",
                },
                fixedScopes: [
                  {
                    scope: "initial route screen",
                    verification:
                      "focused test passes in open PR; merge pending",
                  },
                ],
              },
              {
                ts: "9.500000",
                threadParentTs: "9.500000",
                reactionChecked: true,
                reactionSummary: "eyes (1) — another person",
                reactionOwners: { eyes: ["UOTHER"] },
                disposition: "owned by another actor; skipped",
              },
            ],
          },
        ],
      },
    ],
  };
  const invalid = [
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
                    reactionOwners: { eyes: ["USWEEPER"], ticket: [] },
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
  ];
  try {
    validateInventory(valid);
    validateInventory({
      ...valid,
      channels: valid.channels.map((channel) => ({
        ...channel,
        oldestQuery: null,
      })),
    });
    const firstPage = valid.channels[0].pages[0];
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
                        text: "Partially fixed: the verified scope is complete; a separate handoff remains.",
                      },
                      reactionOwners: {
                        eyes: ["USWEEPER"],
                        white_check_mark: ["USWEEPER"],
                        ticket: ["USWEEPER"],
                      },
                      handoff: {
                        scope: "secondary request",
                        owner: "Analytics product owner",
                        action: "choose the remaining behavior",
                      },
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
    validateInventory({
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
      `Feedback inventory checker self-test passed (${invalid.length} negative cases; 4 positive cases).`,
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
