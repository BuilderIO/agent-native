import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createZoomProvider } from "./zoom.js";

describe("createZoomProvider.deleteMeeting", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const getAccessToken = vi.fn(async () => "access-token-example");

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  function provider() {
    return createZoomProvider({
      clientId: "client-id-example",
      clientSecret: "client-secret-example",
      getAccessToken,
    });
  }

  it("deletes a known meeting", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await provider().deleteMeeting!({
      credentialId: "zoom-account-example",
      meetingId: "meeting-id-example",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.zoom.us/v2/meetings/meeting-id-example",
      {
        method: "DELETE",
        headers: { authorization: "Bearer access-token-example" },
      },
    );
  });

  it("treats an already-missing meeting as deleted", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      provider().deleteMeeting!({
        credentialId: "zoom-account-example",
        meetingId: "missing-meeting-example",
      }),
    ).resolves.toBeUndefined();
  });

  it("preserves a booking when Zoom rejects meeting deletion", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    await expect(
      provider().deleteMeeting!({
        credentialId: "zoom-account-example",
        meetingId: "meeting-id-example",
      }),
    ).rejects.toThrow("Zoom meeting deletion failed: 503");
  });

  it("requires a credential before deleting a meeting", async () => {
    await expect(
      provider().deleteMeeting!({ meetingId: "meeting-id-example" }),
    ).rejects.toThrow("Zoom requires credentialId");
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
