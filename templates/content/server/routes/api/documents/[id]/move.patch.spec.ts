import { ActionContractError } from "@agent-native/core/action";
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

  it("passes move-document's typed refusal through", async () => {
    const refusal = new ActionContractError(
      "A document cannot be moved under itself",
      { errorCode: "DOCUMENT_MOVE_UNDER_DESCENDANT", statusCode: 400 },
    );
    mocks.moveDocument.mockRejectedValue(refusal);
    await expect(patch("page-1", { parentId: "page-1" })).rejects.toBe(refusal);
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
