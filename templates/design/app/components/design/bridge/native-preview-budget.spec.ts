import { describe, expect, it } from "vitest";

import { planNativePreviewBudget } from "./native-preview-budget";
import { nativePreviewTargetDensity } from "./native-preview-geometry";

type Request = Parameters<typeof planNativePreviewBudget>[0][number];
const request = (id: string, overrides: Partial<Request> = {}): Request => ({
  id,
  width: 800,
  height: 600,
  baseDensity: 1.2,
  desiredDensity: 2.4,
  bytesPerPixel: 108,
  maxDimension: 4096,
  maxPixels: 1_200_000,
  ...overrides,
});
const cost = (entry: Request, density: number): number =>
  (Math.ceil(entry.width * density) + 6) *
  (Math.ceil(entry.height * density) + 6) *
  entry.bytesPerPixel;

describe("planNativePreviewBudget", () => {
  it("keeps small SVGs at screen density while sharing the remaining zoom budget", () => {
    const requests = [
      request("main-metal"),
      request("new-metal", { width: 622, height: 241 }),
      request("glass-panel", { width: 320, height: 200, bytesPerPixel: 120 }),
      request("photo", { width: 256, height: 256 }),
      request("mesh-svg", { width: 160, height: 19, bytesPerPixel: 100 }),
      request("metal-svg", { width: 160, height: 19 }),
      request("glass-svg", { width: 640, height: 76, bytesPerPixel: 120 }),
      request("offscreen-a", { width: 256, height: 256, desiredDensity: 1.2 }),
      request("offscreen-b", { width: 320, height: 200, desiredDensity: 1.2 }),
    ];
    const available = 220 * 1024 * 1024;
    const plan = planNativePreviewBudget(requests, available);
    expect(plan.get("mesh-svg")).toBe(2.4);
    expect(plan.get("metal-svg")).toBe(2.4);
    expect(plan.get("offscreen-a")).toBe(1.2);
    expect(plan.get("offscreen-b")).toBe(1.2);
    expect(plan.get("main-metal")).toBeGreaterThan(1.2);
    expect(plan.get("main-metal")).toBeLessThan(2.4);
    for (const entry of requests)
      expect(plan.get(entry.id)).toBeGreaterThanOrEqual(1.2);
    expect(
      requests.reduce(
        (sum, entry) => sum + cost(entry, plan.get(entry.id)!),
        0,
      ),
    ).toBeLessThanOrEqual(available);
    expect([...planNativePreviewBudget(requests, available)]).toEqual([
      ...plan,
    ]);
  });

  it("fits twelve 800 by 600 tiles at DPR2 and quarter zoom using their actual screen pixels", () => {
    const requests = Array.from({ length: 12 }, (_, index) => {
      const density = nativePreviewTargetDensity({
        baseDensity: 2,
        displayScale: 0.25,
        viewport: { x: 0, y: 0, width: 3200, height: 2400 },
        target: {
          x: (index % 4) * 800,
          y: Math.floor(index / 4) * 600,
          width: 800,
          height: 600,
        },
      });
      return request(`tile-${index}`, {
        baseDensity: density,
        desiredDensity: density,
        bytesPerPixel: 96,
      });
    });
    const available = 144_000_000;
    const plan = planNativePreviewBudget(requests, available);
    for (const entry of requests) {
      expect(plan.get(entry.id)).toBe(0.5);
      expect(Math.ceil(entry.width * plan.get(entry.id)!)).toBe(400);
      expect(Math.ceil(entry.height * plan.get(entry.id)!)).toBe(300);
    }
    expect(
      requests.reduce(
        (sum, entry) => sum + cost(entry, plan.get(entry.id)!),
        0,
      ),
    ).toBeLessThanOrEqual(available);
  });

  it("rejects an insufficient base working set without allocating density below the floor", () => {
    const entry = request("metal");
    expect(() =>
      planNativePreviewBudget([entry], cost(entry, 1.2) - 1),
    ).toThrow(RangeError);
    expect(
      planNativePreviewBudget([entry], cost(entry, 1.2)).get("metal"),
    ).toBe(1.2);
  });

  it("shares incremental bytes equally between large unsaturated targets", () => {
    const requests = [request("a"), request("b", { width: 400, height: 300 })];
    const base = requests.reduce((sum, entry) => sum + cost(entry, 1.2), 0);
    const plan = planNativePreviewBudget(requests, base + 2_000_000);
    for (const entry of requests) {
      const extra = cost(entry, plan.get(entry.id)!) - cost(entry, 1.2);
      expect(extra).toBeLessThanOrEqual(1_000_000);
      expect(extra).toBeGreaterThan(900_000);
    }
  });

  it("fits physical caps before reserving base density", () => {
    const entry = request("large", {
      width: 5000,
      height: 3000,
      baseDensity: 4,
      desiredDensity: 8,
      maxPixels: 800_000,
    });
    const plan = planNativePreviewBudget([entry], 200_000_000);
    const density = plan.get("large")!;
    const width = Math.ceil(entry.width * density) + 6;
    const height = Math.ceil(entry.height * density) + 6;
    expect(width).toBeLessThanOrEqual(4096);
    expect(height).toBeLessThanOrEqual(4096);
    expect(width * height).toBeLessThanOrEqual(800_000);
    expect(cost(entry, density)).toBeLessThanOrEqual(200_000_000);
  });

  it("rejects duplicate identities and invalid byte budgets", () => {
    expect(() =>
      planNativePreviewBudget([request("a"), request("a")], 1e9),
    ).toThrow(RangeError);
    expect(() => planNativePreviewBudget([], Number.NaN)).toThrow(RangeError);
    expect(() =>
      planNativePreviewBudget([request("a", { bytesPerPixel: 0 })], 1e9),
    ).toThrow(RangeError);
  });
});
