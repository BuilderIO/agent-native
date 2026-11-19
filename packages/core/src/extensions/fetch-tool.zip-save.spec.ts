import { afterEach, expect, it, vi } from "vitest";

import { runWithRequestContext } from "../server/request-context.js";
import { createFetchToolEntry } from "./fetch-tool.js";

const writeWorkspaceFile = vi.hoisted(() => vi.fn());

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

vi.mock("../workspace-files/store.js", () => ({
  SAVE_TO_FILE_MAX_BYTES: 20 * 1024 * 1024,
  isScratchWorkspacePath: (path: string) =>
    path === "scratch" || path.startsWith("scratch/"),
  toWorkspaceFileCard: (meta: unknown) => ({ meta }),
  writeWorkspaceFile,
}));

afterEach(() => {
  vi.restoreAllMocks();
  writeWorkspaceFile.mockReset();
});

it("rejects ZIP bytes mislabeled as text before saving or exposing them", async () => {
  const marker = "synthetic-binary-marker";
  writeWorkspaceFile.mockResolvedValue({ id: "workspace-file-1" });
  const body = new Uint8Array([
    ...new TextEncoder().encode(marker),
    80,
    75,
    3,
    4,
    0,
    255,
  ]);
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(body, { headers: { "content-type": "text/plain" } }),
  );

  const request = runWithRequestContext(
    { userEmail: "ada@example.com", orgId: "org-1" },
    () =>
      createFetchToolEntry()["web-request"].run({
        url: "https://example.com/archive",
        saveToFile: "scratch/archive.zip",
      }),
  );
  await expect(request).rejects.toMatchObject({
    errorCode: "web_request_binary_response",
    message: expect.stringContaining("UTF-8 text only"),
  });
  const error = await request.catch((caught: unknown) => caught);
  expect(String(error)).not.toContain(marker);
  expect(writeWorkspaceFile).not.toHaveBeenCalled();
});
