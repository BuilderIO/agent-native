// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import {
  COMPONENT_ARCHIVE_ATTR,
  deleteComponentMain,
  encodeComponentArchivePointer,
  readComponentArchivePointer,
  restoreComponentMain,
  type ComponentArchivePointer,
} from "./component-archive";
import {
  COMPONENT_ID_ATTR,
  COMPONENT_OVERRIDES_ATTR,
  COMPONENT_REF_ATTR,
  COMPONENT_SOURCE_NODE_ID_ATTR,
} from "./component-model";
import { sourceContentHash } from "./source-workspace";

const source = (fileId: string) => ({
  kind: "design-file" as const,
  designId: "design-1",
  fileId,
  filename: `${fileId}.html`,
});

const mainMarkup = `<main data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="cmp-card"><h2 data-agent-native-node-id="main-title">Title</h2><p data-agent-native-node-id="main-subtitle">Subtitle</p></main>`;
const main = `${mainMarkup}<div data-agent-native-node-id="between">Between</div>`;
const overrides = encodeURIComponent(
  JSON.stringify([{ sourceNodeId: "main-subtitle", property: "textContent" }]),
);
const instance = `<main data-agent-native-node-id="instance-root" data-agent-native-component="Card copy" ${COMPONENT_REF_ATTR}="cmp-card"><h2 data-agent-native-node-id="instance-title" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-title">Title</h2><p data-agent-native-node-id="instance-subtitle" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-subtitle" ${COMPONENT_OVERRIDES_ATTR}="${overrides}">Instance override</p></main>`;

function documents(mainContent = `<body>${main}</body>`) {
  return [
    { source: source("file-main"), content: mainContent },
    { source: source("file-instance"), content: `<body>${instance}</body>` },
  ];
}

function deletedDocuments() {
  const original = documents();
  const deleted = deleteComponentMain({
    documents: original,
    target: { fileId: "file-main", nodeId: "main-root" },
    archive: {
      schemaVersion: 1,
      versionId: "version-1",
      fileId: "file-main",
      mainNodeId: "main-root",
      sourceVersionHash: sourceContentHash(original[0]!.content),
    },
  });
  if (deleted.status !== "updated") {
    throw new Error(`Expected deletion to update: ${deleted.message}`);
  }
  const afterByFile = new Map(
    deleted.changes.map((change) => [change.fileId, change.after]),
  );
  return {
    original,
    deleted,
    current: original.map((document) => ({
      ...document,
      content: afterByFile.get(document.source.fileId!) ?? document.content,
    })),
  };
}

function nestedDocuments() {
  const innerMain = `<article data-agent-native-node-id="inner-main" data-agent-native-component="Inner" ${COMPONENT_ID_ATTR}="cmp-inner"><span data-agent-native-node-id="inner-label">Inner</span><span data-agent-native-node-id="inner-copy">Copy</span></article>`;
  const nestedMain = `<article data-agent-native-node-id="nested-source" ${COMPONENT_REF_ATTR}="cmp-inner"><span data-agent-native-node-id="nested-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label">Inner</span><span data-agent-native-node-id="nested-copy" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-copy">Copy</span></article>`;
  const outerMain = `<section data-agent-native-node-id="outer-main" data-agent-native-component="Outer" ${COMPONENT_ID_ATTR}="cmp-outer">${nestedMain}</section>`;
  const nestedInstance = `<article data-agent-native-node-id="nested-instance" ${COMPONENT_REF_ATTR}="cmp-inner" ${COMPONENT_SOURCE_NODE_ID_ATTR}="nested-source"><span data-agent-native-node-id="nested-instance-label" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label">Inner</span><span data-agent-native-node-id="nested-instance-copy" ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-copy">Copy</span></article>`;
  const original = [
    {
      source: source("file-main"),
      content: `<body>${innerMain}${outerMain}</body>`,
    },
    {
      source: source("file-instance"),
      content: `<body><section data-agent-native-node-id="outer-instance" data-agent-native-component="Outer copy" ${COMPONENT_REF_ATTR}="cmp-outer">${nestedInstance}</section></body>`,
    },
  ];
  const deleted = deleteComponentMain({
    documents: original,
    target: { fileId: "file-main", nodeId: "outer-main" },
    archive: {
      schemaVersion: 1,
      versionId: "version-nested",
      fileId: "file-main",
      mainNodeId: "outer-main",
      sourceVersionHash: sourceContentHash(original[0]!.content),
    },
  });
  if (deleted.status !== "updated") {
    throw new Error(`Expected nested deletion to update: ${deleted.message}`);
  }
  const afterByFile = new Map(
    deleted.changes.map((change) => [change.fileId, change.after]),
  );
  return {
    original,
    deleted,
    current: original.map((document) => ({
      ...document,
      content: afterByFile.get(document.source.fileId!) ?? document.content,
    })),
  };
}

