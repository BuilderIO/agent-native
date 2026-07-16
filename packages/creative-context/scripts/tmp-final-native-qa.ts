import {
  readAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { closeDbExec } from "@agent-native/core/db";
import {
  actionsToEngineTools,
  runWithRequestContext,
} from "@agent-native/core/server";
import { eq } from "drizzle-orm";

import { configureCreativeContext } from "../src/server/index.js";
import {
  createContextSource,
  createContextPack,
  getContextPack,
  getCreativeContextItem,
  ingestItems,
  listContextSources,
} from "../src/store/index.js";

const [mode, app, email, itemIdArg, versionIdArg] = process.argv.slice(2);
if (!mode || !app || !email || !["slides", "design"].includes(app)) {
  throw new Error(
    "Usage: <seed-v1|seed-v2|clone> <slides|design> <email> [itemId versionId]",
  );
}

configureCreativeContext();

function artifact(version: 1 | 2) {
  if (app === "slides") {
    const content = `<div class="fmd-slide google-slides-native" data-source-slide-id="qa-slide" style="position:relative;width:960px;height:540px;background:#ffffff"><div class="gslide-shape" data-source-object-id="qa-card" style="position:absolute;left:120px;top:140px;width:720px;height:240px;background:#4f46e5;color:#ffffff"><p style="margin:0;padding:72px 48px;font-size:42px">Final Native Slide V${version}</p></div></div>`;
    return {
      externalId: "qa-presentation:qa-slide",
      kind: "google-slides-slide",
      title: `Final Native Slide V${version}`,
      mimeType: "text/html",
      content,
      contentHash: `final-native-slide-v${version}`,
      sourceVersion: `qa-revision-${version}`,
      provenance: {
        provider: "google-slides",
        compiler: "@agent-native/creative-context:google-slides-native",
      },
      metadata: {
        nativeArtifact: {
          schemaVersion: 1,
          app: "slides",
          format: "slides-html",
          rootExternalId: "qa-presentation:qa-slide",
          sourceBounds: { x: 0, y: 0, width: 960, height: 540 },
          fidelityReport: {
            exact: { count: 2 },
            approximated: { count: 0, reasons: [] },
            imageFallback: { count: 0, reasons: [] },
          },
        },
      },
      chunks: [
        {
          ordinal: 0,
          kind: "slides-native-lexical",
          text: `FinalNativeToken slide gslide-shape card V${version}`,
          metadata: { role: "code-tokens", format: "slides-html" },
        },
      ],
    };
  }
  const content = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%}.qa-frame{width:960px;height:640px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center}.qa-card{padding:48px;border-radius:24px;background:#7c3aed;font:700 44px system-ui}</style></head><body><div class="qa-frame"><div class="qa-card"><p>Final Native Design V${version}</p></div></div></body></html>`;
  return {
    externalId: "qa-figma-file:qa-frame",
    kind: "figma-frame",
    title: `Final Native Design V${version}`,
    mimeType: "text/html",
    content,
    contentHash: `final-native-design-v${version}`,
    sourceVersion: `qa-figma-version-${version}`,
    provenance: {
      provider: "figma",
      compiler: "@agent-native/core/ingestion:figma-node-to-html",
    },
    metadata: {
      nativeArtifact: {
        schemaVersion: 1,
        app: "design",
        format: "design-html",
        rootExternalId: "qa-figma-file:qa-frame",
        sourceBounds: { x: 0, y: 0, width: 960, height: 640 },
        fidelityReport: {
          exact: { count: 3 },
          approximated: { count: 0, reasons: [] },
          imageFallback: { count: 0, reasons: [] },
        },
      },
    },
    chunks: [
      {
        ordinal: 0,
        kind: "code",
        text: `FinalNativeToken qa-frame qa-card align-items center V${version}`,
        metadata: { role: "code-tokens", format: "design-html" },
      },
    ],
  };
}

const result = await runWithRequestContext(
  { userEmail: email, orgId: null },
  async () => {
    if (mode === "seed-v1" || mode === "seed-v2") {
      const version = mode === "seed-v1" ? 1 : 2;
      const listed = await listContextSources({ kind: "manual", limit: 100 });
      const source =
        listed.sources.find((entry) => entry.name === `Final Live ${app}`) ??
        (await createContextSource({
          name: `Final Live ${app}`,
          kind: "manual",
          config: { purpose: "final-native-live-qa" },
          upstreamAccess: "available",
        }));
      const ingested = await ingestItems({
        sourceId: source.id,
        items: [artifact(version)],
      });
      const item = await getCreativeContextItem(ingested.itemIds[0]!);
      return {
        mode,
        app,
        sourceId: source.id,
        itemId: item!.item.id,
        itemVersionId: item!.version.id,
        content: item!.version.content,
        versionNumber: item!.version.versionNumber,
      };
    }

    if (!itemIdArg || !versionIdArg) {
      throw new Error("clone requires itemId and itemVersionId");
    }
    await writeAppState("creative-context", {
      contextMode: "auto",
      currentPackId: null,
      pinnedPackId: null,
    });
    const source = await getCreativeContextItem(itemIdArg, versionIdArg);
    if (!source) throw new Error("Pinned source missing");

    if (app === "slides") {
      const [{ default: createDeck }, { default: clone }, { getDb, schema }] =
        await Promise.all([
          import("../../../templates/slides/actions/create-deck.js"),
          import("../../../templates/slides/actions/clone-context-slide.js"),
          import("../../../templates/slides/server/db/index.js"),
        ]);
      const catalog = actionsToEngineTools({ "clone-context-slide": clone });
      const seedPack = await createContextPack({
        name: "Final native clone target",
        contextMode: "manual",
        members: [
          {
            itemId: itemIdArg,
            itemVersionId: versionIdArg,
            reason: "Create the target deck before exact native reuse",
          },
        ],
      });
      const deck = await createDeck.run({
        title: "Final Native Clone QA",
        slides: [],
        contextPackId: seedPack.id,
        reuseLabels: [],
      });
      const cloned = await clone.run({
        deckId: deck.id,
        itemId: itemIdArg,
        itemVersionId: versionIdArg,
        slideId: "qa-cloned-slide",
      });
      const [row] = await getDb()
        .select()
        .from(schema.decks)
        .where(eq(schema.decks.id, deck.id));
      const stored = JSON.parse(row!.data);
      const storedSlide = stored.slides.find(
        (entry: { id: string }) => entry.id === "qa-cloned-slide",
      );
      const pack = await getContextPack(cloned.contextPackId);
      await writeAppState("creative-context", {
        contextMode: "off",
        currentPackId: cloned.contextPackId,
        pinnedPackId: null,
      });
      let offError = "";
      try {
        await clone.run({
          deckId: deck.id,
          itemId: itemIdArg,
          itemVersionId: versionIdArg,
        });
      } catch (error) {
        offError = error instanceof Error ? error.message : String(error);
      }
      await writeAppState("creative-context", {
        contextMode: "auto",
        currentPackId: cloned.contextPackId,
        pinnedPackId: null,
      });
      return {
        mode,
        app,
        catalogNames: catalog.map((entry) => entry.name),
        targetId: deck.id,
        openPath: `/deck/${deck.id}`,
        cloneResult: cloned,
        storedContent: storedSlide?.content,
        exactContent: storedSlide?.content === source.version.content,
        packMembers: pack?.members.map((entry) => ({
          itemId: entry.itemId,
          itemVersionId: entry.itemVersionId,
        })),
        offError,
        finalState: await readAppState("creative-context"),
      };
    }

    const [{ default: createDesign }, { default: clone }, { getDb, schema }] =
      await Promise.all([
        import("../../../templates/design/actions/create-design.js"),
        import("../../../templates/design/actions/clone-creative-context-design.js"),
        import("../../../templates/design/server/db/index.js"),
      ]);
    const catalog = actionsToEngineTools({
      "clone-creative-context-design": clone,
    });
    const design = await createDesign.run({
      title: "Final Native Clone QA",
      projectType: "prototype",
    });
    const cloned = await clone.run({
      designId: design.id,
      itemId: itemIdArg,
      itemVersionId: versionIdArg,
    });
    const fileId = cloned.files[0]!.id;
    const [storedFile] = await getDb()
      .select()
      .from(schema.designFiles)
      .where(eq(schema.designFiles.id, fileId));
    const pack = await getContextPack(cloned.contextPackId);
    await writeAppState("creative-context", {
      contextMode: "off",
      currentPackId: cloned.contextPackId,
      pinnedPackId: null,
    });
    let offError = "";
    try {
      await clone.run({
        designId: design.id,
        itemId: itemIdArg,
        itemVersionId: versionIdArg,
      });
    } catch (error) {
      offError = error instanceof Error ? error.message : String(error);
    }
    await writeAppState("creative-context", {
      contextMode: "auto",
      currentPackId: cloned.contextPackId,
      pinnedPackId: null,
    });
    return {
      mode,
      app,
      catalogNames: catalog.map((entry) => entry.name),
      targetId: design.id,
      openPath: `/design/${design.id}`,
      cloneResult: cloned,
      storedContent: storedFile?.content,
      exactContent: storedFile?.content === source.version.content,
      packMembers: pack?.members.map((entry) => ({
        itemId: entry.itemId,
        itemVersionId: entry.itemVersionId,
      })),
      offError,
      finalState: await readAppState("creative-context"),
    };
  },
);

console.log(`QA_JSON=${JSON.stringify(result)}`);
await closeDbExec();
