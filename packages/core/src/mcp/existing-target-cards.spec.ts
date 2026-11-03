import { describe, expect, it } from "vitest";

import { CHATGPT_DIRECTORY_PROFILE as content } from "../../../../templates/content/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_PROFILE as design } from "../../../../templates/design/server/lib/chatgpt-directory-tools.js";
import { MAIL_CARD_PROFILE as mail } from "../../../../templates/mail/server/lib/mail-card-profile.js";
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
  {
    appId: "mail",
    tool: "manage-draft",
    profile: mail,
    args: { action: "create" },
    result: { id: "draft-1", embed: true, path: "/untrusted" },
    path: "/draft?id=draft-1",
    resourceKey: "draftId",
    read: "get-draft-card",
    write: "manage-draft",
    writeArgs: { action: "update", subject: "Updated" },
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
            : appId === "mail"
              ? "draft-1"
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

  describe("the Mail card", () => {
    const target = mail.widgetTargets["manage-draft"](
      {},
      {
        id: "draft-1",
        embed: true,
      },
    )!;
    const identity = {
      appId: "mail",
      resourceUri: "ui://mail/existing-target",
      userEmail: "editor@example.test",
    };
    const writeRules = mail.widgetWriteActionArguments["manage-draft"];
    const scope = createMcpDirectoryWidgetWriteCapability({
      ...identity,
      resourceIds: target.resourceIds,
      expiresAtMs: Date.now() + 60_000,
      readActionArguments: { "get-draft-card": { id: "draft-1" } },
      writeActionArguments: {
        "manage-draft": Object.fromEntries(
          Object.entries(writeRules).map(([name, rule]) => [
            name,
            typeof rule === "string" ? target.resourceIds[rule]! : rule,
          ]),
        ),
      },
    });
    const write = (actionName: string, args: Record<string, unknown>) =>
      normalizeMcpDirectoryWidgetWriteActionArguments(scope, {
        ...identity,
        actionName,
        args,
        allowedArgumentNames: Object.keys(writeRules),
      });
    const edit = { action: "update", id: "draft-1" };

    it("edits the message's recipients, subject and body", () => {
      const allowed = {
        ...edit,
        expectedRevision: "revision-1",
        to: "a@example.test",
        cc: "b@example.test",
        bcc: "c@example.test",
        subject: "Updated",
        body: "Updated",
      };
      expect(write("manage-draft", allowed)).toEqual(allowed);
    });

    it.each([
      ["deleting it", { action: "delete", id: "draft-1" }],
      ["deleting every draft", { action: "delete-all", id: "draft-1" }],
      ["deleting a saved copy", { action: "delete-saved", id: "draft-1" }],
      ["creating another", { action: "create", id: "draft-1" }],
      ["editing another", { action: "update", id: "draft-2" }],
      ["leaving out the message", { action: "update" }],
      ["changing its account", { ...edit, accountEmail: "o@example.test" }],
      ["pointing it at another thread", { ...edit, replyToThreadId: "t" }],
      ["pointing it at another message", { ...edit, replyToId: "m" }],
      ["changing its kind", { ...edit, mode: "forward" }],
    ])("refuses %s", (_name, args) => {
      expect(write("manage-draft", args)).toBeUndefined();
    });

    it("refuses sending", () => {
      expect(write("send-email", edit)).toBeUndefined();
    });

    it("reads only that message's card", () => {
      const read = (actionName: string, args: Record<string, unknown>) =>
        normalizeMcpDirectoryWidgetReadActionArguments(scope, {
          ...identity,
          actionName,
          args,
          allowedArgumentNames: ["id"],
        });
      expect(read("get-draft-card", { id: "draft-1" })).toEqual({
        id: "draft-1",
      });
      expect(read("get-draft-card", { id: "draft-2" })).toBeUndefined();
      expect(
        read("get-draft-card", {
          id: "draft-1",
          accountEmail: "o@example.test",
        }),
      ).toBeUndefined();
      expect(read("get-thread", { id: "draft-1" })).toBeUndefined();
    });

    it("opens no card for a result that has none", () => {
      const open = mail.widgetTargets["manage-draft"];
      expect(open({ action: "delete" }, "Deleted draft draft-1")).toBeNull();
      expect(open({}, { id: "saved-1", message: "Deleted" })).toBeNull();
    });
  });

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

  it("keeps Slides clones on their full-app link until loading is deck-bound", () => {
    expect(slides.widgetTargets).not.toHaveProperty("clone-context-slide");
    expect(slides.widgetReadActionArguments).not.toHaveProperty(
      "get-deck-access-status",
    );
  });

  // oracle-change: remove tests for the deleted Slides 2 template
  it("never binds Content sharing to the local source or a missing copy", () => {
    expect(
      content.widgetTargets["share-local-file-document"](
        { id: "local-file:source.md" },
        {},
      ),
    ).toBeNull();
  });
});