describe("component archive transforms", () => {
  it("appends the exact main to its original parent while preserving overrides", () => {
    const { original, deleted, current } = deletedDocuments();

    expect(deleted.archive.componentId).toBe("cmp-card");
    expect(deleted.changes).toHaveLength(2);
    expect(current[0]!.content).not.toContain(
      'data-agent-native-node-id="main-root"',
    );
    expect(current[1]!.content).toContain(COMPONENT_ARCHIVE_ATTR);
    expect(current[1]!.content).toContain(COMPONENT_OVERRIDES_ATTR);

    const archiveRead = readComponentArchivePointer(
      current[1]!.content.match(
        new RegExp(`${COMPONENT_ARCHIVE_ATTR}="([^"]+)"`),
      )?.[1],
    );
    expect(archiveRead).toEqual({ status: "valid", pointer: deleted.archive });

    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
    });
    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    expect(restored.changes).toHaveLength(2);
    const restoredByFile = new Map(
      restored.changes.map((change) => [change.fileId, change.after]),
    );
    expect(restoredByFile.get("file-main")).toBe(
      `<body><div data-agent-native-node-id="between">Between</div>${mainMarkup}</body>`,
    );
    expect(restoredByFile.get("file-instance")).toBe(original[1]!.content);
    expect(restoredByFile.get("file-instance")).not.toContain(
      COMPONENT_ARCHIVE_ATTR,
    );
    expect(restoredByFile.get("file-instance")).toContain(
      `data-agent-native-node-id="instance-subtitle"`,
    );
    expect(restoredByFile.get("file-instance")).toContain(
      COMPONENT_OVERRIDES_ATTR,
    );
  });

  it("appends after surviving siblings when their order changes", () => {
    const original = documents(
      `<body><div data-agent-native-node-id="before">Before</div>${mainMarkup}<div data-agent-native-node-id="after">After</div></body>`,
    );
    const deleted = deleteComponentMain({
      documents: original,
      target: { fileId: "file-main", nodeId: "main-root" },
      archive: {
        schemaVersion: 1,
        versionId: "version-order",
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
      },
    });
    if (deleted.status !== "updated") {
      throw new Error(`Expected deletion to update: ${deleted.message}`);
    }
    const afterByFile = new Map(
      deleted.changes.map((change) => [change.fileId, change.after]),
    );
    const current = original.map((document) => ({
      ...document,
      content: afterByFile.get(document.source.fileId!) ?? document.content,
    }));
    current[0] = {
      ...current[0]!,
      content: `<body><div data-agent-native-node-id="after">After</div><div data-agent-native-node-id="before">Before</div></body>`,
    };

    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
    });

    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    expect(
      restored.changes.find((change) => change.fileId === "file-main")?.after,
    ).toBe(
      `<body><div data-agent-native-node-id="after">After</div><div data-agent-native-node-id="before">Before</div>${mainMarkup}</body>`,
    );
  });

  it("restores a nested component main while retaining valid nested ownership", () => {
    const { original, deleted, current } = nestedDocuments();
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
    });

    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    expect(
      restored.changes.find((change) => change.fileId === "file-main")?.after,
    ).toBe(original[0]!.content);
    expect(
      restored.changes.find((change) => change.fileId === "file-instance")
        ?.after,
    ).not.toContain(COMPONENT_ARCHIVE_ATTR);
  });

  it.each([
    {
      label: "a bogus nested source-node ID",
      mutate: (content: string) =>
        content.replace(
          `${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label"`,
          `${COMPONENT_SOURCE_NODE_ID_ATTR}="BOGUS"`,
        ),
    },
    {
      label: "a missing nested source-node ID",
      mutate: (content: string) =>
        content.replace(` ${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label"`, ""),
    },
    {
      label: "a duplicated nested source-node ID",
      mutate: (content: string) =>
        content.replace(
          `${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-copy"`,
          `${COMPONENT_SOURCE_NODE_ID_ATTR}="inner-label"`,
        ),
    },
  ])("refuses restore with $label before clearing pointers", ({ mutate }) => {
    const { original, deleted, current } = nestedDocuments();
    const malformed = current.map((document) =>
      document.source.fileId === "file-instance"
        ? { ...document, content: mutate(document.content) }
        : document,
    );
    const restored = restoreComponentMain({
      documents: malformed,
      archived: original[0]!,
      archive: deleted.archive,
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "invalid-reference",
    });
    expect(restored).not.toHaveProperty("changes");
    expect(
      malformed.find((document) => document.source.fileId === "file-main")
        ?.content,
    ).not.toContain(`data-agent-native-node-id="outer-main"`);
    expect(
      malformed.find((document) => document.source.fileId === "file-instance")
        ?.content,
    ).toContain(COMPONENT_ARCHIVE_ATTR);
  });

  it("refuses a stale preimage and a missing restore parent", () => {
    const original = documents();
    const stale = deleteComponentMain({
      documents: original,
      target: { fileId: "file-main", nodeId: "main-root" },
      archive: {
        schemaVersion: 1,
        versionId: "version-1",
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash("stale"),
      },
    });
    expect(stale).toMatchObject({
      status: "refused",
      reason: "source-hash-mismatch",
    });

    const nestedOriginal = documents(
      `<body><section data-agent-native-node-id="main-parent">${main}</section></body>`,
    );
    const nestedDelete = deleteComponentMain({
      documents: nestedOriginal,
      target: { fileId: "file-main", nodeId: "main-root" },
      archive: {
        schemaVersion: 1,
        versionId: "version-nested",
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(nestedOriginal[0]!.content),
      },
    });
    if (nestedDelete.status !== "updated") {
      throw new Error(
        `Expected nested deletion to update: ${nestedDelete.message}`,
      );
    }
    const nestedAfterByFile = new Map(
      nestedDelete.changes.map((change) => [change.fileId, change.after]),
    );
    const missingParent = nestedOriginal.map((document, index) =>
      index === 0
        ? { ...document, content: "<body></body>" }
        : {
            ...document,
            content:
              nestedAfterByFile.get(document.source.fileId!) ??
              document.content,
          },
    );
    const restored = restoreComponentMain({
      documents: missingParent,
      archived: nestedOriginal[0]!,
      archive: nestedDelete.archive,
    });
    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it("rebases a missing parent to the document root from exact deletion geometry", () => {
    const original = documents(
      `<body><section data-agent-native-node-id="main-parent">${main}</section></body>`,
    );
    const deleted = deleteComponentMain({
      documents: original,
      target: { fileId: "file-main", nodeId: "main-root" },
      archive: {
        schemaVersion: 1,
        versionId: "version-root-rebase",
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
      },
    });
    if (deleted.status !== "updated") {
      throw new Error(`Expected nested deletion to update: ${deleted.message}`);
    }
    const deletedByFile = new Map(
      deleted.changes.map((change) => [change.fileId, change.after]),
    );
    const current = original.map((document, index) =>
      index === 0
        ? { ...document, content: "<body></body>" }
        : {
            ...document,
            content:
              deletedByFile.get(document.source.fileId!) ?? document.content,
          },
    );
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: -145, y: -171, width: 100, height: 70 },
        worldBounds: {
          left: -145,
          top: -171,
          right: -45,
          bottom: -101,
          width: 100,
          height: 70,
          centerX: -95,
          centerY: -136,
        },
      },
    });

    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    const restoredContent = restored.changes.find(
      (change) => change.fileId === "file-main",
    )?.after;
    expect(restoredContent).toContain(
      'style="position:absolute;left:-145px;top:-171px;width:100px;height:70px;"',
    );
    expect(restoredContent).not.toContain(
      'data-agent-native-node-id="main-parent"',
    );
  });

  it("rejects malformed opaque pointers without treating them as absent", () => {
    const pointer: ComponentArchivePointer = {
      schemaVersion: 1,
      versionId: "version-1",
      fileId: "file-main",
      componentId: "cmp-card",
      mainNodeId: "main-root",
      sourceVersionHash: "hash",
    };
    expect(
      readComponentArchivePointer(encodeComponentArchivePointer(pointer)),
    ).toEqual({
      status: "valid",
      pointer,
    });
    expect(readComponentArchivePointer(encodeURIComponent("{}"))).toEqual({
      status: "invalid",
      reason: "invalid-pointer-shape",
    });
  });
});
