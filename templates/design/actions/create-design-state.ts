import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs

export default defineAction({
  description:
    "Create a new named design state, data fixture, or live-capture row for a design. " +
    "Use kind='state' for alternate DOM/Alpine snapshots (Loading, Empty, Error), " +
    "kind='fixture' for static data payloads, " +
    "and kind='capture' (see capture-design-state) to record running-app state via the bridge. " +
    "The new row is returned with its generated id.",
  schema: z.object({
    designId: z.string().describe("Design project ID"),
    name: z
      .string()
      .min(1)
      .describe(
        "Human-readable name shown in the States panel (e.g. 'Loading', 'Empty cart', 'Logged out').",
      ),
    kind: z
      .enum(["state", "fixture", "capture"])
      .default("state")
      .describe("Kind of entry to create."),
    breakpoint: z
      .enum(["auto", "desktop", "tablet", "mobile"])
      .default("auto")
      .describe(
        "Breakpoint context for this state. 'auto' applies at all breakpoints.",
      ),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Opaque source reference: fileId for inline designs, routeId for localhost/fusion. Omit to scope to the entire design.",
      ),
    route: z
      .string()
      .optional()
      .describe(
        "App route path (e.g. '/dashboard') for fixture/capture kinds.",
      ),
    fixtureData: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .optional()
      .describe(
        "Static data payload (props, query params, mock API responses) for fixture kind.",
      ),
    captureData: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.record(z.string(), z.unknown()),
      )
      .optional()
      .describe(
        "Serialised DOM/Alpine snapshot or captured component tree for state/capture kinds.",
      ),
    previewRef: z
      .string()
      .optional()
      .describe(
        "Reference to a design_version snapshot or preview image URL produced when this state was captured.",
      ),
  }),
  run: async ({
    designId,
    name,
    kind,
    breakpoint,
    sourceRef,
    route,
    fixtureData,
    captureData,
    previewRef,
  }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const id = nanoid();
    const now = new Date().toISOString();
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const orgId = getRequestOrgId();

    await db.insert(schema.designState).values({
      id,
      designId,
      sourceRef: sourceRef ?? null,
      name,
      kind,
      breakpoint,
      route: route ?? null,
      fixtureData: fixtureData ? JSON.stringify(fixtureData) : null,
      captureData: captureData ? JSON.stringify(captureData) : null,
      previewRef: previewRef ?? null,
      createdAt: now,
      updatedAt: now,
      ownerEmail,
      orgId,
    });

    return {
      id,
      designId,
      name,
      kind,
      breakpoint,
      sourceRef: sourceRef ?? null,
      createdAt: now,
    };
  },
});
