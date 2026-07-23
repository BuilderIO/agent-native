import { beforeEach, describe, expect, it } from "vitest";

import {
  signAskAppTaskHandle,
  verifyAskAppTaskHandle,
} from "./ask-app-task-handle.js";

describe("ask_app task handles", () => {
  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
  });

  const route = {
    app: "content",
    origin: "https://content.example.com/_agent-native/a2a",
    routedVia: "a2a" as const,
    requestOrigin: "https://content.example.com",
  };

  it("round-trips the signed route and remote task id", async () => {
    const handle = await signAskAppTaskHandle({
      issuerApp: "calendar",
      subject: "alice@example.com",
      route,
      taskId: "task-123",
    });

    await expect(
      verifyAskAppTaskHandle(handle, {
        issuerApp: "calendar",
        subject: "alice@example.com",
      }),
    ).resolves.toEqual({ route, taskId: "task-123" });
  });

  it.each([
    ["wrong connector", { issuerApp: "mail", subject: "alice@example.com" }],
    ["wrong user", { issuerApp: "calendar", subject: "mallory@example.com" }],
  ])("rejects the %s without exposing claims", async (_label, expected) => {
    const handle = await signAskAppTaskHandle({
      issuerApp: "calendar",
      subject: "alice@example.com",
      route,
      taskId: "task-secret",
    });

    await expect(verifyAskAppTaskHandle(handle, expected)).rejects.toThrow(
      /^Invalid or expired ask_app task handle\.$/,
    );
  });

  it("rejects modified and expired handles with the same opaque error", async () => {
    const handle = await signAskAppTaskHandle({
      issuerApp: "calendar",
      subject: "alice@example.com",
      route,
      taskId: "task-secret",
      expiresInSeconds: -1,
    });
    const modified = `${handle.slice(0, -1)}${handle.endsWith("a") ? "b" : "a"}`;

    await expect(
      verifyAskAppTaskHandle(modified, {
        issuerApp: "calendar",
        subject: "alice@example.com",
      }),
    ).rejects.toThrow(/^Invalid or expired ask_app task handle\.$/);
    await expect(
      verifyAskAppTaskHandle(handle, {
        issuerApp: "calendar",
        subject: "alice@example.com",
      }),
    ).rejects.toThrow(/^Invalid or expired ask_app task handle\.$/);
  });
});
