import { readFileSync } from "node:fs";

type Parent = {
  ts: string;
  reactionChecked: boolean;
  reactionSummary: string;
  disposition: string;
};

type Page = {
  cursor: string | null;
  nextCursor: string | null;
  exhausted: boolean;
  parentCount: number;
  sourceTimestamps: string[];
  parents: Parent[];
};

type Channel = {
  channelId: string;
  oldestQuery: string;
  pages: Page[];
};

type Inventory = {
  cutoffTs: string;
  permalinkTs?: string;
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

    const oldestQuery = slackTimestamp(
      channel.oldestQuery,
      `${name}.oldestQuery`,
    );
    if (oldestQuery > cutoff - 1_000_000n) {
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
    const seen = new Set<string>();

    for (const [pageIndex, page] of channel.pages.entries()) {
      const pageName = `${name} page ${pageIndex + 1}`;
      if ((page.cursor ?? null) !== expectedCursor) {
        throw new Error(`${pageName}: cursor does not follow the prior page`);
      }
      if (!Number.isInteger(page.parentCount) || !Array.isArray(page.parents)) {
        throw new Error(`${pageName}: include parentCount and parents`);
      }
      if (!Array.isArray(page.sourceTimestamps)) {
        throw new Error(`${pageName}: include all sourceTimestamps from Slack`);
      }
      if (page.parentCount !== page.sourceTimestamps.length) {
        throw new Error(
          `${pageName}: parentCount does not match the source timestamp manifest`,
        );
      }
      if (page.parentCount !== page.parents.length) {
        throw new Error(`${pageName}: a source parent has no disposition row`);
      }

      let previousSourceTimestamp: bigint | null = null;
      for (const [sourceIndex, sourceTs] of page.sourceTimestamps.entries()) {
        const sourceTimestamp = slackTimestamp(
          sourceTs,
          `${pageName} source timestamp ${sourceIndex + 1}`,
        );
        if (sourceTimestamp <= oldestQuery) {
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
        const key = timestamp.toString();
        if (page.sourceTimestamps[parentIndex] !== parent.ts) {
          throw new Error(
            `${parentName}: disposition rows do not match the source timestamp manifest`,
          );
        }
        if (timestamp <= oldestQuery) {
          throw new Error(
            `${parentName}: Slack's exclusive oldest bound excludes it`,
          );
        }
        if (seen.has(key))
          throw new Error(`${parentName}: duplicate parent timestamp`);
        if (previousTimestamp !== null && timestamp >= previousTimestamp) {
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

        seen.add(key);
        previousTimestamp = timestamp;
        parentCount += 1;
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
      `${channel.channelId}: ${parentCount} parents, ${parentCount - overlapCount} in window, ${overlapCount} boundary-overlap, ${channel.pages.length} page(s)`,
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
    channels: [
      {
        channelId: "C_TEST",
        oldestQuery: "9.000000",
        pages: [
          {
            cursor: null,
            nextCursor: null,
            exhausted: true,
            parentCount: 2,
            sourceTimestamps: ["11.000000", "10.000000"],
            parents: [
              {
                ts: "11.000000",
                reactionChecked: true,
                reactionSummary: "none",
                disposition: "bot report; reviewed",
              },
              {
                ts: "10.000000",
                reactionChecked: true,
                reactionSummary: "eyes (1)",
                disposition: "claimed for review",
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
            parentCount: 1,
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
  ];
  try {
    validateInventory(valid);
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
    console.log("Feedback inventory checker self-test passed (4 cases).");
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
