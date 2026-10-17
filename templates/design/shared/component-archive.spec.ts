// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { emptyBoardHtml } from "./board-file";
import { ensureCodeLayerNodeIdsInHtml } from "./code-layer";
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
import {
  buildGroupRuntimeScriptTag,
  GROUP_RUNTIME_ATTR,
  GROUP_RUNTIME_VERSION,
} from "./group-runtime";
import { LEGACY_GROUP_RUNTIME_V1_SOURCE } from "./group-runtime-legacy-v1";
import { sourceContentHash } from "./source-workspace";

const source = (fileId: string, filename = `${fileId}.html`) => ({
  kind: "design-file" as const,
  designId: "design-1",
  fileId,
  filename,
});

const mainMarkup = `<main data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="cmp-card"><h2 data-agent-native-node-id="main-title">Title</h2><p data-agent-native-node-id="main-subtitle">Subtitle</p></main>`;
const main = `${mainMarkup}<div data-agent-native-node-id="between">Between</div>`;
const overrides = encodeURIComponent(
  JSON.stringify([{ sourceNodeId: "main-subtitle", property: "textContent" }]),
);
const instance = `<main data-agent-native-node-id="instance-root" data-agent-native-component="Card copy" ${COMPONENT_REF_ATTR}="cmp-card"><h2 data-agent-native-node-id="instance-title" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-title">Title</h2><p data-agent-native-node-id="instance-subtitle" ${COMPONENT_SOURCE_NODE_ID_ATTR}="main-subtitle" ${COMPONENT_OVERRIDES_ATTR}="${overrides}">Instance override</p></main>`;

function documents(
  mainContent = `<body>${main}</body>`,
  mainFilename = "file-main.html",
) {
  return [
    { source: source("file-main", mainFilename), content: mainContent },
    { source: source("file-instance"), content: `<body>${instance}</body>` },
  ];
}

function boardContent(bodyMarkup: string): string {
  return emptyBoardHtml().replace(
    "<body>\n</body>",
    `<body>${bodyMarkup}</body>`,
  );
}

function nativeBoardContent(
  bodyMarkup: string,
  runtimeVersion = GROUP_RUNTIME_VERSION,
): string {
  const runtimeSource =
    runtimeVersion === GROUP_RUNTIME_VERSION
      ? buildGroupRuntimeScriptTag()
      : `<script ${GROUP_RUNTIME_ATTR} data-runtime-version="${runtimeVersion}">\n${LEGACY_GROUP_RUNTIME_V1_SOURCE}\n</script>`;
  const withManagedRuntime = boardContent(bodyMarkup).replace(
    "</body>",
    `${runtimeSource}</body>`,
  );
  return ensureCodeLayerNodeIdsInHtml(withManagedRuntime, {
    source: source("file-main"),
  }).content;
}

