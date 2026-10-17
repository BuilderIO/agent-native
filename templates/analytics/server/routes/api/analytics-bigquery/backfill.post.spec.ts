import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  delivery: vi.fn(),
  unavailable: vi.fn(),
  isMissing: vi.fn(),
}));

vi.mock("h3", () => ({
  createError: (options: { statusCode: number; statusMessage: string }) =>
    Object.assign(new Error(options.statusMessage), options),
  defineEventHandler: (handler: unknown) => handler,
  getHeader: () => undefined,
}));
vi.mock("../../../jobs/analytics-bigquery-backfill.js", () => ({
  runFirstPartyAnalyticsBigQueryBackfillOnce: mocks.backfill,
}));
vi.mock("../../../lib/first-party-analytics-delivery.js", () => ({
  isFirstPartyAnalyticsDeliveryQueueMissingError: mocks.isMissing,
  runFirstPartyAnalyticsBigQueryDeliveryOnce: mocks.delivery,
  unavailableFirstPartyAnalyticsDeliverySweep: mocks.unavailable,
}));

const { default: handler } = await import("./backfill.post.js");

beforeEach(() => {
  mocks.backfill.mockReset().mockResolvedValue({ status: "completed" });
  mocks.delivery.mockReset();
  mocks.unavailable.mockReset().mockReturnValue({ status: "unavailable" });
  mocks.isMissing.mockReset();
  (globalThis as Record<string, unknown>)[
    "__AGENT_NATIVE_ANALYTICS_BIGQUERY_BACKFILL_SCHEDULED_RUNTIME__"
  ] = true;
});

describe("BigQuery backfill scheduled route", () => {
  it("keeps the existing backfill available while the delivery migration catches up", async () => {
    const migrationError = new Error(
      'relation "analytics_bigquery_delivery_queue" does not exist',
    );
    mocks.delivery.mockRejectedValueOnce(migrationError);
    mocks.isMissing.mockReturnValueOnce(true);

    await expect(handler({} as never)).resolves.toMatchObject({
      ok: true,
      delivery: { status: "unavailable" },
      backfill: { status: "completed" },
    });
    expect(mocks.backfill).toHaveBeenCalledOnce();
    expect(mocks.unavailable).toHaveBeenCalledOnce();
  });

  it("still fails closed for delivery errors unrelated to the migration", async () => {
    mocks.delivery.mockRejectedValueOnce(new Error("warehouse unavailable"));
    mocks.isMissing.mockReturnValueOnce(false);

    await expect(handler({} as never)).rejects.toThrow("warehouse unavailable");
    expect(mocks.backfill).not.toHaveBeenCalled();
  });
});
