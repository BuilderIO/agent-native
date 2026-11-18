import { useT } from "@agent-native/core/client/i18n";
import { useSetOrgInvitationPolicy } from "@agent-native/core/client/org";
import type { OrgInfo } from "@agent-native/core/org/types";
import { Label } from "@agent-native/toolkit/ui/label";
import { Switch } from "@agent-native/toolkit/ui/switch";
import { useId } from "react";

export function InvitationPolicyControl({ org }: { org: OrgInfo }) {
  const t = useT();
  const id = useId();
  const setPolicy = useSetOrgInvitationPolicy();
  const policy = org.memberInvitations;
  const isManager = org.role === "owner" || org.role === "admin";
  if (!isManager || policy?.mode !== "org-setting") return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-card px-5 py-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {t("agentChat.settingsOrg.onlyAdminsCanInvite")}
        </Label>
        {policy.invalid ? (
          <p role="alert" className="text-xs text-destructive">
            {t("agentChat.settingsOrg.invitationPolicyInvalid")}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={policy.onlyAdminsCanInvite}
        disabled={setPolicy.isPending}
        onCheckedChange={(checked) => setPolicy.mutate(checked)}
      />
    </div>
  );
}
