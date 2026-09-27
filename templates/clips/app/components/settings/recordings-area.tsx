import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  SettingsGroup,
  SettingsLoadingRow,
  SettingsRow,
} from "@agent-native/core/client/settings";
import {
  DEFAULT_CLIPS_RECORDING_VISIBILITY,
  type ClipsDefaultVisibility,
} from "@shared/clips-ai-prefs";
import {
  applyClipsRecordingDefaultsPatch,
  CLIPS_DEFAULT_PLAYBACK_SPEEDS,
  type ClipsRecordingDefaults,
  type ClipsRecordingDefaultsPatch,
} from "@shared/clips-recording-defaults";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { FeatureKeysGroup } from "./feature-keys-group";
import { LoadFailedRow } from "./load-failed-row";
import {
  useClipsOrganization,
  useSaveClipsBranding,
} from "./use-clips-organization";

const DEFAULTS_ACTION = "get-clips-recording-defaults";

export const TRANSCRIPT_EXPORT_KEYS = [
  "BRAIN_INGEST_URL",
  "BRAIN_INGEST_TOKEN",
] as const;

function useSaveRecordingDefaults() {
  const t = useT();
  const queryClient = useQueryClient();
  const { mutate } = useActionMutation<
    ClipsRecordingDefaults,
    ClipsRecordingDefaultsPatch
  >("update-clips-recording-defaults");
  return useCallback(
    (patch: ClipsRecordingDefaultsPatch) => {
      const filter = { queryKey: ["action", DEFAULTS_ACTION] };
      const previous =
        queryClient.getQueriesData<ClipsRecordingDefaults>(filter);
      queryClient.setQueriesData<ClipsRecordingDefaults>(filter, (current) =>
        current ? applyClipsRecordingDefaultsPatch(current, patch) : current,
      );
      mutate(patch, {
        onError: (error) => {
          for (const [key, value] of previous) {
            queryClient.setQueryData(key, value);
          }
          toast.error(error.message || t("settings.saveFailed"));
        },
      });
    },
    [mutate, queryClient, t],
  );
}

// Select values can't be empty, so following the organization gets its own.
const FOLLOW_ORGANIZATION = "organization";

function VisibilitySelect<Value extends string>({
  value,
  label,
  onChange,
  options,
}: {
  value: Value;
  label: string;
  onChange: (value: Value) => void;
  options: { value: Value; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Value)}>
      <SelectTrigger size="sm" className="w-full sm:w-64" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function YourDefaultsGroup() {
  const t = useT();
  const query = useActionQuery<ClipsRecordingDefaults>(
    DEFAULTS_ACTION,
    undefined,
    { retry: false },
  );
  const save = useSaveRecordingDefaults();
  const organizationName = useClipsOrganization().organization?.name;
  const speedLabel = t("clipsSettings.playbackSpeed");
  const visibilityLabel = t("clipsSettings.visibility");
  const shortVisibility: Record<ClipsDefaultVisibility, string> = {
    private: t("playerSettings.visibilityPrivate"),
    org: t("playerSettings.visibilityOrg"),
    public: t("playerSettings.visibilityPublic"),
  };
  const followOrganizationLabel = (inherited: ClipsDefaultVisibility) =>
    organizationName
      ? t("clipsSettings.useOrgDefault", {
          org: organizationName,
          visibility: shortVisibility[inherited],
        })
      : t("clipsSettings.useDefault", {
          visibility: shortVisibility[inherited],
        });

  return (
    <SettingsGroup id="your-defaults" title={t("clipsSettings.yourDefaults")}>
      {query.data ? (
        <>
          <SettingsRow
            id="playback"
            label={speedLabel}
            description={t("clipsSettings.playbackSpeedDescription")}
            control={
              <Select
                value={query.data.defaultPlaybackSpeed}
                onValueChange={(defaultPlaybackSpeed) =>
                  save({ defaultPlaybackSpeed })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="w-full sm:w-40"
                  aria-label={speedLabel}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIPS_DEFAULT_PLAYBACK_SPEEDS.map((speed) => (
                    <SelectItem key={speed} value={speed}>
                      {speed}×
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            id="visibility"
            label={visibilityLabel}
            description={t("clipsSettings.visibilityDescription")}
            control={
              <VisibilitySelect<
                ClipsDefaultVisibility | typeof FOLLOW_ORGANIZATION
              >
                value={
                  query.data.defaultRecordingVisibility ?? FOLLOW_ORGANIZATION
                }
                label={visibilityLabel}
                onChange={(next) =>
                  save({
                    defaultRecordingVisibility:
                      next === FOLLOW_ORGANIZATION ? null : next,
                  })
                }
                options={[
                  {
                    value: FOLLOW_ORGANIZATION,
                    label: followOrganizationLabel(
                      query.data.organizationDefaultVisibility ??
                        DEFAULT_CLIPS_RECORDING_VISIBILITY,
                    ),
                  },
                  { value: "private", label: t("settings.visibilityPrivate") },
                  { value: "org", label: t("settings.visibilityOrg") },
                  { value: "public", label: t("settings.visibilityPublic") },
                ]}
              />
            }
          />
        </>
      ) : query.isError ? (
        <LoadFailedRow onRetry={() => void query.refetch()} />
      ) : (
        <>
          <SettingsLoadingRow />
          <SettingsLoadingRow />
        </>
      )}
    </SettingsGroup>
  );
}

/** The organization's default, which a member's own default overrides. */
function OrganizationDefaultGroup() {
  const t = useT();
  const state = useClipsOrganization();
  const save = useSaveClipsBranding(state.organization?.id ?? null);
  const organization = state.organization;
  if (!state.isAdmin || !organization) return null;
  const label = t("clipsSettings.visibility");

  return (
    <SettingsGroup
      id="organization-default"
      title={t("clipsSettings.orgDefault", { org: organization.name })}
    >
      <SettingsRow
        id="organization-visibility"
        label={label}
        description={t("brandingEditor.defaultVisibilityDescription")}
        control={
          <VisibilitySelect
            value={organization.defaultVisibility}
            label={label}
            onChange={(defaultVisibility) => save({ defaultVisibility })}
            options={[
              { value: "public", label: t("playerSettings.visibilityPublic") },
              { value: "org", label: t("playerSettings.visibilityOrg") },
              {
                value: "private",
                label: t("playerSettings.visibilityPrivate"),
              },
            ]}
          />
        }
      />
    </SettingsGroup>
  );
}

/** Clips › General › Recordings. */
export function ClipsRecordingsArea({ canManage }: { canManage: boolean }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-8">
      <YourDefaultsGroup />
      <OrganizationDefaultGroup />
      {canManage ? (
        <FeatureKeysGroup
          id="transcript-export"
          title={t("clipsSettings.transcriptExport")}
          keys={TRANSCRIPT_EXPORT_KEYS}
        />
      ) : null}
    </div>
  );
}
