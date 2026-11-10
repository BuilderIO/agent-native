import { readAppState } from "@agent-native/core/application-state";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

const CHECKED_BY_ACTION_SCHEMA = { type: "actionSchema" } as const;

type WidgetWriteAuthorizationInput = {
  toolName: string;
  args: Record<string, unknown>;
  result: unknown;
  target: { targetPath: string; resourceIds: Record<string, string> };
  identity: {
    userEmail?: string | undefined;
    orgId?: string | null | undefined;
  };
};

/**
 * What the Mail card can do in a chat host. Its session reads and edits the one
 * draft manage-draft returned, and nothing else: a chat host receives the
 * session's start URL, so sending and deleting stay in Mail, where a person
 * presses the button.
 */
export const MAIL_CARD_PROFILE = {
  // Mail has this card but no directory listing.
  directoryRoute: false as const,
  connectorCatalog: ["manage-draft"],
  authorizeWidgetWrite: async ({
    target,
    identity,
  }: WidgetWriteAuthorizationInput) => {
    const draftId = target.resourceIds.draftId;
    const requestEmail = getRequestUserEmail()?.trim().toLowerCase();
    const requestOrgId = getRequestOrgId() ?? undefined;
    if (
      !draftId ||
      !identity.userEmail ||
      requestEmail !== identity.userEmail.trim().toLowerCase() ||
      (identity.orgId !== undefined &&
        (identity.orgId ?? undefined) !== requestOrgId)
    ) {
      return false;
    }
    return Boolean(await readAppState(`compose-${draftId}`));
  },
  widgetTargets: {
    "manage-draft": (_args: Record<string, unknown>, result: unknown) => {
      const draftId = nonEmptyString(record(result).id);
      // Only a create or update result opens a card; a delete has none to open.
      if (!draftId || record(result).embed !== true) return null;
      return {
        targetPath: `/draft?id=${encodeURIComponent(draftId)}`,
        resourceIds: { draftId, draftAction: "update" },
        writeActions: ["manage-draft"],
      };
    },
  },
  widgetReadPrivateActions: ["get-draft-card"],
  widgetReadActionArguments: {
    "get-draft-card": { id: "draftId" },
  },
  widgetWriteActionArguments: {
    "manage-draft": {
      action: "draftAction",
      id: "draftId",
      expectedRevision: CHECKED_BY_ACTION_SCHEMA,
      to: CHECKED_BY_ACTION_SCHEMA,
      cc: CHECKED_BY_ACTION_SCHEMA,
      bcc: CHECKED_BY_ACTION_SCHEMA,
      subject: CHECKED_BY_ACTION_SCHEMA,
      body: CHECKED_BY_ACTION_SCHEMA,
    },
  },
};
