import { callAction, useActionQuery } from "@agent-native/core/client/hooks";
import type { SettingsSectionDefinition } from "@agent-native/toolkit/app/settings";
import {
  formatLocaleDate,
  useReaderLocale,
} from "@agent-native/toolkit/app/shared/reader-locale";
import { useState } from "react";

import type { RoleRequest } from "../../../app/lib/model/role-request-contracts.js";

type RequestsResult = { requests: RoleRequest[] };

/**
 * The row a member sees on their own profile: the request for an admin role,
 * with its pending line and the message of a request that was not saved. An
 * administrator reads one line instead.
 */
export function useRoleRequestControlSections(): SettingsSectionDefinition[] {
  const locale = useReaderLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<RoleRequest | null>(null);
  const shell = useActionQuery<{ features: { isAdmin: boolean } }>(
    "get-workspace-bootstrap",
    {},
    { retry: 1 },
  );
  const isAdmin = shell.data?.features.isAdmin === true;
  const open = useActionQuery<RequestsResult>(
    "list-role-requests",
    {},
    {
      retry: 1,
    },
  );
  const mine =
    filed ??
    (open.data?.requests ?? []).find(
      (request) => request.status === "pending",
    ) ??
    null;

  const request = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await callAction<{ request: RoleRequest }>(
        "request-role",
        { requestedRole: "admin" },
      );
      setFiled(result.request);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The request was not saved.",
      );
    } finally {
      setPending(false);
    }
  };

  return [
    {
      id: "workspace-access",
      rows: [
        {
          id: "settings.profile.workspace-access",
          kind: "info",
          label: "Workspace access",
          value: "You are an administrator of this workspace.",
          condition: { visible: isAdmin },
        },
        {
          id: "settings.profile.request-admin-access",
          kind: "action",
          label: "Request admin access",
          description:
            "Workspace administrators can raise your role. Ask for admin access and they will see the request on the workspace's Users page.",
          condition: {
            visible: !isAdmin,
            ...(mine !== null
              ? {
                  disabledReason: `Request pending since ${formatLocaleDate(
                    mine.requestedAt,
                    locale,
                  )}.`,
                }
              : {}),
          },
          action: {
            id: "request",
            label: mine !== null ? "Request sent" : "Request admin access",
            intent: "primary",
            pending,
            ...(error !== null ? { error } : {}),
            condition: { disabled: mine !== null },
            trigger: {
              kind: "invoke",
              actionName: "request-role",
              run: request,
            },
          },
        },
      ],
    },
  ];
}

/** The administrator's queue: approve raises the member to admin, decline closes it. */
export function useRoleRequestQueueSections(): SettingsSectionDefinition[] {
  const locale = useReaderLocale();
  const query = useActionQuery<RequestsResult>(
    "list-role-requests",
    {},
    {
      retry: 1,
    },
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = (query.data?.requests ?? []).filter(
    (request) => request.status === "pending",
  );
  const decided = (query.data?.requests ?? []).filter(
    (request) => request.status !== "pending",
  );

  const decide = async (id: string, decision: "approved" | "declined") => {
    setPendingId(id);
    setError(null);
    try {
      await callAction("resolve-role-request", { id, decision });
      await query.refetch();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The request was not saved.",
      );
    } finally {
      setPendingId(null);
    }
  };

  return [
    {
      id: "role-requests",
      rows: [
        {
          id: "settings.users.role-requests",
          kind: "collection",
          label: "Role requests",
          emptyLabel: "No open role requests.",
          items: query.isPending
            ? { status: "loading", label: "Loading role requests…" }
            : query.error || !query.data
              ? {
                  status: "error",
                  message:
                    query.error instanceof Error
                      ? query.error.message
                      : "Could not load role requests.",
                  retry: () => {
                    void query.refetch();
                  },
                  retryLabel: "Retry",
                }
              : {
                  status: "ready",
                  value: pending.map((request) => ({
                    key: request.id,
                    title: request.requestedBy,
                    description: `Asks for ${request.requestedRole} · ${formatLocaleDate(
                      request.requestedAt,
                      locale,
                    )}`,
                    actions: [
                      {
                        id: "approve",
                        label: "Approve",
                        intent: "primary" as const,
                        condition: { disabled: pendingId === request.id },
                        trigger: {
                          kind: "invoke" as const,
                          actionName: "resolve-role-request",
                          run: () => decide(request.id, "approved"),
                        },
                      },
                      {
                        id: "decline",
                        label: "Decline",
                        condition: { disabled: pendingId === request.id },
                        trigger: {
                          kind: "invoke" as const,
                          actionName: "resolve-role-request",
                          run: () => decide(request.id, "declined"),
                        },
                      },
                    ],
                  })),
                },
          ...(decided.length > 0
            ? {
                footer: `${decided.length} decided ${
                  decided.length === 1 ? "request" : "requests"
                }.`,
              }
            : {}),
          ...(error !== null ? { error } : {}),
        },
      ],
    },
  ];
}
