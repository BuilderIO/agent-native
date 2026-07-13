import { describe, expect, it } from "vitest";

import {
  formatPendingVisualStylePrompt,
  pendingLiveStructureEditsMatch,
  reactSourceAnchorForPendingEdit,
  type PendingLiveStructureEdit,
} from "./pending-edits";
import {
  buildReactSemanticHandoff,
  buildRuntimeReactLayerStateHandoff,
  buildRuntimeReactStructureMoveHandoff,
  redactReactSourceAnchor,
  resolveRuntimeStructureMoveExecutionMode,
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

const TARGET: ReactSourceAnchor = {
  id: "target-source",
  relPath: "app/components/Hero.tsx",
  sourceFile: "app/components/Hero.tsx",
  line: 42,
  column: 5,
  component: "Hero",
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

describe("buildRuntimeReactLayerStateHandoff", () => {
  it.each([
    ["locked", true, 'data-agent-native-locked="true"', "Set"],
    ["hidden", true, 'data-agent-native-hidden="true"', "Set"],
    ["locked", false, "data-agent-native-locked", "Clear"],
    ["hidden", false, "data-agent-native-hidden", "Clear"],
  ] as const)(
    "builds an exact, guarded %s=%s source-metadata handoff",
    (state, enabled, expectedAttribute, expectedVerb) => {
      const result = buildRuntimeReactLayerStateHandoff({
        subjectAnchor: SUBJECT,
        screenId: "screen-home",
        state,
        enabled,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.handoff).toMatchObject({
        version: 1,
        executionMode: "coding-agent",
        operation: "set-layer-state",
        sourceAnchors: [
          {
            id: "subject",
            relPath: "app/components/Card.tsx",
            sourceFile: "app/components/Card.tsx",
            line: 18,
            column: 7,
          },
        ],
        runtimeRelationship: {
          kind: "metadata",
          subjectAnchorIds: ["subject"],
          screenId: "screen-home",
          sourceScreenId: "screen-home",
          targetScreenId: "screen-home",
        },
        versionHashes: [],
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
      expect(result.handoff.desiredChange).toContain(expectedAttribute);
      expect(result.handoff.desiredChange).not.toContain("/Users/example");
      expect(result.handoff.runtimeRelationship.description).toContain(
        `${expectedVerb} runtime React layer state "${state}"`,
      );
      expect(result.handoff.instructions.join(" ")).toContain(
        "requireExpectedVersionHash: true",
      );
    },
  );

  it("rejects missing screen ownership instead of emitting an ambiguous state edit", () => {
    expect(
      buildRuntimeReactLayerStateHandoff({
        subjectAnchor: SUBJECT,
        screenId: " ",
        state: "hidden",
        enabled: true,
      }),
    ).toEqual({
      ok: false,
      rejection: {
        code: "invalid-runtime-relationship",
        reason:
          "Runtime layer state changes require an exact owning screen id.",
      },
    });
  });

  it("preserves repeated-render scope so the agent cannot guess at one JSX instance", () => {
    const result = buildRuntimeReactLayerStateHandoff({
      subjectAnchor: {
        ...SUBJECT,
        runtimeMultiplicity: 8,
        scope: "repeated-render",
      },
      screenId: "screen-home",
      state: "locked",
      enabled: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff.deterministicWritebackRejection.code).toBe(
      "repeated-runtime-render",
    );
  });
});

describe("buildRuntimeReactStructureMoveHandoff", () => {
  it("builds a cross-screen reparent with exact subject/target anchors and both screen ids", () => {
    const result = buildRuntimeReactStructureMoveHandoff({
      subjectAnchor: SUBJECT,
      targetAnchor: TARGET,
      placement: "inside",
      sourceScreenId: "screen-source",
      targetScreenId: "screen-target",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handoff).toMatchObject({
      operation: "reparent",
      sourceAnchors: [
        { id: "subject", relPath: "app/components/Card.tsx" },
        { id: "target", relPath: "app/components/Hero.tsx" },
      ],
      runtimeRelationship: {
        kind: "inside",
        subjectAnchorIds: ["subject"],
        targetAnchorId: "target",
        screenId: "screen-target",
        sourceScreenId: "screen-source",
        targetScreenId: "screen-target",
      },
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
    expect(result.handoff.runtimeRelationship.description).toContain(
      'screen "screen-source" to screen "screen-target"',
    );
    expect(result.handoff.instructions.join(" ")).toContain(
      "requireExpectedVersionHash: true",
    );
  });

  it("maps before/after placements to semantic moves", () => {
    for (const placement of ["before", "after"] as const) {
      const result = buildRuntimeReactStructureMoveHandoff({
        subjectAnchor: SUBJECT,
        targetAnchor: TARGET,
        placement,
        sourceScreenId: "screen-a",
        targetScreenId: "screen-b",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.handoff.operation).toBe("move");
      expect(result.handoff.runtimeRelationship.kind).toBe(placement);
    }
  });

  it("allows mixed runtime/source ownership only when both endpoints have exact provenance", () => {
    const valid = buildRuntimeReactStructureMoveHandoff({
      subjectAnchor: { ...SUBJECT, scope: "repeated-render" },
      targetAnchor: TARGET,
      placement: "inside",
      sourceScreenId: "runtime-screen",
      targetScreenId: "source-backed-screen",
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.handoff.deterministicWritebackRejection.code).toBe(
        "repeated-runtime-render",
      );
    }

    const missingTarget = buildRuntimeReactStructureMoveHandoff({
      subjectAnchor: SUBJECT,
      targetAnchor: { id: "target", line: 1, column: 1 },
      placement: "inside",
      sourceScreenId: "runtime-screen",
      targetScreenId: "source-backed-screen",
    });
    expect(missingTarget).toMatchObject({
      ok: false,
      rejection: { code: "missing-source-provenance" },
    });
  });

  it("rejects missing screen ownership instead of emitting an ambiguous handoff", () => {
    expect(
      buildRuntimeReactStructureMoveHandoff({
        subjectAnchor: SUBJECT,
        targetAnchor: TARGET,
        placement: "inside",
        sourceScreenId: " ",
        targetScreenId: "screen-b",
      }),
    ).toEqual({
      ok: false,
      rejection: {
        code: "invalid-runtime-relationship",
        reason:
          "Cross-screen runtime structure moves require exact source and target screen ids.",
      },
    });
  });
});

describe("resolveRuntimeStructureMoveExecutionMode", () => {
  it("keeps same-screen runtime moves on the fast screen bridge", () => {
    expect(
      resolveRuntimeStructureMoveExecutionMode({
        subjectRuntimeOnly: true,
        targetRuntimeOnly: true,
        sourceScreenId: "screen-a",
        targetScreenId: "screen-a",
      }),
    ).toBe("screen-bridge");
  });

  it("routes cross-screen runtime moves through the semantic handoff", () => {
    expect(
      resolveRuntimeStructureMoveExecutionMode({
        subjectRuntimeOnly: true,
        targetRuntimeOnly: true,
        sourceScreenId: "screen-a",
        targetScreenId: "screen-b",
      }),
    ).toBe("semantic-handoff");
  });

  it("routes either mixed runtime/source direction through the semantic handoff", () => {
    for (const [subjectRuntimeOnly, targetRuntimeOnly] of [
      [true, false],
      [false, true],
    ] as const) {
      expect(
        resolveRuntimeStructureMoveExecutionMode({
          subjectRuntimeOnly,
          targetRuntimeOnly,
          sourceScreenId: "screen-a",
          targetScreenId: "screen-b",
        }),
      ).toBe("semantic-handoff");
    }
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
          dropMode: "flow-insert",
          forceFlowPositionOverride: true,
          sourceRect: { x: 40, y: 60, width: 120, height: 80 },
          anchorRect: { x: 20, y: 20, width: 640, height: 480 },
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
    expect(prompt).toContain('"dropMode": "flow-insert"');
    expect(prompt).toContain('"forceFlowPositionOverride": true');
    expect(prompt).toContain('"sourceRect"');
    expect(prompt).toContain('"anchorRect"');
    expect(prompt).toContain(
      "remove authored absolute positioning so the moved element participates in the target container's layout",
    );
    expect(prompt).toContain('"versionHashes": []');
    expect(prompt).toContain('"subjectAnchorIds": [');
    expect(prompt).toContain('"targetAnchorId": "target"');
    expect(prompt).toContain("Never use a generic AST reparent");
    expect(prompt).toContain("source.kind=local-file");
    expect(prompt).toContain("inspect proposedDiff");
    expect(prompt).toContain("persist=true");
    expect(prompt).toContain(
      "read-local-file, capture its versionHash, obtain human write consent, write-local-file with expectedVersionHash",
    );
    expect(prompt).toContain(
      "keep the preview pending until HMR proves the intended runtime relationship",
    );
  });

  it("preserves absolute-container geometry semantics in the guarded handoff", () => {
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
          sourceAnchor: SUBJECT,
          anchorSelector: ".freeform",
          anchorSourceId: "runtime-freeform",
          anchorSourceAnchor: TARGET,
          placement: "inside",
          dropMode: "absolute-container",
          sourceRect: { x: 340, y: 220, width: 120, height: 80 },
          anchorRect: { x: 300, y: 180, width: 640, height: 480 },
          updatedAt: 1,
        },
      ],
    });

    expect(prompt).toContain('"dropMode": "absolute-container"');
    expect(prompt).toContain(
      "preserve absolute positioning and rebase the moved element's visual offset from sourceRect into the target anchorRect coordinate space",
    );
    expect(prompt).toContain('"x": 340');
    expect(prompt).toContain('"x": 300');
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

describe("pending localhost structure history", () => {
  const structureEdit: PendingLiveStructureEdit = {
    kind: "structure",
    screenId: "home",
    filename: "home",
    screenName: "Home",
    selector: ".card",
    sourceId: "runtime-card",
    anchorSelector: ".hero",
    anchorSourceId: "runtime-hero",
    placement: "inside",
    dropMode: "flow-insert",
    forceFlowPositionOverride: true,
    updatedAt: 20,
  };

  it("matches a bridge replay by semantic operation rather than transient request id", () => {
    expect(
      pendingLiveStructureEditsMatch(structureEdit, {
        ...structureEdit,
        requestId: "fresh-bridge-request",
        updatedAt: 999,
      }),
    ).toBe(true);
    expect(
      pendingLiveStructureEditsMatch(structureEdit, {
        ...structureEdit,
        dropMode: "absolute-container",
      }),
    ).toBe(false);
  });
});
