import { beforeEach, describe, expect, it, vi } from "vitest";

const claimMock = vi.hoisted(() => vi.fn());
const deactivateMock = vi.hoisted(() => vi.fn());
const failMock = vi.hoisted(() => vi.fn());
const deliveredMock = vi.hoisted(() => vi.fn());
const ticketMock = vi.hoisted(() => vi.fn());
const retryMock = vi.hoisted(() => vi.fn());

vi.mock("./remote-push-store.js", () => ({
  claimNextRemotePushDelivery: claimMock,
  deactivateRemotePushRegistration: deactivateMock,
  failRemotePushDelivery: failMock,
  markRemotePushDelivered: deliveredMock,
  markRemotePushTicketAccepted: ticketMock,
  retryRemotePushDelivery: retryMock,
}));

import { deliverPendingRemotePushNotifications } from "./remote-push-delivery.js";

const baseDelivery = {
  id: "notification-1",
  registrationId: "registration-1",
  provider: "expo",
  token: "ExpoPushToken[example_token]",
  payload: {
    title: "Remote run completed",
    body: "Done",
    commandId: "command-1",
    hostId: "host-1",
    kind: "append-followup",
    status: "completed",
    updatedAt: 42,
    result: { secret: "must-not-leave-the-server" },
  },
  phase: "send" as const,
  providerTicketId: null,
  attempts: 1,
};

describe("remote push delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    claimMock.mockResolvedValue(null);
    deactivateMock.mockResolvedValue(true);
    failMock.mockResolvedValue(true);
    deliveredMock.mockResolvedValue(true);
    ticketMock.mockResolvedValue(true);
    retryMock.mockResolvedValue(true);
  });

  it("sends a privacy-bounded Expo notification and schedules its receipt", async () => {
    vi.stubEnv("EXPO_ACCESS_TOKEN", "example-access-token");
    claimMock.mockResolvedValueOnce(baseDelivery);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: { status: "ok", id: "ticket-example" } }),
      );

    const result = await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
      now: () => 1_000,
    });

    expect(result).toEqual({
      sent: 1,
      delivered: 0,
      retried: 0,
      failed: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer example-access-token",
        }),
      }),
    );
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({
      to: "ExpoPushToken[example_token]",
      title: "Remote run completed",
      body: "Done",
      sound: "default",
      priority: "high",
      data: {
        url: "agentnative://sessions",
        commandId: "command-1",
        hostId: "host-1",
        kind: "append-followup",
        status: "completed",
        updatedAt: 42,
      },
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leave-the-server");
    expect(ticketMock).toHaveBeenCalledWith({
      id: "notification-1",
      providerTicketId: "ticket-example",
      checkAfter: 901_000,
    });
  });

  it("batches multiple Expo messages into one provider request", async () => {
    claimMock.mockResolvedValueOnce(baseDelivery).mockResolvedValueOnce({
      ...baseDelivery,
      id: "notification-2",
      registrationId: "registration-2",
      token: "ExpoPushToken[example_token_2]",
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { status: "ok", id: "ticket-example-1" },
          { status: "ok", id: "ticket-example-2" },
        ],
      }),
    );

    const result = await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
      now: () => 1_000,
    });

    expect(result).toEqual({
      sent: 2,
      delivered: 0,
      retried: 0,
      failed: 0,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toHaveLength(2);
    expect(body.map((message: { to: string }) => message.to)).toEqual([
      "ExpoPushToken[example_token]",
      "ExpoPushToken[example_token_2]",
    ]);
    expect(ticketMock).toHaveBeenNthCalledWith(1, {
      id: "notification-1",
      providerTicketId: "ticket-example-1",
      checkAfter: 901_000,
    });
    expect(ticketMock).toHaveBeenNthCalledWith(2, {
      id: "notification-2",
      providerTicketId: "ticket-example-2",
      checkAfter: 901_000,
    });
  });

  it("marks delivery only after Expo confirms the provider receipt", async () => {
    claimMock.mockResolvedValueOnce({
      ...baseDelivery,
      phase: "receipt",
      providerTicketId: "ticket-example",
      attempts: 2,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: { "ticket-example": { status: "ok" } },
      }),
    );

    const result = await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
      now: () => 2_000,
    });

    expect(result).toEqual({
      sent: 0,
      delivered: 1,
      retried: 0,
      failed: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/getReceipts",
      expect.any(Object),
    );
    expect(deliveredMock).toHaveBeenCalledWith("notification-1");
  });

  it("deactivates registrations Expo reports as unregistered", async () => {
    claimMock.mockResolvedValueOnce(baseDelivery);
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          status: "error",
          message: "token is not registered",
          details: { error: "DeviceNotRegistered" },
        },
      }),
    );

    const result = await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
    });

    expect(result.failed).toBe(1);
    expect(failMock).toHaveBeenCalledWith({
      id: "notification-1",
      phase: "send",
      errorCode: "DeviceNotRegistered",
    });
    expect(deactivateMock).toHaveBeenCalledWith("registration-1");
  });

  it("rejects malformed registrations without sending their token", async () => {
    claimMock.mockResolvedValueOnce({
      ...baseDelivery,
      token: "not-an-expo-token",
    });
    const fetchMock = vi.fn();

    const result = await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
    });

    expect(result.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith({
      id: "notification-1",
      phase: "send",
      errorCode: "unsupported_push_registration",
    });
    expect(deactivateMock).toHaveBeenCalledWith("registration-1");
  });

  it("backs off temporary service failures without exposing provider text", async () => {
    claimMock.mockResolvedValueOnce(baseDelivery);
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { errors: [{ code: "TOO_MANY_REQUESTS", message: "try later" }] },
          { status: 429 },
        ),
      );

    const result = await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
      now: () => 10_000,
    });

    expect(result.retried).toBe(1);
    expect(retryMock).toHaveBeenCalledWith({
      id: "notification-1",
      phase: "send",
      retryAt: 15_000,
      errorCode: "TOO_MANY_REQUESTS",
      resend: undefined,
    });
  });

  it("resends after a rate-exceeded provider receipt", async () => {
    claimMock.mockResolvedValueOnce({
      ...baseDelivery,
      phase: "receipt",
      providerTicketId: "ticket-example",
      attempts: 3,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          "ticket-example": {
            status: "error",
            details: { error: "MessageRateExceeded" },
          },
        },
      }),
    );

    await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
      now: () => 20_000,
    });

    expect(retryMock).toHaveBeenCalledWith({
      id: "notification-1",
      phase: "receipt",
      retryAt: 40_000,
      errorCode: "MessageRateExceeded",
      resend: true,
    });
  });

  it("fails exhausted notifications without another network request", async () => {
    claimMock.mockResolvedValueOnce({
      ...baseDelivery,
      attempts: 13,
    });
    const fetchMock = vi.fn();

    const result = await deliverPendingRemotePushNotifications({
      fetchImpl: fetchMock,
    });

    expect(result.failed).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failMock).toHaveBeenCalledWith({
      id: "notification-1",
      phase: "send",
      errorCode: "attempts_exhausted",
    });
  });
});
