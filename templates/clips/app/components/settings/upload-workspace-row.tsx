import { useT } from "@agent-native/core/client/i18n";
import { useOrg, useSwitchOrg } from "@agent-native/core/client/org";
import { SettingsRow } from "@agent-native/core/client/settings";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Whether the viewer belongs to any workspace the upload row can pick. */
export function useHasUploadWorkspaces(): boolean {
  const { data: org } = useOrg();
  return (org?.orgs ?? []).length > 0;
}

/**
 * The workspace new recordings, including desktop uploads, land in. It is
 * the account's active organization, so changing it switches that too.
 */
export function UploadWorkspaceRow({ description }: { description?: string }) {
  const t = useT();
  const { data: org } = useOrg();
  const switchOrg = useSwitchOrg();
  const orgs = org?.orgs ?? [];

  async function handleChange(organizationId: string) {
    if (!organizationId || organizationId === org?.orgId) return;
    try {
      await switchOrg.mutateAsync(organizationId);
      toast.success(t("settings.uploadWorkspaceSaved"));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : t("settings.uploadWorkspaceSaveFailed"),
      );
    }
  }

  return (
    <SettingsRow
      id="upload-workspace"
      label={t("settings.uploadWorkspaceLabel")}
      description={
        switchOrg.isPending
          ? t("settings.uploadWorkspaceSaving")
          : (description ?? t("settings.uploadWorkspaceHint"))
      }
      control={
        <Select
          value={org?.orgId ?? undefined}
          onValueChange={handleChange}
          disabled={switchOrg.isPending || orgs.length < 2}
        >
          <SelectTrigger id="upload-workspace-select" className="w-64">
            <SelectValue
              placeholder={t("settings.uploadWorkspacePlaceholder")}
            />
          </SelectTrigger>
          <SelectContent>
            {orgs.map((workspace) => (
              <SelectItem key={workspace.orgId} value={workspace.orgId}>
                {workspace.orgName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  );
}
