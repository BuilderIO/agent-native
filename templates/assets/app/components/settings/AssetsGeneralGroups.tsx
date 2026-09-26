import { useT } from "@agent-native/core/client/i18n";
import type { OnboardingStepStatus } from "@agent-native/core/client/onboarding";
import { useOrg } from "@agent-native/core/client/org";
import {
  BuilderConnectPopover,
  ReadOnlySettingValue,
  SettingsGroup,
  SettingsRow,
  useSettingsShell,
} from "@agent-native/core/client/settings";
import { IconLoader2 } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  builderDescription,
  generationSummary,
  ManualMethodFields,
  useGenerationSetup,
  type GenerationSetup,
} from "./generation-setup";

const BUILDER_LABEL = "Builder.io";

/**
 * Assets' own groups on Assets › General in the redesigned Settings:
 * Generation (Builder.io, manual provider keys) and Storage.
 */
export function AssetsGeneralGroups() {
  const t = useT();
  const setup = useGenerationSetup();
  const { data: org } = useOrg();
  // Keys and storage save at workspace scope, which the server lets only
  // owners and admins (or a solo workspace) write.
  const canManage = !org?.orgId || org.role === "owner" || org.role === "admin";
  const readOnlyReason = t(
    // i18n-key-ignore shared framework catalog
    "agentChat.settingsShell.appGroup.adminOnly",
  );
  const statusLabel = (ready: boolean) =>
    ready ? t("settings.generationReady") : t("settings.generationNeedsSetup");

  return (
    <>
      <SettingsGroup
        id="asset-generation-setup"
        title={t("settings.generation")}
      >
        <SettingsRow
          id="builder"
          label={BUILDER_LABEL}
          description={
            <SetupDescription setup={setup}>
              {setup.configData?.builderLookupFailed
                ? t("settings.builderLookupFailed")
                : builderDescription(setup, t)}
            </SetupDescription>
          }
          control={<BuilderControl setup={setup} />}
        />
        <SettingsRow
          id="generation-keys"
          label={t("settings.manualKeys")}
          description={
            <SetupDescription setup={setup}>
              {generationSummary(setup.configData, setup.builderConnected, t)}
            </SetupDescription>
          }
          control={
            setup.configLoading ? null : canManage ? (
              setup.generationStep ? (
                <KeysDialogButton
                  step={setup.generationStep}
                  title={t("settings.manualGenerationKeys")}
                  label={
                    setup.configData?.geminiConfigured ||
                    setup.configData?.openaiConfigured
                      ? t("settings.manage")
                      : t("settings.addKeys")
                  }
                  onSaved={setup.refreshSetup}
                />
              ) : null
            ) : (
              <ReadOnlySettingValue
                value={statusLabel(setup.generationReady)}
                reason={readOnlyReason}
              />
            )
          }
        >
          {setup.setupIssue ? (
            <p role="alert" className="text-sm leading-6 text-destructive">
              {setup.setupIssue}
            </p>
          ) : null}
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup id="asset-storage" title={t("settings.storage")}>
        <SettingsRow
          id="object-storage"
          label={t("settings.objectStorage")}
          description={
            <SetupDescription setup={setup}>
              {setup.storageReady
                ? t("settings.storageReady")
                : t("settings.storageNeedsSetup")}
            </SetupDescription>
          }
          control={
            setup.configLoading ? null : canManage ? (
              setup.storageStep ? (
                <KeysDialogButton
                  step={setup.storageStep}
                  title={t("settings.objectStorage")}
                  label={
                    setup.configData?.objectStorageConfigured
                      ? t("settings.manage")
                      : t("settings.setUp")
                  }
                  onSaved={setup.refreshSetup}
                />
              ) : null
            ) : (
              <ReadOnlySettingValue
                value={statusLabel(setup.storageReady)}
                reason={readOnlyReason}
              />
            )
          }
        />
      </SettingsGroup>
    </>
  );
}

function SetupDescription({
  setup,
  children,
}: {
  setup: GenerationSetup;
  children: ReactNode;
}) {
  const t = useT();
  if (setup.configLoading) {
    // A span, not the Skeleton div: SettingsRow renders descriptions in a <p>.
    return (
      <span className="skeleton-shimmer mt-1 block h-4 w-64 max-w-full rounded-md bg-muted" />
    );
  }
  if (setup.configFailed) {
    return (
      <span role="alert" className="text-destructive">
        {t("settings.setupLoadFailed")}
      </span>
    );
  }
  return <>{children}</>;
}

function BuilderControl({ setup }: { setup: GenerationSetup }) {
  const t = useT();
  const { navigate } = useSettingsShell();
  const { flow } = setup;
  if (setup.configLoading) return null;
  if (setup.builderConnected) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => navigate("integrations", "builder")}
      >
        {t("settings.manage")}
      </Button>
    );
  }
  return (
    <BuilderConnectPopover flow={flow}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={flow.connecting}
      >
        {flow.connecting ? (
          <>
            <IconLoader2 className="size-3.5 animate-spin" />
            {t("settings.connecting")}
          </>
        ) : (
          t("settings.connect")
        )}
      </Button>
    </BuilderConnectPopover>
  );
}

function KeysDialogButton({
  step,
  title,
  label,
  onSaved,
}: {
  step: OnboardingStepStatus;
  title: string;
  label: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <ManualMethodFields
            step={step}
            showMethodDescription={false}
            onSaved={async () => {
              await onSaved();
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
