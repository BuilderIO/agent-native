import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";

type BuilderDesignSystemIndexResult = {
  designSystemId: string;
  jobId: string;
  builderUrl: string;
};

export function localBuilderDesignSystemId(
  builderDesignSystemId: string,
): string {
  const slug = builderDesignSystemId
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `builder-${slug || "design-system"}`;
}

function builderProxyData({
  builderDesignSystemId,
  jobId,
  builderUrl,
  projectName,
  description,
}: {
  builderDesignSystemId: string;
  jobId: string;
  builderUrl: string;
  projectName?: string;
  description?: string;
}) {
  return JSON.stringify({
    source: "builder",
    builderDesignSystemId,
    builderJobId: jobId,
    builderUrl,
    colors: {
      primary: "var(--primary)",
      secondary: "var(--secondary)",
      accent: "var(--accent)",
      background: "var(--background)",
      surface: "var(--card)",
      text: "var(--foreground)",
      textMuted: "var(--muted-foreground)",
    },
    typography: {
      headingFont: "inherit",
      bodyFont: "inherit",
      headingWeight: "700",
      bodyWeight: "400",
      headingSizes: { h1: "48px", h2: "32px", h3: "24px" },
    },
    spacing: { elementGap: "24px", pagePadding: "48px" },
    borders: { radius: "12px", accentWidth: "1px" },
    logos: [],
    notes: [
      "This is a local proxy for a Builder-indexed design system.",
      `Builder design system id: ${builderDesignSystemId}`,
      `Builder indexing job id: ${jobId}`,
      `Builder URL: ${builderUrl}`,
      projectName ? `Requested name: ${projectName}` : "",
      description ? `Context: ${description}` : "",
      "Use Builder as the source of truth for extracted tokens and guidance.",
    ]
      .filter(Boolean)
      .join("\n"),
  });
}

function builderProxyInstructions({
  builderDesignSystemId,
  jobId,
  builderUrl,
}: {
  builderDesignSystemId: string;
  jobId: string;
  builderUrl: string;
}) {
  return [
    "This design system is indexed and owned by Builder.",
    `Builder design system id: ${builderDesignSystemId}`,
    `Builder job id: ${jobId}`,
    `Builder URL: ${builderUrl}`,
    "When generating designs, treat Builder as the source of truth for the final extracted tokens, assets, and guidance.",
  ].join("\n");
}

export async function upsertBuilderProxyDesignSystem({
  result,
  ownerEmail,
  orgId,
  projectName,
  description,
}: {
  result: BuilderDesignSystemIndexResult;
  ownerEmail: string;
  orgId?: string | null;
  projectName?: string;
  description?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const baseLocalDesignSystemId = localBuilderDesignSystemId(
    result.designSystemId,
  );
  const title = projectName?.trim() || "Builder indexed design system";
  const localData = builderProxyData({
    builderDesignSystemId: result.designSystemId,
    jobId: result.jobId,
    builderUrl: result.builderUrl,
    projectName,
    description,
  });
  const customInstructions = builderProxyInstructions({
    builderDesignSystemId: result.designSystemId,
    jobId: result.jobId,
    builderUrl: result.builderUrl,
  });
  const [existing] = await db
    .select({
      id: schema.designSystems.id,
      ownerEmail: schema.designSystems.ownerEmail,
    })
    .from(schema.designSystems)
    .where(eq(schema.designSystems.id, baseLocalDesignSystemId))
    .limit(1);
  const localDesignSystemId =
    existing && existing.ownerEmail !== ownerEmail
      ? `${baseLocalDesignSystemId}-${nanoid(8)}`
      : baseLocalDesignSystemId;
  if (existing && existing.ownerEmail === ownerEmail) {
    await db
      .update(schema.designSystems)
      .set({
        title,
        description:
          description ??
          `Builder indexed design system ${result.designSystemId}`,
        data: localData,
        assets: "[]",
        customInstructions,
        updatedAt: now,
      })
      .where(eq(schema.designSystems.id, existing.id));
  } else {
    const [ownedSystem] = await db
      .select({ id: schema.designSystems.id })
      .from(schema.designSystems)
      .where(eq(schema.designSystems.ownerEmail, ownerEmail))
      .limit(1);
    await db.insert(schema.designSystems).values({
      id: localDesignSystemId,
      title,
      description:
        description ?? `Builder indexed design system ${result.designSystemId}`,
      data: localData,
      assets: "[]",
      customInstructions,
      isDefault: !ownedSystem,
      ownerEmail,
      orgId: orgId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    localDesignSystemId,
    instructions: [
      "Builder design-system indexing has started.",
      `Builder design system: ${result.designSystemId}`,
      `Local selectable design system: ${localDesignSystemId}`,
      `Builder job: ${result.jobId}`,
      `Open: ${result.builderUrl}`,
      "Use the local design system id in Design flows; Builder remains the source of truth for the indexed brand kit.",
    ].join("\n"),
  };
}
