import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/toolkit/app/chat/agentkit-chat/index";
import { lazy, Suspense } from "react";

const VisualAnswerInline = lazy(
  () => import("@/components/plan/VisualAnswerInline"),
);

registerActionChatRenderer({
  id: "plan.visual-answer",
  renderer: "plan.visual-answer",
  Component: (props: ToolRendererProps) => (
    <Suspense fallback={null}>
      <VisualAnswerInline {...props} />
    </Suspense>
  ),
});