function missingParentBoardDocuments(
  parentAttributes = "",
  mainAttributes = "",
  native = false,
  runtimeVersion = GROUP_RUNTIME_VERSION,
) {
  const mainWithAttributes = main.replace(
    '<main data-agent-native-node-id="main-root"',
    `<main data-agent-native-node-id="main-root"${mainAttributes}`,
  );
  const original = documents(
    (native
      ? (bodyMarkup: string) => nativeBoardContent(bodyMarkup, runtimeVersion)
      : boardContent)(
      `<section data-agent-native-node-id="main-parent"${parentAttributes}>${mainWithAttributes}</section>`,
    ),
    "__board__.html",
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
    throw new Error(`Expected deletion to update: ${deleted.message}`);
  }
  const deletedByFile = new Map(
    deleted.changes.map((change) => [change.fileId, change.after]),
  );
  const current = original.map((document, index) =>
    index === 0
      ? {
          ...document,
          content: native
            ? nativeBoardContent("", runtimeVersion)
            : emptyBoardHtml(),
        }
      : {
          ...document,
          content:
            deletedByFile.get(document.source.fileId!) ?? document.content,
        },
  );
  return { original, deleted, current };
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
    const { original, deleted, current } = missingParentBoardDocuments();
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
      'style="position:absolute!important;inset:auto!important;right:auto!important;bottom:auto!important;left:-145px!important;top:-171px!important;width:100px!important;height:70px!important;box-sizing:border-box!important;margin:0!important;min-width:0!important;max-width:none!important;min-height:0!important;max-height:none!important;"',
    );
    expect(restoredContent).not.toContain(
      'data-agent-native-node-id="main-parent"',
    );
  });

  it("accepts stamped board roots with managed runtime siblings", () => {
    const { original, deleted, current } = missingParentBoardDocuments(
      "",
      "",
      true,
    );
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    const restoredContent = restored.changes.find(
      (change) => change.fileId === "file-main",
    )?.after;
    expect(restoredContent).toContain(
      'html lang="en" data-agent-native-node-id=',
    );
    expect(restoredContent).toContain("<body data-agent-native-node-id=");
    expect(restoredContent).toContain(
      `<script ${GROUP_RUNTIME_ATTR} data-runtime-version="${GROUP_RUNTIME_VERSION}">`,
    );
  });

  it("accepts stamped board roots with the exact legacy v1 runtime", () => {
    const { original, deleted, current } = missingParentBoardDocuments(
      "",
      "",
      true,
      "1",
    );
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    const restoredContent = restored.changes.find(
      (change) => change.fileId === "file-main",
    )?.after;
    expect(restoredContent).toContain(
      `<script ${GROUP_RUNTIME_ATTR} data-runtime-version="1">`,
    );
    expect(restoredContent).toContain(LEGACY_GROUP_RUNTIME_V1_SOURCE.trim());
  });

  it.each([
    ["a body padding override", "body { padding: 100px; }"],
    ["an html transform override", "html { transform: translateX(10px); }"],
    ["a universal padding override", "* { padding: 100px; }"],
  ])("refuses missing-parent restore with %s", (_label, override) => {
    const { original, deleted, current } = missingParentBoardDocuments();
    current[0] = {
      ...current[0]!,
      content: current[0]!.content.replace(
        "</style>",
        `</style><style>${override}</style>`,
      ),
    };
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it("refuses a board shell whose canonical CSS only appears in a comment", () => {
    const { original, deleted, current } = missingParentBoardDocuments();
    const canonicalStyle = emptyBoardHtml().match(
      /<style>([\s\S]*?)<\/style>/,
    )?.[1];
    expect(canonicalStyle).toBeTruthy();
    current[0] = {
      ...current[0]!,
      content: current[0]!.content.replace(
        canonicalStyle!,
        `/*${canonicalStyle}*/`,
      ),
    };
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it("refuses canonical board rules nested under a media context", () => {
    const { original, deleted, current } = missingParentBoardDocuments();
    const canonicalStyle = emptyBoardHtml().match(
      /<style>([\s\S]*?)<\/style>/,
    )?.[1];
    expect(canonicalStyle).toBeTruthy();
    current[0] = {
      ...current[0]!,
      content: current[0]!.content.replace(
        canonicalStyle!,
        `@media (min-width: 0px) {${canonicalStyle}}`,
      ),
    };
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it("refuses a head stylesheet link that can change the board origin", () => {
    const { original, deleted, current } = missingParentBoardDocuments();
    current[0] = {
      ...current[0]!,
      content: current[0]!.content.replace(
        "</head>",
        '<link rel="stylesheet" href="data:text/css,body{margin:50px!important}"></head>',
      ),
    };
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it("pins the restored border box over authored layout offsets and margins", () => {
    const { original, deleted, current } = missingParentBoardDocuments(
      "",
      ' style="position:relative;inset:9px;left:12px;top:14px;right:4px;bottom:5px;margin:8px 7px 6px 5px;padding:10px;border:2px solid red;box-sizing:content-box;width:20px;height:30px;min-width:12px;max-width:24px;min-height:16px;max-height:32px"',
    );
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    const restoredContent = restored.changes.find(
      (change) => change.fileId === "file-main",
    )?.after;
    expect(restoredContent).toContain(
      'style="position:relative;inset:9px;left:12px;top:14px;right:4px;bottom:5px;margin:8px 7px 6px 5px;padding:10px;border:2px solid red;box-sizing:content-box;width:20px;height:30px;min-width:12px;max-width:24px;min-height:16px;max-height:32px;position:absolute!important;inset:auto!important;right:auto!important;bottom:auto!important;left:20px!important;top:30px!important;width:100px!important;height:70px!important;box-sizing:border-box!important;margin:0!important;min-width:0!important;max-width:none!important;min-height:0!important;max-height:none!important;"',
    );
  });

  it("patches the real style attribute when another attribute contains style=", () => {
    const { original, deleted, current } = missingParentBoardDocuments(
      "",
      ` title='label style="compact"'`,
    );
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored.status).toBe("updated");
    if (restored.status !== "updated") return;
    const restoredContent = restored.changes.find(
      (change) => change.fileId === "file-main",
    )?.after;
    expect(restoredContent).toContain(`title='label style="compact"'`);
    expect(restoredContent).toContain(
      'style="position:absolute!important;inset:auto!important;',
    );
    expect(restoredContent).not.toContain(
      `title='label style="compact;position:absolute`,
    );
  });

  it.each([
    ["translate", "translate:8px 0"],
    ["rotate", "rotate:12deg"],
    ["scale", "scale:2"],
    ["zoom", "zoom:2"],
  ])("refuses missing-parent restore with %s ancestry", (_label, style) => {
    const { original, deleted, current } = missingParentBoardDocuments(
      ` style="${style}"`,
    );
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it.each([
    ["a logical root offset", "inset-inline-start:40px"],
    ["logical padding", "padding-inline-start:40px"],
  ])("refuses root rebase with %s", (_label, declaration) => {
    const { original, deleted, current } = missingParentBoardDocuments();
    current[0] = {
      ...current[0]!,
      content: emptyBoardHtml().replace(
        "<body>",
        `<body style="${declaration}">`,
      ),
    };
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it("refuses missing-parent restore without board world bounds", () => {
    const { original, deleted, current } = missingParentBoardDocuments();
    const restored = restoreComponentMain({
      documents: current,
      archived: original[0]!,
      archive: deleted.archive,
      deletionGeometry: {
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
  });

  it("refuses missing-parent restore for an SVG transform attribute", () => {
    const svgMain = `<svg data-agent-native-node-id="main-root" data-agent-native-component="Card" ${COMPONENT_ID_ATTR}="cmp-card" transform="translate(50 0)"></svg>`;
    const svgInstance = `<svg data-agent-native-node-id="instance-root" data-agent-native-component="Card copy" ${COMPONENT_REF_ATTR}="cmp-card"></svg>`;
    const original = [
      {
        source: source("file-main", "__board__.html"),
        content: boardContent(
          `<section data-agent-native-node-id="main-parent">${svgMain}</section>`,
        ),
      },
      {
        source: source("file-instance"),
        content: `<body>${svgInstance}</body>`,
      },
    ];
    const deleted = deleteComponentMain({
      documents: original,
      target: { fileId: "file-main", nodeId: "main-root" },
      archive: {
        schemaVersion: 1,
        versionId: "version-svg-transform",
        fileId: "file-main",
        mainNodeId: "main-root",
        sourceVersionHash: sourceContentHash(original[0]!.content),
      },
    });
    if (deleted.status !== "updated") {
      throw new Error(`Expected deletion to update: ${deleted.message}`);
    }
    const deletedByFile = new Map(
      deleted.changes.map((change) => [change.fileId, change.after]),
    );
    const current = original.map((document, index) =>
      index === 0
        ? { ...document, content: emptyBoardHtml() }
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
        boundingRect: { x: 20, y: 30, width: 100, height: 70 },
        worldBounds: {
          left: 20,
          top: 30,
          right: 120,
          bottom: 100,
          width: 100,
          height: 70,
          centerX: 70,
          centerY: 65,
        },
      },
    });

    expect(restored).toMatchObject({
      status: "refused",
      reason: "missing-restore-anchor",
    });
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
