/**
 * Notification feed scaffold — returns an empty list today. The calls MVP
 * does not yet have notifications; this endpoint exists so the UI can wire up
 * the Notifications route without a runtime error.
 *
 * Usage:
 *   pnpm action list-notifications
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  getCurrentOwnerEmail,
  nanoid,
  parseSpaceIds,
  stringifySpaceIds,
  parseJson,
  resolveDefaultWorkspaceId,
} from "../server/lib/calls.js";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import {
  writeAppState,
  readAppState,
} from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Notification feed scaffold — returns an empty list today. Placeholder so the Notifications route has a consistent shape; real notifications are a post-MVP feature.",
  schema: z.object({
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe("Lookback window in days (accepted for forward compat)"),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(200)
      .describe("Max rows (accepted for forward compat)"),
  }),
  http: { method: "GET" },
  run: async () => {
    return { items: [], count: 0 };
  },
});

void getCurrentOwnerEmail;
void nanoid;
void parseSpaceIds;
void stringifySpaceIds;
void parseJson;
void resolveDefaultWorkspaceId;
void writeAppState;
void readAppState;
void accessFilter;
void assertAccess;
