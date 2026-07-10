import { describe, expect, it } from "vitest";

import {
  formatPendingVisualStylePrompt,
  reactSourceAnchorForPendingEdit,
} from "./pending-edits";
import {
  buildReactSemanticHandoff,
  redactReactSourceAnchor,
  type ReactSourceAnchor,
} from "./react-semantic-handoff";

const SUBJECT: ReactSourceAnchor = {
  id: "subject",
  relPath: "app/components/Card.tsx",
  sourceFile: "/Users/example/project/app/components/Card.tsx",
  line: 18,
  column: 7,
  component: "Card",
  runtimeMultiplicity: 1,
  scope: "single-instance",
};

function build(
  overrides: Partial<Parameters<typeof buildReactSemanticHandoff>[0]> = {},
) {
  return buildReactSemanticHandoff({
    operation: "reparent",
    desiredChange: "Move the card inside the hero container.",
    sourceAnchors: [SUBJECT],
    runtimeRelationship: {
      kind: "inside",
      subjectAnchorIds: ["subject"],
    },
    versionHashes: [
      {
        relPath: "app/components/Card.tsx",
        versionHash: "123-abc",
      },
    ],
    ...overrides,
  });
}

describe("buildReactSemanticHandoff", () => {
  it("builds a bounded coding-agent contract without enabling AST structure transforms", () => {
    const result = build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff).toMatchObject({
      version: 1,
      executionMode: "coding-agent",
      operation: "reparent",
      sourceAnchors: [
        {
          id: "subject",
          relPath: "app/components/Card.tsx",
          sourceFile: "app/components/Card.tsx",
          line: 18,
          column: 7,
        },
      ],
      versionHashes: [
        {
          relPath: "app/components/Card.tsx",
          versionHash: "123-abc",
        },
      ],
      executionContract: {
        requiresHumanWriteConsent: true,
        requiresReadBeforeWrite: true,
        requiresExpectedVersionHash: true,
        allowsBlindOverwrite: false,
        allowsGenericAstStructureTransform: false,
        preservePreviewUntilHmrConfirmation: true,
        onVersionConflict: "re-read-and-replan",
      },
    });
    expect(result.handoff.instructions.join(" ")).toContain(
      "do not apply a generic AST reparent",
    );
  });

  it("routes repeated map renders to the coding agent with an explicit scope reason", () => {
    const result = build({
      sourceAnchors: [
        {
          ...SUBJECT,
          runtimeMultiplicity: 6,
          scope: "repeated-render",
          reason: "The same JSX opening element rendered once per map item.",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff.deterministicWritebackRejection).toEqual({
      code: "repeated-runtime-render",
      reason:
        "More than one runtime node resolves to the same source anchor, so a deterministic per-instance source edit would be unsafe.",
    });
    expect(result.handoff.sourceAnchors[0]).toMatchObject({
      runtimeMultiplicity: 6,
      scope: "repeated-render",
    });
  });

  it("makes shared component definition scope explicit before repeated-render scope", () => {
    const result = build({
      operation: "component-change",
      sourceAnchors: [
        {
          ...SUBJECT,
          component: "Button",
          runtimeMultiplicity: 12,
          scope: "shared-component-definition",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff.deterministicWritebackRejection.code).toBe(
      "shared-component-scope",
    );
    expect(result.handoff.deterministicWritebackRejection.reason).toContain(
      "shared component definition",
    );
  });

  it("rejects missing file provenance without inventing an anchor", () => {
    const result = build({
      sourceAnchors: [{ id: "subject", line: 4, column: 9 }],
    });

    expect(result).toEqual({
      ok: false,
      rejection: {
        code: "missing-source-provenance",
        reason: "Source anchor 1 is missing file provenance.",
      },
    });
  });

  it("requires exact positive line and column provenance", () => {
    const result = build({
      sourceAnchors: [
        {
          id: "subject",
          relPath: "app/Card.tsx",
          line: 4,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      rejection: { code: "invalid-source-location" },
    });
  });

  it("redacts an absolute Fiber source path when a safe relPath is available", () => {
    const result = build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const serialized = JSON.stringify(result.handoff);
    expect(serialized).not.toContain("/Users/example/project");
    expect(result.handoff.sourceAnchors[0]?.sourceFile).toBe(
      "app/components/Card.tsx",
    );
  });

  it("rejects an absolute-only source path without echoing it", () => {
    const result = build({
      sourceAnchors: [
        {
          id: "subject",
          sourceFile: "/Users/private/project/app/Card.tsx",
          line: 4,
          column: 2,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("/Users/private");
    expect(result).toMatchObject({
      rejection: { code: "unsafe-source-path" },
    });
  });

  it("rejects runtime relationships that do not reference bounded anchors", () => {
    const result = build({
      runtimeRelationship: {
        kind: "inside",
        subjectAnchorIds: ["missing"],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      rejection: { code: "invalid-runtime-relationship" },
    });
  });

  it("bounds user-authored descriptions and explicit rejection reasons", () => {
    const result = build({
      desiredChange: "x".repeat(3_000),
      runtimeRelationship: {
        kind: "inside",
        subjectAnchorIds: ["subject"],
        description: "y".repeat(1_000),
      },
      deterministicRejection: {
        code: "dynamic-source-expression",
        reason: "z".repeat(1_000),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff.desiredChange).toHaveLength(2_000);
    expect(result.handoff.runtimeRelationship.description).toHaveLength(800);
    expect(result.handoff.deterministicWritebackRejection.reason).toHaveLength(
      800,
    );
  });
});

describe("pending React source anchors", () => {
  it("creates a project-relative anchor from relative bridge provenance", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "./app\\components\\Card.tsx",
          line: 18,
          column: 7,
          component: "Card",
        },
        sourceId: "runtime-card",
        selector: ".card",
      },
    });

    expect(anchor).toEqual({
      id: "runtime-card",
      relPath: "app/components/Card.tsx",
      sourceFile: "./app\\components\\Card.tsx",
      line: 18,
      column: 7,
      component: "Card",
      runtimeMultiplicity: 1,
      scope: "unknown",
    });
  });

  it("keeps an absolute Fiber path only in local state and redacts it from prompts", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "/Users/private/work/app/Card.tsx",
          line: 4,
          column: 2,
          component: "Card",
        },
        sourceId: "runtime-card",
        selector: ".card",
      },
    });
    expect(anchor).toMatchObject({
      sourceFile: "/Users/private/work/app/Card.tsx",
      line: 4,
      column: 2,
    });
    expect(anchor?.relPath).toBeUndefined();

    const prompt = formatPendingVisualStylePrompt({
      edits: [
        {
          screenId: "home",
          filename: "home",
          screenName: "Home",
          selector: ".card",
          sourceId: "runtime-card",
          sourceAnchor: anchor,
          classes: [],
          styles: { color: "red" },
          originalStyles: { color: "blue" },
          updatedAt: 1,
        },
      ],
    });

    expect(prompt).not.toContain("/Users/private");
    expect(prompt).toContain('"line": 4');
    expect(prompt).not.toContain('"sourceFile"');
  });

  it("resolves absolute provenance against the authenticated connection root", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "/Users/example/project/src/components/Card.tsx",
          line: 14,
          column: 7,
          component: "Card",
        },
        selector: ".card",
      },
      rootPath: "/Users/example/project",
    });

    expect(anchor).toMatchObject({
      relPath: "src/components/Card.tsx",
      line: 14,
      column: 7,
    });
    expect(redactReactSourceAnchor(anchor)).toMatchObject({
      relPath: "src/components/Card.tsx",
      sourceFile: "src/components/Card.tsx",
    });
  });

  it("resolves Windows drive paths case-insensitively across slash styles", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "C:\\WORKSPACE\\Project\\src\\Card.tsx",
          line: 14,
          column: 7,
        },
        selector: ".card",
      },
      rootPath: "c:/workspace/project/",
    });

    expect(anchor?.relPath).toBe("src/Card.tsx");
  });

  it("resolves UNC roots case-insensitively without losing the share boundary", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "\\\\SERVER\\Share\\Project\\src\\Card.tsx",
          line: 14,
          column: 7,
        },
        selector: ".card",
      },
      rootPath: "\\\\server\\share\\project",
    });

    expect(anchor?.relPath).toBe("src/Card.tsx");
  });

  it("supports the filesystem root without collapsing its boundary", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "/src/Card.tsx",
          line: 14,
          column: 7,
        },
        selector: ".card",
      },
      rootPath: "/",
    });

    expect(anchor?.relPath).toBe("src/Card.tsx");
  });

  it.each([
    {
      label: "POSIX sibling-prefix",
      sourceFile: "/Users/example/project-other/src/Card.tsx",
      rootPath: "/Users/example/project",
    },
    {
      label: "POSIX traversal outside root",
      sourceFile: "/Users/example/project/src/../../private/Card.tsx",
      rootPath: "/Users/example/project",
    },
    {
      label: "relative traversal",
      sourceFile: "../private/Card.tsx",
      rootPath: "/Users/example/project",
    },
    {
      label: "Windows sibling-prefix",
      sourceFile: "C:\\workspace\\project-other\\src\\Card.tsx",
      rootPath: "C:\\workspace\\project",
    },
    {
      label: "POSIX case mismatch",
      sourceFile: "/Users/example/Project/src/Card.tsx",
      rootPath: "/Users/example/project",
    },
    {
      label: "URL-like source",
      sourceFile: "https://example.test/src/Card.tsx",
      rootPath: "/Users/example/project",
    },
  ])("does not derive relPath across a $label boundary", (fixture) => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: fixture.sourceFile,
          line: 14,
          column: 7,
        },
        selector: ".card",
      },
      rootPath: fixture.rootPath,
    });

    expect(anchor?.relPath).toBeUndefined();
  });

  it("normalizes dot segments only when they remain within the root", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "/Users/example/project/src/../Card.tsx",
          line: 14,
          column: 7,
        },
        selector: ".card",
      },
      rootPath: "/Users/example/project",
    });

    expect(anchor?.relPath).toBe("Card.tsx");
  });

  it("preserves explicit repeated and shared component scope for agent reasoning", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "app/components/Button.tsx",
          line: 12,
          column: 5,
          component: "Button",
        },
        selector: "button",
      },
      runtimeMultiplicity: 9,
      scope: "shared-component-definition",
      reason: "This host node is owned by the shared Button definition.",
    });

    expect(anchor).toMatchObject({
      runtimeMultiplicity: 9,
      scope: "shared-component-definition",
      reason: "This host node is owned by the shared Button definition.",
    });
  });

  it("infers repeated-render scope from runtime multiplicity", () => {
    const anchor = reactSourceAnchorForPendingEdit({
      info: {
        provenance: {
          sourceFile: "app/Card.tsx",
          line: 8,
          column: 3,
        },
        selector: ".card",
      },
      runtimeMultiplicity: 4,
    });

    expect(anchor).toMatchObject({
      runtimeMultiplicity: 4,
      scope: "repeated-render",
    });
  });

  it("serializes style, text, moving-node, and target anchors into the agent prompt", () => {
    const targetAnchor: ReactSourceAnchor = {
      id: "target",
      relPath: "app/components/Hero.tsx",
      sourceFile: "app/components/Hero.tsx",
      line: 9,
      column: 5,
      component: "Hero",
      runtimeMultiplicity: 1,
      scope: "single-instance",
    };
    const prompt = formatPendingVisualStylePrompt({
      edits: [
        {
          screenId: "home",
          filename: "home",
          screenName: "Home",
          selector: ".card",
          sourceId: "runtime-card",
          sourceAnchor: SUBJECT,
          classes: ["card"],
          styles: { display: "flex" },
          originalStyles: { display: "block" },
          updatedAt: 1,
        },
      ],
      liveEdits: [
        {
          kind: "text",
          screenId: "home",
          filename: "home",
          screenName: "Home",
          selector: ".card",
          sourceId: "runtime-card",
          sourceAnchor: SUBJECT,
          classes: ["card"],
          value: "New text",
          originalValue: "Old text",
          updatedAt: 2,
        },
        {
          kind: "structure",
          screenId: "home",
          filename: "home",
          screenName: "Home",
          selector: ".card",
          sourceId: "runtime-card",
          sourceAnchor: SUBJECT,
          anchorSelector: ".hero",
          anchorSourceId: "runtime-hero",
          anchorSourceAnchor: targetAnchor,
          placement: "inside",
          updatedAt: 3,
        },
      ],
    });

    expect(prompt).toContain('"sourceAnchor"');
    expect(prompt).toContain('"anchorSourceAnchor"');
    expect(prompt).toContain('"relPath": "app/components/Card.tsx"');
    expect(prompt).toContain('"relPath": "app/components/Hero.tsx"');
    expect(prompt).not.toContain("/Users/example/project");
    expect(prompt.match(/"runtimeMultiplicity": 1/g)).toHaveLength(6);
    expect(prompt).toContain('"semanticHandoff"');
    expect(prompt).toContain('"executionMode": "coding-agent"');
    expect(prompt).toContain('"operation": "reparent"');
    expect(prompt).toContain('"versionHashes": []');
    expect(prompt).toContain('"subjectAnchorIds": [');
    expect(prompt).toContain('"targetAnchorId": "target"');
    expect(prompt).toContain("Never use a generic AST reparent");
    expect(prompt).toContain(
      "read-local-file, capture its versionHash, obtain human write consent, write-local-file with expectedVersionHash",
    );
    expect(prompt).toContain(
      "keep the preview pending until HMR proves the intended runtime relationship",
    );
  });

  it("includes a safe handoff failure without leaking an unresolved absolute path", () => {
    const prompt = formatPendingVisualStylePrompt({
      edits: [],
      liveEdits: [
        {
          kind: "structure",
          screenId: "home",
          filename: "home",
          screenName: "Home",
          selector: ".card",
          sourceId: "runtime-card",
          sourceAnchor: {
            id: "subject",
            sourceFile: "/Users/private/work/app/Card.tsx",
            line: 4,
            column: 2,
          },
          anchorSelector: ".hero",
          anchorSourceId: "runtime-hero",
          anchorSourceAnchor: {
            id: "target",
            relPath: "app/Hero.tsx",
            sourceFile: "app/Hero.tsx",
            line: 8,
            column: 3,
          },
          placement: "inside",
          updatedAt: 1,
        },
      ],
    });

    expect(prompt).toContain('"semanticHandoffFailure"');
    expect(prompt).toContain('"code": "unsafe-source-path"');
    expect(prompt).toContain("does not include a safe project-relative path");
    expect(prompt).not.toContain("/Users/private");
  });
});
