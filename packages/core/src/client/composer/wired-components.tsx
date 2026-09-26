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
import { useCallback, useState } from "react";

import { readClientAppState } from "../application-state.js";
import { ExternalAgentNudge } from "../external-agent-host.js";
import { FileStorageSetupPopover } from "../FileStorageSetupCard.js";
import { useFileUploadStatus } from "../uploads/use-file-upload-status.js";
import { CoreComposerRuntimeProvider } from "./runtime-adapters.js";

export function PromptComposer(props: PromptComposerProps) {
  const fileUploadStatus = useFileUploadStatus(
    props.attachmentsEnabled !== false,
  );
  const fileStorageConfigured =
    fileUploadStatus.data?.configured === true && !fileUploadStatus.isError;
  const attachmentsEnabled =
    props.attachmentsEnabled !== false && fileStorageConfigured;
  const [storageSetupOpen, setStorageSetupOpen] = useState(false);
  const [storageAnchorRect, setStorageAnchorRect] = useState<DOMRect | null>(
    null,
  );
  const requestStorageSetup = useCallback((anchor?: HTMLElement) => {
    const target =
      anchor ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    setStorageAnchorRect(target?.getBoundingClientRect() ?? null);
    window.setTimeout(() => setStorageSetupOpen(true), 220);
  }, []);
  const onAttachmentRequest =
    props.onAttachmentRequest ??
    (props.attachmentsEnabled !== false && !fileStorageConfigured
      ? requestStorageSetup
      : undefined);

  return (
    <div className="relative w-full min-w-0">
      <FileStorageSetupPopover
        open={storageSetupOpen && !fileStorageConfigured}
        onOpenChange={(open) => {
          setStorageSetupOpen(open);
          if (!open) setStorageAnchorRect(null);
        }}
        onConnected={() => void fileUploadStatus.refetch()}
        onRetryStatus={() => void fileUploadStatus.refetch()}
        status={
          fileUploadStatus.isError
            ? "unavailable"
            : fileUploadStatus.data?.configured === false
              ? "missing"
              : "checking"
        }
        anchorRect={storageAnchorRect}
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
