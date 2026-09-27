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
import { useCallback, useEffect, useRef, useState } from "react";

import { readClientAppState } from "../application-state.js";
import { ExternalAgentNudge } from "../external-agent-host.js";
import { FileStorageSetupPopover } from "../FileStorageSetupPopover.js";
import { useFileUploadStatus } from "../uploads/use-file-upload-status.js";
import { CoreComposerRuntimeProvider } from "./runtime-adapters.js";

export function PromptComposer(props: PromptComposerProps) {
  const storageAnchorRef = useRef<HTMLDivElement>(null);
  const fileUploadStatus = useFileUploadStatus(
    props.attachmentsEnabled !== false,
  );
  const fileStorageConfigured =
    fileUploadStatus.data?.configured === true && !fileUploadStatus.isError;
  const attachmentsEnabled =
    props.attachmentsEnabled !== false && fileStorageConfigured;
  const [storagePromptOpen, setStoragePromptOpen] = useState(false);
  const openStoragePrompt = useCallback(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setStoragePromptOpen(true);
  }, []);
  const onAttachmentRequest =
    props.onAttachmentRequest ??
    (props.attachmentsEnabled === false || fileStorageConfigured
      ? undefined
      : openStoragePrompt);

  useEffect(() => {
    if (fileStorageConfigured) setStoragePromptOpen(false);
  }, [fileStorageConfigured]);

  return (
    <div ref={storageAnchorRef} className="relative w-full min-w-0">
      <FileStorageSetupPopover
        open={storagePromptOpen}
        onOpenChange={setStoragePromptOpen}
        anchorRef={storageAnchorRef}
        onConnected={() => void fileUploadStatus.refetch()}
        {...(!fileUploadStatus.isSuccess || fileUploadStatus.isError
          ? {
              status: "unavailable" as const,
              onRetry: () => void fileUploadStatus.refetch(),
            }
          : { status: "missing" as const })}
      />
      <CoreComposerRuntimeProvider>
        <ToolkitPromptComposer
          {...props}
          attachmentsEnabled={attachmentsEnabled}
          onAttachmentRequest={onAttachmentRequest}
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
