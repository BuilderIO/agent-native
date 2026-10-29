import { callAction } from "@agent-native/core/client/hooks";
import {
  FirstOutputNextStepBar,
  type FirstOutputNextStepLabels,
} from "@agent-native/toolkit/app-shell";
import { useEffect, useRef, useState } from "react";

import { trackDesignRelay } from "@/lib/design-relay-tracking";

export async function enrollWithRetry<T>(
  request: () => Promise<T>,
  delay: () => Promise<void> = () =>
    new Promise((resolve) => setTimeout(resolve, 300)),
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await request();
    } catch {
      await delay();
    }
  }
  return request();
}

export function DesignFirstOutputNextStep({
  outputId,
  userScope,
  actionsAvailable,
  labels,
  onRefine,
  onExport,
  onShareLink,
}: {
  outputId: string;
  userScope?: string;
  generationActive: boolean;
  outputReady: boolean;
  actionsAvailable: boolean;
  labels: FirstOutputNextStepLabels;
  onRefine: () => void;
  onExport: () => void;
  onShareLink: () => void;
}) {
  useEffect(() => {
    if (userScope)
      trackDesignRelay("design_experiment_editor_visit", {
        output_id: outputId,
      });
  }, [outputId, userScope]);

  const [ready, setReady] = useState<{ runId: string; turnId: string } | null>(
    null,
  );
  const enrolledRef = useRef(false);
  const [variant, setVariant] = useState<"control" | "next_step" | null>(null);

  useEffect(() => {
    const handleReady = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          designId: string;
          runId: string;
          turnId: string;
        }>
      ).detail;
      if (detail.designId === outputId)
        setReady({ runId: detail.runId, turnId: detail.turnId });
    };
    window.addEventListener("design:verified-generation-ready", handleReady);
    return () =>
      window.removeEventListener(
        "design:verified-generation-ready",
        handleReady,
      );
  }, [outputId]);

  useEffect(() => {
    if (!ready || !actionsAvailable || !userScope || enrolledRef.current)
      return;
    const storageKey = `agent-native:first-output-next-step:design:${encodeURIComponent(userScope)}:v1`;
    try {
      if (window.localStorage.getItem(storageKey) === "1") return;
    } catch {
      // coercion-ok: server claims still deduplicate when local storage is unavailable.
    }
    enrolledRef.current = true;
    void enrollWithRetry(() =>
      callAction<{ variant: "control" | "next_step" | null }>(
        "enroll-first-output-experiment" as never,
        { outputId, runId: ready.runId, turnId: ready.turnId } as never,
        { uiOnly: true },
      ),
    )
      .then((result) => {
        if (result.variant === "control") {
          try {
            window.localStorage.setItem(storageKey, "1");
          } catch {
            // coercion-ok: the durable server claim prevents re-enrollment without local storage.
          }
        }
        setVariant(result.variant);
      })
      .catch((error: unknown) => {
        console.error("Failed to enroll in first output experiment", error);
      });
  }, [ready, actionsAvailable, userScope, outputId]);

  if (!actionsAvailable || variant !== "next_step") return null;

  return (
    <FirstOutputNextStepBar
      appId="design"
      {...(userScope ? { userScope } : {})}
      outputId={outputId}
      ready={Boolean(ready)}
      positionTargetSelector="[data-multi-screen-canvas-surface]"
      labels={labels}
      onRefine={onRefine}
      onExport={onExport}
      onShareLink={onShareLink}
      onTrack={(event, properties) => trackDesignRelay(event, properties)}
    />
  );
}
