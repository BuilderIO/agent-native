import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client";
import { lazy, Suspense } from "react";

// Heavy plan-block rendering bundle (diagram/wireframe/api-spec/data-model/…) is
// loaded only when a visual answer actually renders in chat, not at app start.
const VisualAnswerInline = lazy(
  () => import("@/components/plan/VisualAnswerInline"),
);

/**
 * Register Plan's native chat renderers with the core tool-render registry.
 *
 * Imported for its side effect from `root.tsx` so the registration is in the
 * client bundle that hydrates the agent chat. `registerActionChatRenderer` only
 * pushes a closure onto a module array (SSR-safe); the component renders client
 * side when a tool result keyed to `plan.visual-answer` appears in the chat.
 *
 * This is what makes "all those components registered with the chat" real: the
 * renderer dispatches through `planBlockRegistry`, so every registered plan
 * block — including custom ones an app adds — renders inline automatically.
 */
registerActionChatRenderer({
  id: "plan.visual-answer",
  renderer: "plan.visual-answer",
  Component: (props: ToolRendererProps) => (
    <Suspense fallback={null}>
      <VisualAnswerInline {...props} />
    </Suspense>
  ),
});
