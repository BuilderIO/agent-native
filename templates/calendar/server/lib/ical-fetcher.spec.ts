import { beforeEach, describe, expect, it, vi } from "vitest";

const ssrfSafeFetchMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@agent-native/core/tools/url-safety", () => ({
  isBlockedToolUrl: () => false,
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

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
