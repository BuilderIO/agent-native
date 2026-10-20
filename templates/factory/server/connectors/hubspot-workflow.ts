import { isAgentConnectionRequiredError } from "@agent-native/core/action";
import type { ProviderApiRequestArgs } from "@agent-native/core/provider-api";

import { executeProviderApiRequest } from "../lib/provider-api.js";
import { failWorkflowAction } from "../lib/workflow-action-errors.js";

export const HUBSPOT_DUE_CHOICES = ["today", "tomorrow", "nextWeek"] as const;
type HubSpotDue = (typeof HUBSPOT_DUE_CHOICES)[number];

// HubSpot-defined association type from a task to a contact.
const TASK_TO_CONTACT_ASSOCIATION = 204;
const DAYS_AHEAD: Record<HubSpotDue, number> = {
  today: 0,
  tomorrow: 1,
  nextWeek: 7,
};

export type HubSpotRequest = (args: ProviderApiRequestArgs) => Promise<unknown>;

interface HubSpotResponse {
  status: number;
  ok: boolean;
  json?: unknown;
}

/**
 * A due choice as a timestamp: the end of that day in UTC. A request cannot
 * turn "today" into a time, and HubSpot needs one.
 */
export function resolveDueTimestamp(due: HubSpotDue, now: Date): string {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + DAYS_AHEAD[due],
      23,
      59,
      59,
    ),
  ).toISOString();
}

async function call(
  request: HubSpotRequest,
  args: ProviderApiRequestArgs,
  onThrow: "none" | "maybe",
): Promise<HubSpotResponse> {
  let result: unknown;
  try {
    result = await request(args);
  } catch (error) {
    if (isAgentConnectionRequiredError(error)) {
      return failWorkflowAction({
        message:
          "HubSpot is not connected for this workspace. Connect HubSpot in Dispatch or add a private app token to the vault.",
        errorCode: "hubspot_not_connected",
        statusCode: 412,
      });
    }
    return onThrow === "maybe"
      ? failWorkflowAction({
          message: "HubSpot did not confirm whether the task was created.",
          errorCode: "hubspot_task_outcome_unknown",
          statusCode: 424,
        })
      : failWorkflowAction({
          message: "HubSpot could not be reached while reading the contact.",
          errorCode: "hubspot_request_failed",
          statusCode: 424,
          retryable: true,
        });
  }
  const response = (result as { response?: Partial<HubSpotResponse> } | null)
    ?.response;
  if (
    !response ||
    typeof response.status !== "number" ||
    typeof response.ok !== "boolean"
  ) {
    return onThrow === "maybe"
      ? failWorkflowAction({
          message: "HubSpot answered in a shape Factory could not read.",
          errorCode: "hubspot_task_outcome_unknown",
          statusCode: 424,
        })
      : failWorkflowAction({
          message: "HubSpot answered in a shape Factory could not read.",
          errorCode: "hubspot_response_invalid",
          statusCode: 424,
        });
  }
  return response as HubSpotResponse;
}

function failHubSpotResponse(
  response: HubSpotResponse,
  what: string,
  onServerError: "none" | "maybe",
): never {
  const { status } = response;
  const category = (response.json as { category?: unknown } | undefined)
    ?.category;
  const details = {
    status,
    ...(typeof category === "string" && /^[A-Z_]{3,60}$/.test(category)
      ? { hubspotCategory: category }
      : {}),
  };
  if (status === 429) {
    return failWorkflowAction({
      message: `HubSpot is rate limiting this workspace while ${what}.`,
      errorCode: "hubspot_rate_limited",
      statusCode: 429,
      retryable: true,
      details,
    });
  }
  if (status === 401 || status === 403) {
    return failWorkflowAction({
      message: `HubSpot refused the connected credential while ${what} (HTTP ${status}).`,
      errorCode: "hubspot_access_denied",
      statusCode: 403,
      details,
    });
  }
  if (status === 404) {
    return failWorkflowAction({
      message: `HubSpot could not find the record while ${what}.`,
      errorCode: "hubspot_not_found",
      statusCode: 404,
      details,
    });
  }
  if (status >= 500 && onServerError === "maybe") {
    return failWorkflowAction({
      message: `HubSpot failed while ${what} (HTTP ${status}).`,
      errorCode: "hubspot_task_outcome_unknown",
      statusCode: 424,
      details,
    });
  }
  return failWorkflowAction({
    message: `HubSpot rejected the request while ${what} (HTTP ${status}).`,
    errorCode: status >= 500 ? "hubspot_request_failed" : "hubspot_rejected",
    statusCode: 424,
    retryable: status >= 500,
    details,
  });
}

