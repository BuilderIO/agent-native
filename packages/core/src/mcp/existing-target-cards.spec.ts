import { describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE as content } from "../../../../templates/content/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as design } from "../../../../templates/design/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as slides2 } from "../../../../templates/slides-2/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as slides } from "../../../../templates/slides/server/lib/chatgpt-directory-tools.js";
import {
  createMcpDirectoryWidgetWriteCapability,
  normalizeMcpDirectoryWidgetReadActionArguments,
  normalizeMcpDirectoryWidgetWriteActionArguments,
  type McpDirectoryWidgetReadArgument,
} from "../shared/embed-auth.js";
import type { McpDirectoryWidgetTarget } from "./build-server.js";

const cards = [
  {
    appId: "design",
    tool: "generate-screens",
    profile: design,
    args: { designId: "design/from-input" },
    result: { designId: "design/one", path: "/untrusted" },
    path: "/design/design%2Fone?editorView=overview",
    resourceKey: "designId",
    read: "get-design",
    write: "update-design",
    writeArgs: { title: "Updated" },
  },
  {
    appId: "design",
    tool: "export-coding-handoff",
    profile: design,
    args: { id: "design/from-input" },
    result: { designId: "design/one", rawUrl: "https://example.test/raw" },
    path: "/design/design%2Fone",
    resourceKey: "designId",
    read: "get-design",
    write: "update-design",
    writeArgs: { title: "Updated" },
  },
  {
    appId: "slides",
    tool: "clone-context-slide",
    profile: slides,
    args: { deckId: "deck/from-input" },
    result: { deckId: "deck/one", slideId: "cloned-slide", slideNumber: 3 },
    path: "/deck/deck%2Fone?slide=3",
    resourceKey: "deckId",
    read: "get-deck",
    write: "patch-deck",
    writeArgs: {
      operations: [{ op: "patch-deck-fields", fields: { title: "Updated" } }],
    },
  },
  {
    appId: "content",
    tool: "share-local-file-document",
    profile: content,
    args: { id: "local-file:source.md" },
    result: { id: "shared/copy" },
    path: "/page/shared%2Fcopy",
    resourceKey: "documentId",
    read: "get-document",
    write: "update-document",
    writeArgs: { title: "Updated" },
  },
];

describe("existing-resource inline cards", () => {
  it.each(cards)(
    "$appId $tool opens the saved resource and bounds its action arguments",
    ({
      appId,
      tool,
      profile,
      args,
      result,
      path,
      resourceKey,
      read,
      write,
      writeArgs,
    }) => {
      const targets = profile.widgetTargets as Record<
        string,
        (
          args: Record<string, unknown>,
          result: unknown,
        ) => McpDirectoryWidgetTarget | null
      >;
      expect(targets[tool]).toBeTypeOf("function");
      const target = targets[tool]!(args, result)!;
      expect(target.targetPath).toBe(path);
      const resourceId =
        appId === "content"
          ? "shared/copy"
          : appId === "design"
            ? "design/one"
            : "deck/one";
      expect(target.resourceIds[resourceKey]).toBe(resourceId);
      expect(target.writeActions).toContain(write);

      const bind = (map: Record<string, McpDirectoryWidgetReadArgument>) =>
        Object.fromEntries(
          Object.entries(map).map(([key, rule]) => [
            key,
            typeof rule === "string" ? target.resourceIds[rule] : rule,
          ]),
        );
      const readMap = profile.widgetReadActionArguments as Record<
        string,
        Record<string, McpDirectoryWidgetReadArgument>
      >;
      const writeMap = profile.widgetWriteActionArguments as Record<
        string,
        Record<string, McpDirectoryWidgetReadArgument>
      >;
      const resourceUri = `ui://${appId}/existing-target`;
      const identity = { appId, resourceUri, userEmail: "editor@example.test" };
      const scope = createMcpDirectoryWidgetWriteCapability({
        ...identity,
        resourceIds: target.resourceIds,
        expiresAtMs: Date.now() + 60_000,
        readActionArguments: { [read]: bind(readMap[read]!) },
        writeActionArguments: { [write]: bind(writeMap[write]!) },
      });
      expect(scope).toBeDefined();
      const normalizeRead = (
        actionName: string,
        args: Record<string, unknown>,
      ) =>
        normalizeMcpDirectoryWidgetReadActionArguments(scope, {
          ...identity,
          actionName,
          args,
          allowedArgumentNames: Object.keys(readMap[read]!),
        });
      const normalizeWrite = (
        actionName: string,
        args: Record<string, unknown>,
      ) =>
        normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
          ...identity,
          actionName,
          args,
          allowedArgumentNames: Object.keys(writeMap[write]!),
        });
      const readArgs = { id: resourceId };
      const writeIdKey = appId.startsWith("slides") ? "deckId" : "id";
      const allowedWrite = { [writeIdKey]: resourceId, ...writeArgs };
      expect(normalizeRead(read, readArgs)).toEqual(readArgs);
      expect(normalizeWrite(write, allowedWrite)).toEqual(allowedWrite);
      expect(normalizeRead(read, { id: "other-resource" })).toBeUndefined();
      expect(
        normalizeWrite(write, {
          ...allowedWrite,
          [writeIdKey]: "other-resource",
        }),
      ).toBeUndefined();
      expect(normalizeRead("list-documents", readArgs)).toBeUndefined();
      expect(normalizeWrite("delete-document", allowedWrite)).toBeUndefined();
      expect(
        normalizeRead(read, { ...readArgs, undeclared: true }),
      ).toBeUndefined();
      expect(
        normalizeWrite(write, { ...allowedWrite, undeclared: true }),
      ).toBeUndefined();
      expect(targets[tool]!({}, {})).toBeNull();
    },
  );

  it("requires authoritative result IDs for every new card", () => {
    for (const { profile, tool, args } of cards) {
      const targets = profile.widgetTargets as Record<
        string,
        (
          args: Record<string, unknown>,
          result: unknown,
        ) => McpDirectoryWidgetTarget | null
      >;
      for (const result of [
        {},
        null,
        undefined,
        { id: " ", designId: " ", deckId: " " },
      ]) {
        expect(targets[tool]!(args, result)).toBeNull();
      }
    }
  });

  it("requires a valid cloned slide position", () => {
    for (const slideNumber of [
      undefined,
      0,
      -1,
      1.5,
      "3",
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(
        slides.widgetTargets["clone-context-slide"](
          { deckId: "deck" },
          { deckId: "deck", slideNumber },
        ),
      ).toBeNull();
    }
  });

  it("keeps Slides-2 HTML clones on their full-app link", () => {
    expect(slides2.widgetTargets).not.toHaveProperty("clone-context-slide");
  });

  it("never binds Content sharing to the local source or a missing copy", () => {
    expect(
      content.widgetTargets["share-local-file-document"](
        { id: "local-file:source.md" },
        {},
      ),
    ).toBeNull();
  });
});
