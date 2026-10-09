export interface DesignEditorWriteCapabilities {
  canEditDesign: boolean;
  canEditLiveScreens: boolean;
  publicVisualEdit: boolean;
  canCommentDesign: boolean;
  canRenderAuthenticatedShare: boolean;
}

export function applyMcpDirectoryWidgetWritePolicy(
  capabilities: DesignEditorWriteCapabilities,
  isWritableWidget: boolean,
): DesignEditorWriteCapabilities {
  if (!isWritableWidget) return capabilities;
  return { ...capabilities, canEditDesign: true };
}

export function applyMcpDirectoryWidgetReadOnlyPolicy(
  capabilities: DesignEditorWriteCapabilities,
  isReadOnlyWidget: boolean,
): DesignEditorWriteCapabilities {
  if (!isReadOnlyWidget) return capabilities;
  return {
    canEditDesign: false,
    canEditLiveScreens: false,
    publicVisualEdit: false,
    canCommentDesign: false,
    canRenderAuthenticatedShare: false,
  };
}
