import { beforeEach, describe, expect, it, vi } from "vitest";

const mockTrack = vi.hoisted(() => vi.fn());
const mockFlushTracking = vi.hoisted(() => vi.fn(async () => []));

vi.mock("../tracking/registry.js", () => ({
  track: mockTrack,
  flushTracking: mockFlushTracking,
}));
vi.mock("../app-config/index.js", () => ({
  getAppConfig: () => ({ app: { slug: "test-app" } }),
}));

import { trackDomainJoined } from "./track-domain-joined.js";

const input = {
  email: "member@example.test",
  orgId: "org-1",
  federated: false,
};

describe("trackDomainJoined", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("tracks org_domain_joined under the member's email and flushes", async () => {
    await trackDomainJoined(input);

    expect(mockTrack).toHaveBeenCalledWith(
      "org_domain_joined",
      {
        app: "test-app",
        template: "test-app",
        org_id: "org-1",
        role: "member",
        federated: false,
      },
      { userId: "member@example.test" },
    );
    expect(mockFlushTracking).toHaveBeenCalledTimes(1);
  });

  it("registers the telemetry promise with the event's waitUntil when present", () => {
    const waitUntil = vi.fn();
    const event = { waitUntil } as any;

    const result = trackDomainJoined({ ...input, event });

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledWith(result);
  });

  it("resolves fail-open when tracking throws", async () => {
    mockTrack.mockImplementationOnce(() => {
      throw new Error("provider down");
    });

    await expect(trackDomainJoined(input)).resolves.toBeUndefined();
  });
});
