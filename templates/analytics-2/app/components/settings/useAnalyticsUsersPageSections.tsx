import { useT } from "@agent-native/core/client/i18n";
import {
  useOrg,
  useOrgInvitations,
  useSetOrgDomain,
} from "@agent-native/core/client/org";
import type { SettingsSectionDefinition } from "@agent-native/toolkit/app/settings";
import { IconLink } from "@tabler/icons-react";
import { toast } from "sonner";

import { inviteLinkFor } from "./inviteLink";

/** The pending invitations, each with the link an admin can paste into a chat. */
export function useAnalyticsUsersPageSections(): SettingsSectionDefinition[] {
  const t = useT();
  const invitations = useOrgInvitations();
  const pending = invitations.data?.invitations ?? [];
  const org = useOrg();
  const setDomain = useSetOrgDomain();
  const domainError = setDomain.error
    ? setDomain.error instanceof Error
      ? setDomain.error.message
      : t("analytics.settings.allowedDomain.saveFailed")
    : undefined;

  const inviteItems = invitations.isPending
    ? ({
        status: "loading",
        label: t("analytics.settings.inviteLink.loading"),
      } as const)
    : invitations.error || !invitations.data
      ? ({
          status: "error",
          message: t("analytics.settings.inviteLink.loadError"),
          retry: () => {
            void invitations.refetch();
          },
          retryLabel: t("analytics.organizationCatalog.retry"),
        } as const)
      : ({
          status: "ready",
          value: pending.map((invitation) => ({
            key: invitation.id,
            reference: {
              attributes: { "data-invite-link": invitation.id },
            },
            title: invitation.email,
            description: inviteLinkFor(invitation.id),
            actions: [
              {
                id: "copy-link",
                label: t("analytics.settings.inviteLink.copy"),
                icon: <IconLink aria-hidden="true" size={14} stroke={1.8} />,
                trigger: {
                  kind: "invoke" as const,
                  run: async () => {
                    try {
                      await navigator.clipboard.writeText(
                        inviteLinkFor(invitation.id),
                      );
                      toast.success(t("analytics.settings.inviteLink.copied"));
                    } catch {
                      toast.error(
                        t("analytics.settings.inviteLink.copyFailed"),
                      );
                    }
                  },
                },
              },
            ],
          })),
        } as const);

  return [
    {
      id: "allowed-domain",
      rows: [
        {
          id: "settings.users.allowed-domain",
          kind: "text",
          label: t("analytics.settings.allowedDomain.title"),
          placeholder: t("analytics.settings.allowedDomain.placeholder"),
          ...(domainError ? { error: domainError } : {}),
          binding: {
            value: org.data?.allowedDomain ?? "",
            commit: "blur",
            pending: setDomain.isPending,
            set: async (value) => {
              await setDomain.mutateAsync(value.trim() === "" ? null : value);
            },
          },
        },
      ],
    },
    {
      id: "invite-link",
      rows: [
        {
          id: "settings.users.invite-links",
          kind: "collection",
          label: t("analytics.settings.inviteLink.title"),
          dom: { labelId: "invite-link-heading" },
          description: t("analytics.settings.inviteLink.description"),
          emptyLabel: t("analytics.settings.inviteLink.empty"),
          hints: { itemDescription: "code" },
          items: inviteItems,
        },
      ],
    },
  ];
}
