import { useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useOrg, useAcceptInvitation, useJoinByDomain } from "./hooks.js";

export interface InvitationBannerProps {
  className?: string;
}

/**
 * Top-of-app banner that surfaces:
 *   - Pending org invitations (one-click Accept).
 *   - Domain-match orgs the user can auto-join because their email domain
 *     matches `organizations.allowed_domain` (one-click Join). Lets a new
 *     signup at e.g. `someone@builder.io` see and join the existing
 *     Builder.io org without going through the picker.
 *
 * Renders nothing when there's nothing to surface.
 */
export function InvitationBanner({ className }: InvitationBannerProps) {
  const { data: org } = useOrg();
  const acceptInvitation = useAcceptInvitation();
  const joinByDomain = useJoinByDomain();
  const [joiningOrgId, setJoiningOrgId] = useState<string | null>(null);

  const pendingInvitations = org?.pendingInvitations ?? [];
  const domainMatches = org?.domainMatches ?? [];

  if (pendingInvitations.length === 0 && domainMatches.length === 0) {
    return null;
  }

  const error = acceptInvitation.error || joinByDomain.error;

  return (
    <div
      className={`border-b border-border bg-blue-50 dark:bg-blue-950/30 px-3 py-2.5 sm:px-4 ${className ?? ""}`}
    >
      {pendingInvitations.map((inv) => (
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
            className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 cursor-pointer"
          >
            {acceptInvitation.isPending ? (
              <IconLoader2 className="h-3 w-3 animate-spin" />
            ) : (
              "Join"
            )}
          </button>
        </div>
      ))}
      {domainMatches.map((match) => {
        const isJoining =
          joinByDomain.isPending && joiningOrgId === match.orgId;
        return (
          <div
            key={match.orgId}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-foreground">
              Your team is already using this app. Join{" "}
              <span className="font-medium">{match.orgName}</span> to
              collaborate.
            </span>
            <button
              type="button"
              onClick={() => {
                setJoiningOrgId(match.orgId);
                joinByDomain.mutate(match.orgId, {
                  onSettled: () => setJoiningOrgId(null),
                });
              }}
              disabled={joinByDomain.isPending}
              className="rounded-md bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 cursor-pointer"
            >
              {isJoining ? (
                <IconLoader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Join"
              )}
            </button>
          </div>
        );
      })}
      {error && (
        <div className="mt-1 text-xs text-red-600">
          {(error as Error).message}
        </div>
      )}
    </div>
  );
}
