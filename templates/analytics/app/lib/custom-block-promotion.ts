import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";

export interface CustomBlockPromotionContext {
  dashboardId: string;
  dashboardName?: string;
  panelId: string;
  panelTitle: string;
  extensionId: string;
  nativeGapReason?: unknown;
}

const NATIVE_GAP_REASONS = new Set([
  "custom-visualization",
  "custom-interaction",
  "custom-layout",
  "other",
]);

function normalizeNativeGapReason(value: unknown): string | undefined {
  return typeof value === "string" && NATIVE_GAP_REASONS.has(value)
    ? value
    : undefined;
}

export function buildCustomBlockPromotionRequest(
  context: CustomBlockPromotionContext,
  message: string,
): AgentChatMessage {
  const promotion = {
    version: 1,
    operation: "promote-to-app-code",
    source: {
      kind: "analytics-custom-block",
      dashboardId: context.dashboardId,
      dashboardName: context.dashboardName,
      panelId: context.panelId,
      panelTitle: context.panelTitle,
      extensionId: context.extensionId,
      nativeGapReason: normalizeNativeGapReason(context.nativeGapReason),
    },
    target: {
      kind: "native-analytics-feature",
      reusable: true,
    },
    preserveSource: true,
  };

  return {
    message,
    context:
      "<analytics-custom-block-promotion>\n" +
      `${JSON.stringify(promotion, null, 2)}\n` +
      "The user explicitly chose Promote to app code. Call `connect-builder` with this request and artifact context. Preserve the existing custom block until the native implementation is reviewed and deployed; do not delete or replace it automatically.\n" +
      "</analytics-custom-block-promotion>",
    submit: true,
    newTab: true,
    openSidebar: true,
    chatTarget: "local",
    type: "content",
    preset: "analytics-custom-block-promotion",
  };
}
