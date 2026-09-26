import {
  PromptBar as ToolkitPromptBar,
  PromptComposer as ToolkitPromptComposer,
  RealtimeVoiceModeBoundary as ToolkitRealtimeVoiceModeBoundary,
  RealtimeVoiceModeProvider as ToolkitRealtimeVoiceModeProvider,
  TiptapComposer as ToolkitTiptapComposer,
  readRealtimeVoiceContextWith,
  type PromptBarProps,
  type PromptComposerProps,
  type RealtimeVoiceModeProviderProps,
  type TiptapComposerProps,
} from "@agent-native/toolkit/composer";

import { readClientAppState } from "../application-state.js";
import { ExternalAgentNudge } from "../external-agent-host.js";
import { FileStorageSetupCard } from "../FileStorageSetupCard.js";
import { useT } from "../i18n.js";
import { useFileUploadStatus } from "../uploads/use-file-upload-status.js";
import { CoreComposerRuntimeProvider } from "./runtime-adapters.js";

export function PromptComposer(props: PromptComposerProps) {
  const t = useT();
  const fileUploadStatus = useFileUploadStatus(
    props.attachmentsEnabled !== false,
  );
  const fileStorageConfigured =
    fileUploadStatus.data?.configured === true && !fileUploadStatus.isError;
  const attachmentsEnabled =
    props.attachmentsEnabled !== false && fileStorageConfigured;

  return (
    <div className="relative w-full min-w-0">
      {props.attachmentsEnabled !== false && !fileStorageConfigured ? (
        fileUploadStatus.data?.configured === false &&
        !fileUploadStatus.isError ? (
          <FileStorageSetupCard />
        ) : (
          <div
            className="mb-2 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
            role="status"
          >
            <span>{t("onboarding.fileStorage.title")}</span>
            {fileUploadStatus.isError ? (
              <button
                type="button"
                className="shrink-0 font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void fileUploadStatus.refetch()}
              >
                {t("agentChat.common.retry")}
              </button>
            ) : null}
          </div>
        )
      ) : null}
      <CoreComposerRuntimeProvider>
        <ToolkitPromptComposer
          {...props}
          attachmentsEnabled={attachmentsEnabled}
        />
      </CoreComposerRuntimeProvider>
      <ExternalAgentNudge variant="prompt" />
    </div>
  );
}

export function PromptBar(props: PromptBarProps) {
  return (
    <CoreComposerRuntimeProvider>
      <ToolkitPromptBar {...props} />
    </CoreComposerRuntimeProvider>
  );
}

export function TiptapComposer(props: TiptapComposerProps) {
  return (
    <CoreComposerRuntimeProvider>
      <ToolkitTiptapComposer {...props} />
    </CoreComposerRuntimeProvider>
  );
}

export function RealtimeVoiceModeProvider(
  props: RealtimeVoiceModeProviderProps,
) {
  return (
    <CoreComposerRuntimeProvider>
      <ToolkitRealtimeVoiceModeProvider {...props} />
    </CoreComposerRuntimeProvider>
  );
}

export function RealtimeVoiceModeBoundary(
  props: RealtimeVoiceModeProviderProps,
) {
  return (
    <CoreComposerRuntimeProvider>
      <ToolkitRealtimeVoiceModeBoundary {...props} />
    </CoreComposerRuntimeProvider>
  );
}

export function readRealtimeVoiceContext() {
  return readRealtimeVoiceContextWith({ readAppState: readClientAppState });
}
