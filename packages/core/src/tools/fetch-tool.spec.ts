import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchToolEntry } from "./fetch-tool.js";

describe("createFetchToolEntry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runWebRequest(url: string) {
    const entry = createFetchToolEntry()["web-request"];
    return entry.run({ url });
  }

  it.each([
    "http://localhost:3000/_agent-native/actions/x",
    "http://127.0.0.1:3000/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.2/",
    "http://169.254.169.254/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1.nip.io/",
    "file:///etc/passwd",
  ])("blocks private/internal target %s before fetching", async (url) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(runWebRequest(url)).resolves.toContain(
      "Requests to private/internal addresses are not allowed",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows ordinary external HTTPS requests", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200, statusText: "OK" }));

    await expect(runWebRequest("https://example.com/api")).resolves.toContain(
      "HTTP 200 OK",
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/api",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
