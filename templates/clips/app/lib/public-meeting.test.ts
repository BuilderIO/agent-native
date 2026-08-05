import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchPublicMeeting, publicMeetingUrl } from "./public-meeting";

describe("public meeting client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a mount-aware public meeting URL", () => {
    expect(
      publicMeetingUrl(
        "meeting id/with spaces",
        "https://clips.example.com",
        "/workspace/clips",
      ),
    ).toBe(
      "https://clips.example.com/workspace/clips/api/public-meeting?id=meeting+id%2Fwith+spaces",
    );
  });

  it("fetches and parses the access-checked meeting payload", async () => {
    const signal = new AbortController().signal;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        meeting: { id: "meeting-1", title: "Weekly sync" },
        viewer: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPublicMeeting("meeting-1", {
      signal,
      origin: "https://clips.example.com",
      basePath: "",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clips.example.com/api/public-meeting?id=meeting-1",
      { signal },
    );
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: { meeting: { id: "meeting-1" } },
    });
  });

  it("preserves inaccessible response status and error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: vi.fn().mockResolvedValue({ error: "Not found" }),
      }),
    );

    await expect(
      fetchPublicMeeting("private-meeting", {
        origin: "https://clips.example.com",
        basePath: "",
      }),
    ).resolves.toEqual({
      ok: false,
      status: 404,
      data: { error: "Not found" },
    });
  });
});
