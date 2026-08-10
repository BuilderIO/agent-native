import { beforeEach, describe, expect, it, vi } from "vitest";

const { ssrfSafeFetchMock, urlSafetyFactory } = vi.hoisted(() => {
  const fetchMock = vi.fn();
  return {
    ssrfSafeFetchMock: fetchMock,
    // core maps `tools/url-safety` and `extensions/url-safety` to the same
    // file, so once its dist exists both specifiers resolve to one path and
    // only one of these registrations survives. Both must return the full
    // export set, or the surviving factory leaves the other's imports
    // undefined and the fetcher fails as if the URL were rejected.
    urlSafetyFactory: () => ({
      isBlockedToolUrl: () => false,
      ssrfSafeFetch: fetchMock,
    }),
  };
});

vi.mock("@agent-native/core/extensions/url-safety", urlSafetyFactory);

vi.mock("@agent-native/core/tools/url-safety", urlSafetyFactory);

import { fetchICalEvents } from "./ical-fetcher.js";

const args = [
  "feed-1",
  "Team calendar",
  "https://calendar.example.test/team.ics",
  "blue",
  "2026-07-13T00:00:00.000Z",
  "2026-07-20T00:00:00.000Z",
] as const;

describe("strict ICS inventory reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("distinguishes a valid empty feed from a failed request", async () => {
    ssrfSafeFetchMock.mockResolvedValueOnce({
      ok: true,
      text: async () => "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
    });
    await expect(
      fetchICalEvents(...args, { throwOnError: true }),
    ).resolves.toEqual([]);

    ssrfSafeFetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(
      fetchICalEvents(...args, { throwOnError: true }),
    ).rejects.toThrow("ICS feed request failed");
  });

  it("preserves graceful legacy degradation", async () => {
    ssrfSafeFetchMock.mockRejectedValueOnce(new Error("network unavailable"));
    await expect(fetchICalEvents(...args)).resolves.toEqual([]);
  });
});
