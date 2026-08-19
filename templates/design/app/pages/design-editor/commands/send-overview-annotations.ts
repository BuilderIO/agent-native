import type { Dispatch, RefObject, SetStateAction } from "react";
import { toast } from "sonner";

import type { DrawAnnotation } from "@/components/visual-editor/DrawOverlay";
import { sendToDesignAgentChatAndConfirm } from "@/lib/agent-chat";
import { prettyScreenName } from "@/lib/screen-names";
import type { OverviewScreen } from "@/pages/design-editor/derive/overview-screens";
import {
  collectOverviewAnnotationViewportMap,
  formatOverviewAnnotationMessage,
} from "@/pages/design-editor/overview-annotation-context";
import type { DesignData } from "@/pages/design-editor/types";

export interface SendOverviewAnnotationsArgs {
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  design: DesignData | null;
  handleExitOverviewDrawMode: () => void;
  id: string | undefined;
  overviewAnnotationSendingRef: RefObject<boolean>;
  overviewCanvasZoom: number;
  overviewScreens: OverviewScreen[];
  setOverviewAnnotationSending: Dispatch<SetStateAction<boolean>>;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export async function runSendOverviewAnnotations(
  {
    canvasContainerRef,
    design,
    handleExitOverviewDrawMode,
    id,
    overviewAnnotationSendingRef,
    overviewCanvasZoom,
    overviewScreens,
    setOverviewAnnotationSending,
    t,
  }: SendOverviewAnnotationsArgs,
  annotations: DrawAnnotation[],
  instruction: string,
  canvasSize: { width: number; height: number },
) {
  if (overviewAnnotationSendingRef.current) return;
  const container = canvasContainerRef.current;
  const viewportMap = container
    ? collectOverviewAnnotationViewportMap({
        container,
        screens: overviewScreens.map((screen) => ({
          id: screen.id,
          name: prettyScreenName(screen.filename),
        })),
        zoom: overviewCanvasZoom,
      })
    : {
        width: canvasSize.width,
        height: canvasSize.height,
        zoom: overviewCanvasZoom,
        screens: [],
      };
  const message = formatOverviewAnnotationMessage({
    designId: id ?? "",
    designTitle: design?.title,
    annotations,
    instruction,
    viewportMap,
  });

  overviewAnnotationSendingRef.current = true;
  setOverviewAnnotationSending(true);
  try {
    const result = await sendToDesignAgentChatAndConfirm({
      message,
      submit: true,
      openSidebar: true,
    });
    if (!result.delivered) {
      throw new Error(
        `Overview annotation message was not delivered to the agent chat (${result.reason ?? "unknown"})`,
      );
    }
    handleExitOverviewDrawMode();
  } catch (error) {
    console.error("[DesignEditor] failed to submit overview drawing:", error);
    toast.error(t("designEditor.toasts.annotationSendError"));
  } finally {
    overviewAnnotationSendingRef.current = false;
    setOverviewAnnotationSending(false);
  }
}
