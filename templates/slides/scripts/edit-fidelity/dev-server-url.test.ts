import { expect, it } from "vitest";

import { devServerListeningUrl } from "./dev-server-url.ts";

it("follows the port the server hopped to", () => {
  const log = [
    "Port 49256 is in use, trying another one...",
    "[agent-native] Slides listening on http://localhost:49257/ (root: /repo/templates/slides)",
    "[agent-native] Port 49256 was in use; listening on 49257 instead — the URL above is the real one.",
  ].join("\n");
  expect(devServerListeningUrl(log)).toBe("http://localhost:49257");
});

it("keeps a mounted base path", () => {
  expect(
    devServerListeningUrl(
      "[agent-native] Slides listening on https://[::1]:47131/slides/ (root: /app)\n",
    ),
  ).toBe("https://[::1]:47131/slides");
});

it("uses the latest banner after a restart", () => {
  const log = [
    "[agent-native] Slides listening on http://localhost:49257/ (root: /app)",
    "[agent-native] Slides listening on http://localhost:49258/ (root: /app)",
  ].join("\n");
  expect(devServerListeningUrl(log)).toBe("http://localhost:49258");
});

it("reports nothing before the server is listening", () => {
  expect(
    devServerListeningUrl("Port 49256 is in use, trying another one...\n"),
  ).toBeUndefined();
});
