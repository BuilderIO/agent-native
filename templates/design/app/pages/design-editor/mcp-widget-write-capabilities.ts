export interface DesignEditorWriteCapabilities {
  canEditDesign: boolean;
  canEditLiveScreens: boolean;
  publicVisualEdit: boolean;
  canCommentDesign: boolean;
  canRenderAuthenticatedShare: boolean;
}

export function shouldShowFullDesignProjectMenu(widgetEmbed: boolean): boolean {
  return !widgetEmbed;
}

export function shouldRenderDesignShareControl({
  widgetEmbed,
  canShareDesign,
  canRenderAuthenticatedShare,
}: {
  widgetEmbed: boolean;
  canShareDesign: boolean;
  canRenderAuthenticatedShare: boolean;
}): boolean {
  return canRenderAuthenticatedShare && (!widgetEmbed || canShareDesign);
}

export function applyMcpDirectoryWidgetWritePolicy(
  capabilities: DesignEditorWriteCapabilities,
  isDirectoryWidget: boolean,
  isWritableWidget: boolean,
): DesignEditorWriteCapabilities {
  if (!isDirectoryWidget) return capabilities;
  // The scoped ticket narrows writes; the resolved design role still grants them.
  return {
    ...capabilities,
    canEditDesign: capabilities.canEditDesign && isWritableWidget,
  };
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
