import { registerOnboardingStep } from "@agent-native/core/onboarding";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  registerNativeResourceCaptureAdapter,
  setupCreativeContext,
  type CreativeContextProjectionAdapters,
} from "@agent-native/creative-context/server";
import { listContextSources } from "@agent-native/creative-context/store";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";
import { nativeDeckCreativeContextAdapter } from "../lib/native-creative-context.js";

type ProjectedLayoutTemplate = {
  id: string;
  type: "layout-template";
  name: string;
  sourceType: "brand-import";
  htmlSnapshot: string | null;
  creativeContext: {
    suggestionId: string;
    itemId: string;
    itemVersionId: string;
    projectionItemId: string;
  };
};

function parseAssets(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isProjectedLayout(value: unknown): value is ProjectedLayoutTemplate {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<ProjectedLayoutTemplate>;
  return (
    candidate.type === "layout-template" &&
    candidate.sourceType === "brand-import" &&
    typeof candidate.creativeContext?.projectionItemId === "string"
  );
}

async function ownedDesignSystems() {
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  return getDb()
    .select()
    .from(schema.designSystems)
    .where(eq(schema.designSystems.ownerEmail, ownerEmail))
    .orderBy(
      desc(schema.designSystems.isDefault),
      desc(schema.designSystems.updatedAt),
    );
}

async function ensureLayoutTarget() {
  const existing = await ownedDesignSystems();
  if (existing[0]) return existing[0];
  const ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  const now = new Date().toISOString();
  const row = {
    id: nanoid(),
    title: "Creative context layouts",
    description: "Approved reusable layouts promoted from Creative Context.",
    data: "{}",
    assets: "[]",
    customInstructions:
      "Prefer approved Creative Context layout templates unchanged before adapting or generating a new layout.",
    isDefault: true,
    ownerEmail,
    orgId: getRequestOrgId(),
    createdAt: now,
    updatedAt: now,
  };
  await getDb().insert(schema.designSystems).values(row);
  return row;
}

const projections: CreativeContextProjectionAdapters = {
  layoutTemplate: {
    promote: async (input) => {
      const designSystem = await ensureLayoutTarget();
      const assets = parseAssets(designSystem.assets).filter(
        (asset) =>
          !isProjectedLayout(asset) ||
          asset.creativeContext.projectionItemId !== input.projectionItemId,
      );
      const projection: ProjectedLayoutTemplate = {
        id: `creative-context-layout:${input.projectionItemId}`,
        type: "layout-template",
        name: `Approved layout ${assets.filter(isProjectedLayout).length + 1}`,
        sourceType: "brand-import",
        htmlSnapshot: input.htmlSnapshot,
        creativeContext: {
          suggestionId: input.suggestionId,
          itemId: input.itemId,
          itemVersionId: input.itemVersionId,
          projectionItemId: input.projectionItemId,
        },
      };
      await getDb()
        .update(schema.designSystems)
        .set({
          assets: JSON.stringify([...assets, projection]),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.designSystems.id, designSystem.id));
    },
    demote: async ({ projectionItemId }) => {
      if (!projectionItemId) return;
      const designSystems = await ownedDesignSystems();
      for (const designSystem of designSystems) {
        const assets = parseAssets(designSystem.assets);
        const filtered = assets.filter(
          (asset) =>
            !isProjectedLayout(asset) ||
            asset.creativeContext.projectionItemId !== projectionItemId,
        );
        if (filtered.length === assets.length) continue;
        await getDb()
          .update(schema.designSystems)
          .set({
            assets: JSON.stringify(filtered),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.designSystems.id, designSystem.id));
      }
    },
  },
};

registerOnboardingStep({
  id: "creative-context-library",
  order: 18,
  required: false,
  title: "Connect your creative library",
  description:
    "Connect prior work and reference sources so agents can reuse approved creative context.",
  methods: [
    {
      id: "library",
      kind: "link",
      primary: true,
      label: "Open Library",
      payload: { url: "/agent#library", external: false },
    },
  ],
  isComplete: async () => {
    try {
      const result = await listContextSources({ limit: 1 });
      return result.sources.length > 0;
    } catch {
      return false;
    }
  },
});

registerNativeResourceCaptureAdapter(nativeDeckCreativeContextAdapter);

export default setupCreativeContext({ appId: "slides", projections });
