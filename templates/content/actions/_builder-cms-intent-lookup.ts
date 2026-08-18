import { isDeepStrictEqual } from "node:util";

import { BUILDER_CMS_SAFE_WRITE_MODEL } from "../shared/api.js";
import { readBuilderCmsContentEntries } from "./_builder-cms-read-client.js";
import type { BuilderCmsSourceEntry } from "./_builder-cms-source-adapter.js";
import { BUILDER_CMS_EXECUTION_MARKER_FIELD } from "./_builder-cms-write-adapter.js";

export interface BuilderCmsIntentMatch {
  id: string;
  title: string;
  lastUpdated: string | null;
  published: string | null;
}

export function matchBuilderCmsSafeModelIntentEntries(
  entries: BuilderCmsSourceEntry[],
  args: {
    marker?: string;
    exactTitle?: string;
    intendedFields?: Record<string, unknown>;
  },
) {
  const identityMatches = entries.filter((entry) => {
    const data = rawRecord(entry.rawEntry?.data);
    if (args.marker) {
      return data?.[BUILDER_CMS_EXECUTION_MARKER_FIELD] === args.marker;
    }
    const title = data?.title;
    return (
      typeof title === "string" && title.trim() === args.exactTitle?.trim()
    );
  });
  const matchingIntent = identityMatches.filter((entry) => {
    const data = rawRecord(entry.rawEntry?.data);
    return Object.entries(args.intendedFields ?? {}).every(([key, value]) =>
      isDeepStrictEqual(data?.[key], value),
    );
  });
  return {
    count: identityMatches.length,
    matchingIntentCount: matchingIntent.length,
    matches: identityMatches.map(compactMatch),
  };
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compactMatch(entry: BuilderCmsSourceEntry): BuilderCmsIntentMatch {
  const raw = rawRecord(entry.rawEntry);
  return {
    id: entry.id,
    title: entry.title,
    lastUpdated:
      typeof raw?.lastUpdated === "string" ||
      typeof raw?.lastUpdated === "number"
        ? String(raw.lastUpdated)
        : entry.updatedAt || null,
    published: typeof raw?.published === "string" ? raw.published : null,
  };
}

export async function lookupBuilderCmsSafeModelIntent(args: {
  marker?: string;
  exactTitle?: string;
  intendedFields?: Record<string, unknown>;
}) {
  if (!args.marker && !args.exactTitle) {
    throw new Error("Provide an exact execution marker or exact title.");
  }
  const result = await readBuilderCmsContentEntries({
    model: BUILDER_CMS_SAFE_WRITE_MODEL,
    rawData: true,
    requirePrivateKey: true,
    limit: 10_000,
  });
  if (result.state !== "live" || result.progress.partial) {
    throw new Error(
      result.message ??
        "Builder safe-model lookup was incomplete; reconciliation cannot proceed.",
    );
  }
  return matchBuilderCmsSafeModelIntentEntries(result.entries, args);
}
