import { useT } from "@agent-native/core/client/i18n";
import {
  CanvasCommentPins as ToolkitCanvasCommentPins,
  type CanvasCommentPinsProps as ToolkitCanvasCommentPinsProps,
} from "@agent-native/toolkit/canvas-annotations";
import { toast } from "sonner";

import { sendToDesignAgentChatAndConfirm } from "@/lib/agent-chat";

export type { CanvasPin } from "@agent-native/toolkit/canvas-annotations";

export type CanvasCommentPinsProps = Omit<
  ToolkitCanvasCommentPinsProps,
  "translate" | "sendToAgent" | "onSendError"
>;

export function CanvasCommentPins(props: CanvasCommentPinsProps) {
  const translate = useT();
  return (
    <ToolkitCanvasCommentPins
      {...props}
      translate={translate}
      sendToAgent={async (input) =>
        (await sendToDesignAgentChatAndConfirm(input)).delivered
      }
      onSendError={() =>
        toast.error(translate("visualEditor.annotationSendError"))
      }
    />
  );
}
