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

  it("adds a scoped agent token without changing the meeting id parameter", () => {
    expect(
      publicMeetingUrl(
        "meeting-1",
        "https://clips.example.com",
        "/workspace/clips",
        "token+1",
      ),
    ).toBe(
      "https://clips.example.com/workspace/clips/api/public-meeting?id=meeting-1&agent_access=token%2B1",
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

  it("forwards a scoped agent token to the access-checked endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        meeting: { id: "private-meeting", title: "Private sync" },
        viewer: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchPublicMeeting("private-meeting", {
      origin: "https://clips.example.com",
      basePath: "/clips",
      agentAccessToken: "meeting-token",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clips.example.com/clips/api/public-meeting?id=private-meeting&agent_access=meeting-token",
      { signal: undefined },
    );
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
