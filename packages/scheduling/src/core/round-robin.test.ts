import { describe, it, expect } from "vitest";
import { assignRoundRobin, type HostMetrics } from "./round-robin.js";
import type { Host } from "../shared/index.js";

const host = (email: string, overrides: Partial<Host> = {}): Host => ({
  userEmail: email,
  eventTypeId: "et_1",
  isFixed: false,
  weight: 1,
  priority: 2,
  ...overrides,
});

describe("assignRoundRobin", () => {
  it("returns null with no non-fixed hosts", () => {
    const result = assignRoundRobin({
      hosts: [host("a@x.com", { isFixed: true })],
      metrics: new Map(),
      strategy: "lowest-recent-bookings",
    });
    expect(result).toBeNull();
  });

  it("lowest-recent-bookings picks the host with fewest recent bookings", () => {
    const hosts = [host("a@x.com"), host("b@x.com"), host("c@x.com")];
    const metrics = new Map<string, HostMetrics>([
      ["a@x.com", { recentBookingCount: 5, noShowRate: 0 }],
      ["b@x.com", { recentBookingCount: 1, noShowRate: 0 }],
      ["c@x.com", { recentBookingCount: 3, noShowRate: 0 }],
    ]);
    const result = assignRoundRobin({
      hosts,
      metrics,
      strategy: "lowest-recent-bookings",
    });
    expect(result?.userEmail).toBe("b@x.com");
  });

  it("breaks ties by priority then weight then email", () => {
    const hosts = [
      host("a@x.com", { priority: 2, weight: 1 }),
      host("b@x.com", { priority: 1, weight: 1 }),
      host("c@x.com", { priority: 1, weight: 5 }),
    ];
    const metrics = new Map<string, HostMetrics>([
      ["a@x.com", { recentBookingCount: 0, noShowRate: 0 }],
      ["b@x.com", { recentBookingCount: 0, noShowRate: 0 }],
      ["c@x.com", { recentBookingCount: 0, noShowRate: 0 }],
    ]);
    const result = assignRoundRobin({
      hosts,
      metrics,
      strategy: "lowest-recent-bookings",
    });
    // priority 1 > priority 2; within priority 1, weight 5 > weight 1
    expect(result?.userEmail).toBe("c@x.com");
  });

  it("excludes out-of-office hosts", () => {
    const hosts = [host("a@x.com"), host("b@x.com")];
    const metrics = new Map<string, HostMetrics>([
      ["a@x.com", { recentBookingCount: 0, noShowRate: 0 }],
      ["b@x.com", { recentBookingCount: 10, noShowRate: 0 }],
    ]);
    const result = assignRoundRobin({
      hosts,
      metrics,
      excludeEmails: new Set(["a@x.com"]),
      strategy: "lowest-recent-bookings",
    });
    expect(result?.userEmail).toBe("b@x.com");
  });

  it("weighted pick is deterministic given the same seed", () => {
    const hosts = [
      host("a@x.com", { weight: 1 }),
      host("b@x.com", { weight: 3 }),
      host("c@x.com", { weight: 1 }),
    ];
    const metrics = new Map();
    const r1 = assignRoundRobin({
      hosts,
      metrics,
      strategy: "weighted",
      seed: 12345,
    });
    const r2 = assignRoundRobin({
      hosts,
      metrics,
      strategy: "weighted",
      seed: 12345,
    });
    expect(r1?.userEmail).toBe(r2?.userEmail);
  });
});
