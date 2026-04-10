import { IconLoader2 } from "@tabler/icons-react";
import { useOrg, useAcceptInvitation } from "./hooks.js";

export interface InvitationBannerProps {
  className?: string;
}

/**
 * Top-of-app banner that surfaces pending org invitations with an inline
 * Accept button. Renders nothing when there are no pending invites.
 */
export function InvitationBanner({ className }: InvitationBannerProps) {
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();

  if (!org?.pendingInvitations?.length) return null;

  return (
    <div
      className={`border-b border-border bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5 sm:px-4 ${className ?? ""}`}
    >
      {org.pendingInvitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span className="text-foreground">
            <span className="font-medium">{inv.invitedBy}</span> invited you to
            join <span className="font-medium">{inv.orgName}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              acceptInvitation.mutate(inv.id);
            }}
            disabled={acceptInvitation.isPending}
            className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {acceptInvitation.isPending ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Join"
            )}
          </button>
        </div>
      ))}
      {acceptInvitation.error && (
        <div className="mt-1 text-xs text-red-600">
          {(acceptInvitation.error as Error).message}
        </div>
      )}
    </div>
  );
}
