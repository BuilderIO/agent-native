import type { DesignSystemArtifact } from "./design-system-authoring.js";

type TokenGroup = Record<string, unknown>;

function group(value: unknown): TokenGroup {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("A stored design-system token group is unreadable.");
  return { ...(value as TokenGroup) };
}

export function legacyDesignSystemFoundations(
  data: Record<string, unknown>,
  now: string,
): DesignSystemArtifact[] {
  return ["colors", "typography", "spacing", "radius"].flatMap((id) => {
    const source = group(data[id === "radius" ? "borders" : id]);
    const values: Record<string, string> = {};
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === "string") values[key] = value;
      else if (id === "typography" && key === "headingSizes") {
        for (const [size, token] of Object.entries(group(value))) {
          if (typeof token === "string" && /^h[123]$/.test(size))
            values[`headingSizes.${size}`] = token;
        }
      }
    }
    return Object.keys(values).length
      ? [
          {
            id,
            kind: "foundation" as const,
            name: id,
            revision: 1,
            provenance: "extracted" as const,
            sourceIds: [],
            values,
            content: null,
            contentType: null,
            contentHash: null,
            updatedAt: now,
            history: [],
          },
        ]
      : [];
  });
}

function radiusDefault(values: Record<string, string>): string | undefined {
  return values.radius?.trim() || values["radius.md"]?.trim() || undefined;
}

/** Flat scales retain their names; radius.md supplies the scalar default only when radius is absent. */
export function projectDesignSystemFoundation(
  data: Record<string, unknown>,
  artifact: Pick<DesignSystemArtifact, "id" | "values">,
): Record<string, unknown> {
  const values = artifact.values ?? {};
  const output = { ...data };
  if (artifact.id === "colors") {
    output.colors = { ...group(data.colors), ...values };
    if (values.background) {
      for (const key of ["defaults", "slideDefaults"]) {
        const defaults = group(data[key]);
        output[key] = { background: values.background, ...defaults };
      }
    }
  } else if (artifact.id === "typography") {
    const typography = group(data.typography);
    const sizes = group(typography.headingSizes);
    for (const [key, value] of Object.entries(values)) {
      if (/^headingSizes\.h[123]$/.test(key))
        sizes[key.slice("headingSizes.".length)] = value;
      else if (key !== "headingSizes") typography[key] = value;
      else
        throw new Error(
          "Use headingSizes.h1, headingSizes.h2 and headingSizes.h3 tokens.",
        );
    }
    if (Object.keys(sizes).length) typography.headingSizes = sizes;
    output.typography = typography;
  } else if (artifact.id === "spacing") {
    const spacing = { ...group(data.spacing), ...values };
    if (values.pagePadding !== undefined && spacing.slidePadding === undefined)
      spacing.slidePadding = values.pagePadding;
    if (values.slidePadding !== undefined && spacing.pagePadding === undefined)
      spacing.pagePadding = values.slidePadding;
    output.spacing = spacing;
  } else if (artifact.id === "radius") {
    const radius = radiusDefault(values);
    output.borders = {
      ...group(data.borders),
      ...values,
      ...(radius ? { radius } : {}),
    };
  }
  return output;
}

export function designSystemReadinessGaps(
  artifacts: DesignSystemArtifact[],
): string[] {
  const required: Array<[string, "foundation" | "component", string[]]> = [
    [
      "colors",
      "foundation",
      [
        "primary",
        "secondary",
        "accent",
        "background",
        "surface",
        "text",
        "textMuted",
      ],
    ],
    [
      "typography",
      "foundation",
      [
        "headingFont",
        "bodyFont",
        "headingWeight",
        "bodyWeight",
        "headingSizes.h1",
        "headingSizes.h2",
        "headingSizes.h3",
      ],
    ],
    ["spacing", "foundation", ["elementGap"]],
    ["radius", "foundation", []],
    ["button", "component", []],
    ["input", "component", []],
    ["card", "component", []],
    ["avatar", "component", []],
  ];
  const gaps: string[] = [];
  for (const [id, kind, keys] of required) {
    const artifact = artifacts.find((candidate) => candidate.id === id);
    if (!artifact || artifact.kind !== kind) {
      gaps.push(id);
      continue;
    }
    if (
      kind === "component" &&
      (!artifact.content ||
        artifact.contentType !== "text/html" ||
        !artifact.contentHash)
    )
      gaps.push(`${id}.html`);
    for (const key of keys)
      if (!artifact.values?.[key]?.trim()) gaps.push(`${id}.${key}`);
    if (id === "radius" && !radiusDefault(artifact.values ?? {}))
      gaps.push("radius.radius-or-radius.md");
    if (
      id === "spacing" &&
      !artifact.values?.pagePadding?.trim() &&
      !artifact.values?.slidePadding?.trim()
    )
      gaps.push("spacing.padding");
  }
  if (
    !artifacts.some(
      (artifact) =>
        artifact.kind === "usage-rule" &&
        artifact.content &&
        artifact.contentType === "text/markdown" &&
        artifact.contentHash,
    )
  )
    gaps.push("usage-rule");
  return gaps;
}
