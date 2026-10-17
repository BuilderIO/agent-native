import { ActionContractError } from "@agent-native/core/action";
import { ForbiddenError } from "@agent-native/core/sharing";
import { H3Event } from "h3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  moveDocument: vi.fn(),
}));
vi.mock("@agent-native/core/server", () => ({
  getSession: mocks.getSession,
  runWithRequestContext: (_context: unknown, run: () => unknown) => run(),
}));
vi.mock("../../../../../actions/move-document.js", () => ({
  default: { run: mocks.moveDocument },
}));

import handler from "./move.patch.js";

function patch(id: string, body: unknown) {
  const event = new H3Event(
    new Request(`https://content.example.test/api/documents/${id}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  event.context.params = { id };
  return handler(event);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue({
    email: "owner@example.test",
    orgId: "org-1",
  });
});

describe("Content REST page move", () => {
  it("moves the page through move-document, which holds the page-tree locks", async () => {
    mocks.moveDocument.mockResolvedValue({ id: "page-1", parentId: "page-2" });
    await expect(patch("page-1", { parentId: "page-2" })).resolves.toEqual({
      id: "page-1",
      parentId: "page-2",
    });
    expect(mocks.moveDocument).toHaveBeenCalledWith(
      { id: "page-1", parentId: "page-2", position: undefined },
      {
        caller: "http",
        userEmail: "owner@example.test",
        orgId: "org-1",
        actionName: "move-document",
      },
    );
  });

  it("passes a position-only move to move-document as a sibling index", async () => {
    mocks.moveDocument.mockResolvedValue({ id: "page-1", position: 2 });
    await expect(patch("page-1", { position: 2 })).resolves.toEqual({
      id: "page-1",
      position: 2,
    });
    expect(mocks.moveDocument).toHaveBeenCalledWith(
      { id: "page-1", parentId: undefined, position: 2 },
      expect.objectContaining({ caller: "http" }),
    );
  });

  it("keeps move-document's status, message and code on a typed refusal", async () => {
    mocks.moveDocument.mockRejectedValue(
      new ActionContractError("A document cannot be moved under itself", {
        errorCode: "DOCUMENT_MOVE_UNDER_DESCENDANT",
        statusCode: 400,
      }),
    );
    await expect(patch("page-1", { parentId: "page-1" })).rejects.toMatchObject(
      {
        statusCode: 400,
        message: "A document cannot be moved under itself",
        data: { errorCode: "DOCUMENT_MOVE_UNDER_DESCENDANT" },
      },
    );
  });

  it("reports a parent with another owner as 409, as move-document does", async () => {
    mocks.moveDocument.mockRejectedValue(
      new ActionContractError("Parent document must belong to the same owner", {
        errorCode: "PARENT_OWNER_MISMATCH",
        statusCode: 409,
      }),
    );
    await expect(patch("page-1", { parentId: "page-2" })).rejects.toMatchObject(
      {
        statusCode: 409,
        message: "Parent document must belong to the same owner",
        data: { errorCode: "PARENT_OWNER_MISMATCH" },
      },
    );
  });

  it("keeps an access refusal's status and message", async () => {
    mocks.moveDocument.mockRejectedValue(
      new ForbiddenError("Requires editor role on document page-2"),
    );
    await expect(patch("page-1", { parentId: "page-2" })).rejects.toMatchObject(
      {
        statusCode: 403,
        message: "Requires editor role on document page-2",
      },
    );
  });

  it("passes a server error through unchanged", async () => {
    const failure = new Error("Failed query");
    mocks.moveDocument.mockRejectedValue(failure);
    await expect(patch("page-1", { parentId: "page-2" })).rejects.toBe(failure);
  });

  it("refuses a body with neither parentId nor position", async () => {
    await expect(patch("page-1", {})).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mocks.moveDocument).not.toHaveBeenCalled();
  });

  it("refuses a signed-out request", async () => {
    mocks.getSession.mockResolvedValue(null);
    await expect(patch("page-1", { position: 0 })).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mocks.moveDocument).not.toHaveBeenCalled();
  });
});