const NUMERIC_ID = /^\d{1,20}$/;

/** The HubSpot owner of a contact, or null when it has none. */
async function readContactOwner(
  request: HubSpotRequest,
  contactId: string,
): Promise<string | null> {
  const response = await call(
    request,
    {
      provider: "hubspot",
      method: "GET",
      path: `/crm/v3/objects/contacts/${contactId}`,
      query: { properties: "hubspot_owner_id" },
    },
    "none",
  );
  if (!response.ok) {
    return failHubSpotResponse(response, "reading the contact's owner", "none");
  }
  const properties = (response.json as { properties?: unknown } | undefined)
    ?.properties;
  const owner = (properties as { hubspot_owner_id?: unknown } | undefined)
    ?.hubspot_owner_id;
  if (owner === null || owner === undefined || owner === "") return null;
  if (typeof owner !== "string" || !NUMERIC_ID.test(owner)) {
    return failWorkflowAction({
      message: "HubSpot returned a contact owner Factory could not read.",
      errorCode: "hubspot_response_invalid",
      statusCode: 424,
    });
  }
  return owner;
}

interface HubSpotTaskInput {
  title: string;
  ownerId?: string;
  contactId?: string;
  due: HubSpotDue;
  body?: string;
}

interface HubSpotTaskResult {
  id: string;
  ownerId: string | null;
  contactId: string | null;
  due: HubSpotDue;
  dueAt: string;
}

export async function createHubSpotTask(
  input: HubSpotTaskInput,
  deps: { request?: HubSpotRequest; now?: () => Date } = {},
): Promise<HubSpotTaskResult> {
  const request = deps.request ?? executeProviderApiRequest;
  for (const [field, value] of [
    ["ownerId", input.ownerId],
    ["contactId", input.contactId],
  ] as const) {
    if (value !== undefined && !NUMERIC_ID.test(value)) {
      failWorkflowAction({
        message: `${field} is a HubSpot id of digits.`,
        errorCode: "hubspot_input_invalid",
        statusCode: 400,
      });
    }
  }
  const dueAt = resolveDueTimestamp(
    input.due,
    (deps.now ?? (() => new Date()))(),
  );
  // Without an owner the task goes to whoever owns the contact.
  const ownerId =
    input.ownerId ??
    (input.contactId ? await readContactOwner(request, input.contactId) : null);

  const response = await call(
    request,
    {
      provider: "hubspot",
      method: "POST",
      path: "/crm/v3/objects/tasks",
      body: {
        properties: {
          hs_timestamp: dueAt,
          hs_task_subject: input.title,
          hs_task_status: "NOT_STARTED",
          ...(input.body ? { hs_task_body: input.body } : {}),
          ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
        },
        ...(input.contactId
          ? {
              associations: [
                {
                  to: { id: input.contactId },
                  types: [
                    {
                      associationCategory: "HUBSPOT_DEFINED",
                      associationTypeId: TASK_TO_CONTACT_ASSOCIATION,
                    },
                  ],
                },
              ],
            }
          : {}),
      },
    },
    "maybe",
  );
  if (!response.ok) {
    return failHubSpotResponse(response, "creating the task", "maybe");
  }
  const id = (response.json as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string" || !NUMERIC_ID.test(id)) {
    return failWorkflowAction({
      message: "HubSpot accepted the task but did not return its id.",
      errorCode: "hubspot_task_outcome_unknown",
      statusCode: 424,
    });
  }
  return {
    id,
    ownerId,
    contactId: input.contactId ?? null,
    due: input.due,
    dueAt,
  };
}
