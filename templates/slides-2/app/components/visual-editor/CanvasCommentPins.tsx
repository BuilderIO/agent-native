import { sendToAgentChatAndConfirm } from "@agent-native/core/client/agent-chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  CanvasCommentPins as ToolkitCanvasCommentPins,
  type CanvasCommentPinsProps as ToolkitCanvasCommentPinsProps,
} from "@agent-native/toolkit/canvas-annotations";
import { toast } from "sonner";

export type { CanvasPin } from "@agent-native/toolkit/canvas-annotations";

export type CanvasCommentPinsProps = Omit<
  ToolkitCanvasCommentPinsProps,
  "translate" | "sendToAgent" | "onSendError"
>;

export function CanvasCommentPins(props: CanvasCommentPinsProps) {
  const t = useT();
  const keyMap: Record<string, string> = {
    "visualEditor.clickToDropCommentPin": "raw.pinDropHint",
    "visualEditor.escToExit": "raw.escExit",
    "visualEditor.editDesign": "raw.editSlide",
    "visualEditor.tellAgentWhatToChange": "raw.tellAgentChange",
    "visualEditor.send": "raw.sendToAgent",
    "visualEditor.comment": "comments.comment",
    "visualEditor.commentSent": "raw.sentToAgent",
  };
  const translate: ToolkitCanvasCommentPinsProps["translate"] = (
    key,
    options,
  ) => t(keyMap[key] ?? key, options);
  return (
    <ToolkitCanvasCommentPins
      {...props}
      translate={translate}
      allowQueue={false}
      showAnchorDetails={false}
      showSubmitShortcut={false}
      sendToAgent={async (input) =>
        (await sendToAgentChatAndConfirm(input)).delivered
      }
      onSendError={() =>
        toast.error(translate("deckEditor.failedToSubmitPrompt"))
      }
    />
  );
}
