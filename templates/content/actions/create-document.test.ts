import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLocalFileDocument: vi.fn(),
  getRequestUserEmail: vi.fn(),
  isContentLocalFileMode: vi.fn(),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: vi.fn(() => null),
  getRequestUserEmail: mocks.getRequestUserEmail,
}));

vi.mock("./_local-file-documents.js", () => ({
  createLocalFileDocument: mocks.createLocalFileDocument,
  isContentLocalFileMode: mocks.isContentLocalFileMode,
}));

import createDocument from "./create-document";

const OLD_AGENT_USER_EMAIL = process.env.AGENT_USER_EMAIL;

beforeEach(() => {
  if (OLD_AGENT_USER_EMAIL === undefined) {
    delete process.env.AGENT_USER_EMAIL;
  } else {
    process.env.AGENT_USER_EMAIL = OLD_AGENT_USER_EMAIL;
  }
  mocks.createLocalFileDocument.mockReset();
  mocks.getRequestUserEmail.mockReset();
  mocks.isContentLocalFileMode.mockReset();
  mocks.writeAppState.mockReset();
});

describe("create-document", () => {
  it("preflights app-state identity before writing local files", async () => {
    delete process.env.AGENT_USER_EMAIL;
    mocks.getRequestUserEmail.mockReturnValue(null);
    mocks.isContentLocalFileMode.mockResolvedValue(true);

    await expect(createDocument.run({ title: "Ghost" })).rejects.toThrow(
      "Application state access requires an authenticated request context or AGENT_USER_EMAIL env var",
    );

    expect(mocks.createLocalFileDocument).not.toHaveBeenCalled();
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });
});
