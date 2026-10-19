import { afterEach, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/api-path", () => ({
  appBasePath: () => "",
}));

vi.mock("@agent-native/core/client/host", () => ({
  ensureEmbedAuthFetchInterceptor: vi.fn(),
}));

import { uploadPromptFiles } from "./prompt-file-uploads";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("limits concurrent large reference-file fallback uploads", async () => {
  const files = Array.from(
    { length: 3 },
    (_, index) =>
      new File([new Uint8Array(4 * 1024 * 1024 + 1)], `large-${index}.fig`, {
        type: "application/octet-stream",
      }),
  );
  let activeUploads = 0;
  let maxConcurrentUploads = 0;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (
        url.endsWith(
          "/_agent-native/actions/get-slides-2-upload-storage-status",
        )
      ) {
        return Response.json({ referenceStorageReady: true });
      }
      if (url.endsWith("/api/uploads-chunked/start")) {
        return Response.json({ uploadMode: "multipart" });
      }
      if (url.endsWith("/api/uploads")) {
        const file = (init?.body as FormData).get("files") as File;
        activeUploads += 1;
        maxConcurrentUploads = Math.max(maxConcurrentUploads, activeUploads);
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeUploads -= 1;
        return Response.json([
          {
            path: `/uploads/${file.name}`,
            originalName: file.name,
            filename: file.name,
            type: file.type,
            size: file.size,
          },
        ]);
      }
      throw new Error(`Unexpected upload URL: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    uploadPromptFiles(files, "Storage unavailable"),
  ).resolves.toHaveLength(files.length);

  expect(maxConcurrentUploads).toBe(1);
  expect(
    fetchMock.mock.calls.filter(([input]) =>
      String(input).endsWith("/api/uploads-chunked/start"),
    ),
  ).toHaveLength(files.length);
});
