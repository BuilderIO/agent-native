import { ContextXRayPanelView } from "@agent-native/toolkit/context-ui";

import type {
  ContextManifest,
  ContextSegmentStatus,
} from "../../shared/context-xray.js";
import {
  manifestConversationTokens,
  manifestSystemTokens,
} from "../../shared/context-xray.js";
import { useT } from "../i18n.js";
import { resolveContextWindow } from "./format.js";

export function ContextXRayPanel({
  manifest,
  optimistic,
  onPin,
  onEvict,
  onRestore,
}: {
  manifest: ContextManifest;
  optimistic: Map<string, ContextSegmentStatus>;
  onPin: (segmentId: string) => void;
  onEvict: (segmentId: string) => void;
  onRestore: (segmentId: string) => void;
}) {
  const t = useT();
  return (
    <ContextXRayPanelView
      manifest={{
        ...manifest,
        systemTokens: manifestSystemTokens(manifest),
        conversationTokens: manifestConversationTokens(manifest),
      }}
      contextWindow={resolveContextWindow(manifest.model)}
      optimistic={optimistic}
      onPin={onPin}
      onEvict={onEvict}
      onRestore={onRestore}
      titleLabel={t("contextXray.pageTitle", {
        defaultValue: "Context X-Ray",
      })}
      systemOrderedLabel={t("contextXray.systemOrdered", {
        defaultValue: "System · ordered, not evictable",
      })}
      governanceLabels={{
        required: t("contextXray.governance.required", {
          defaultValue: "Required",
        }),
        inherited: t("contextXray.governance.inherited", {
          defaultValue: "Inherited",
        }),
        user: t("contextXray.governance.user", {
          defaultValue: "Your context",
        }),
      }}
    />
  );
}
