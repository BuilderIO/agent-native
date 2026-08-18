import {
  PromptComposer as ToolkitPromptComposer,
  RealtimeVoiceModeBoundary as ToolkitRealtimeVoiceModeBoundary,
  RealtimeVoiceModeProvider as ToolkitRealtimeVoiceModeProvider,
  TiptapComposer as ToolkitTiptapComposer,
  readRealtimeVoiceContextWith,
  type PromptComposerProps,
  type RealtimeVoiceModeProviderProps,
  type TiptapComposerProps,
} from "@agent-native/toolkit/composer";

import { readClientAppState } from "../application-state.js";
import { CoreComposerRuntimeProvider } from "./runtime-adapters.js";

export function PromptComposer(props: PromptComposerProps) {
  return (
    <CoreComposerRuntimeProvider>
      <ToolkitPromptComposer {...props} />
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
