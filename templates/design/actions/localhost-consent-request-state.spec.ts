import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appStateCompareAndSet: vi.fn(),
  appStateGet: vi.fn(),
  assertAccess: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (config: unknown) => config,
}));
vi.mock("@agent-native/core/application-state", () => ({
  appStateCompareAndSet: mocks.appStateCompareAndSet,
  appStateGet: mocks.appStateGet,
}));
vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

import clearAction from "./clear-localhost-write-consent-request.js";
import getAction from "./get-localhost-write-consent-request.js";

it("reads and clears consent requests from the design capability session", async () => {
  const request = {
    designId: "design/public",
    connectionId: "connection-1",
    rootPath: "/workspace",
    files: ["index.html"],
    requestedAt: "2026-09-30T20:00:00.000Z",
  };
  const key = "design-localhost-write-consent-request:design/public";
  const sessionId = "capability:capability:visual-edit:design:design%2Fpublic";
  mocks.assertAccess.mockResolvedValue({ role: "editor" });
  mocks.appStateGet.mockResolvedValue(request);
  mocks.appStateCompareAndSet.mockResolvedValue(true);

  await expect(getAction.run({ designId: request.designId })).resolves.toEqual({
    request,
  });
  await expect(
    clearAction.run({
      designId: request.designId,
      requestedAt: request.requestedAt,
    }),
  ).resolves.toEqual({ cleared: true });

  expect(mocks.assertAccess).toHaveBeenNthCalledWith(
    1,
    "design",
    request.designId,
    "editor",
  );
  expect(mocks.assertAccess).toHaveBeenNthCalledWith(
    2,
    "design",
    request.designId,
    "editor",
  );
  expect(mocks.appStateGet).toHaveBeenNthCalledWith(1, sessionId, key);
  expect(mocks.appStateGet).toHaveBeenNthCalledWith(2, sessionId, key);
  expect(mocks.appStateCompareAndSet).toHaveBeenCalledWith(
    sessionId,
    key,
    request,
    null,
    { requestSource: "agent" },
  );
});
