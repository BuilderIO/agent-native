import { AgentConnectionRequiredError } from "@agent-native/core/action";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/provider-api.js", () => ({
  executeProviderApiRequest: vi.fn(),
}));

import {
  createHubSpotTask,
  resolveDueTimestamp,
  type HubSpotRequest,
} from "./hubspot-workflow.js";

const now = () => new Date("2026-10-14T15:30:00.000Z");

function reply(status: number, json?: unknown) {
  return { response: { status, ok: status >= 200 && status < 300, json } };
}

function requestOf(...replies: unknown[]) {
  const request = vi.fn<HubSpotRequest>();
  for (const next of replies) {
    if (next instanceof Error) request.mockRejectedValueOnce(next);
    else request.mockResolvedValueOnce(next);
  }
  return request;
}

const base = { title: "Call the lead", due: "today" as const };

describe("resolveDueTimestamp", () => {
  it("is the end of that day in UTC", () => {
    expect(resolveDueTimestamp("today", now())).toBe(
      "2026-10-14T23:59:59.000Z",
    );
    expect(resolveDueTimestamp("tomorrow", now())).toBe(
      "2026-10-15T23:59:59.000Z",
    );
    expect(resolveDueTimestamp("nextWeek", now())).toBe(
      "2026-10-21T23:59:59.000Z",
    );
    expect(
      resolveDueTimestamp("tomorrow", new Date("2026-12-31T08:00:00.000Z")),
    ).toBe("2027-01-01T23:59:59.000Z");
  });
});

describe("createHubSpotTask", () => {
  it("creates the task, associated with the contact, and returns its id", async () => {
    const request = requestOf(reply(201, { id: "9001" }));

    const task = await createHubSpotTask(
      {
        ...base,
        ownerId: "77",
        contactId: "42",
        body: "Notes",
        due: "tomorrow",
      },
      { request, now },
    );

    expect(task).toEqual({
      id: "9001",
      ownerId: "77",
      contactId: "42",
      due: "tomorrow",
      dueAt: "2026-10-15T23:59:59.000Z",
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toMatchObject({
      provider: "hubspot",
      method: "POST",
      path: "/crm/v3/objects/tasks",
      body: {
        properties: {
          hs_timestamp: "2026-10-15T23:59:59.000Z",
          hs_task_subject: "Call the lead",
          hs_task_body: "Notes",
          hubspot_owner_id: "77",
        },
        associations: [
          {
            to: { id: "42" },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                associationTypeId: 204,
              },
            ],
          },
        ],
      },
    });
  });

  it("assigns the task to the contact's owner when none is given", async () => {
    const request = requestOf(
      reply(200, { properties: { hubspot_owner_id: "55" } }),
      reply(201, { id: "9002" }),
    );

    const task = await createHubSpotTask(
      { ...base, contactId: "42" },
      { request, now },
    );

    expect(request.mock.calls[0]?.[0]).toMatchObject({
      method: "GET",
      path: "/crm/v3/objects/contacts/42",
    });
    expect(task.ownerId).toBe("55");
    expect(
      (
        request.mock.calls[1]?.[0].body as {
          properties: Record<string, unknown>;
        }
      ).properties.hubspot_owner_id,
    ).toBe("55");
  });

  it("creates an unassigned task when neither the call nor the contact names an owner", async () => {
    const request = requestOf(
      reply(200, { properties: { hubspot_owner_id: null } }),
      reply(201, { id: "9003" }),
    );

    const task = await createHubSpotTask(
      { ...base, contactId: "42" },
      { request, now },
    );

    expect(task.ownerId).toBeNull();
    expect(
      (
        request.mock.calls[1]?.[0].body as {
          properties: Record<string, unknown>;
        }
      ).properties,
    ).not.toHaveProperty("hubspot_owner_id");
  });

  it("refuses an id that is not digits before calling HubSpot", async () => {
    const request = requestOf();

    await expect(
      createHubSpotTask({ ...base, contactId: "../owners" }, { request, now }),
    ).rejects.toMatchObject({
      errorCode: "hubspot_input_invalid",
      statusCode: 400,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails the owner lookup without creating anything", async () => {
    const request = requestOf(reply(404, { message: "not found" }));

    await expect(
      createHubSpotTask({ ...base, contactId: "42" }, { request, now }),
    ).rejects.toMatchObject({
      errorCode: "hubspot_not_found",
      sideEffect: "none",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("separates a rejected task from one that may exist", async () => {
    const rejected = requestOf(
      reply(400, { category: "VALIDATION_ERROR", message: "secret detail" }),
    );
    const limited = requestOf(reply(429));
    const denied = requestOf(reply(403));
    const serverError = requestOf(reply(502));
    const dropped = requestOf(new Error("Provider API request timed out"));
    const noId = requestOf(reply(201, {}));

    const failure = await createHubSpotTask(base, {
      request: rejected,
      now,
    }).catch((error: Error & { errorCode: string }) => error);
    expect(failure).toMatchObject({
      errorCode: "hubspot_rejected",
      sideEffect: "none",
      details: { status: 400, hubspotCategory: "VALIDATION_ERROR" },
    });
    expect((failure as Error).message).not.toContain("secret detail");
    await expect(
      createHubSpotTask(base, { request: limited, now }),
    ).rejects.toMatchObject({
      errorCode: "hubspot_rate_limited",
      retryable: true,
    });
    await expect(
      createHubSpotTask(base, { request: denied, now }),
    ).rejects.toMatchObject({ errorCode: "hubspot_access_denied" });
    for (const request of [serverError, dropped, noId]) {
      await expect(
        createHubSpotTask(base, { request, now }),
      ).rejects.toMatchObject({
        errorCode: "hubspot_task_outcome_unknown",
        sideEffect: "maybe",
      });
    }
  });

  it("turns a missing connection into a typed failure with no side effect", async () => {
    const request = requestOf(
      new AgentConnectionRequiredError("Connect HubSpot.", {
        provider: "hubspot",
      }),
    );

    await expect(
      createHubSpotTask(base, { request, now }),
    ).rejects.toMatchObject({
      errorCode: "hubspot_not_connected",
      sideEffect: "none",
    });
  });
});
