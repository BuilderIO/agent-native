import { trackEvent } from "@agent-native/core/client/analytics";
import {
  FirstOutputNextStepBar,
  type FirstOutputNextStepLabels,
} from "@agent-native/toolkit/app-shell";
import { useEffect, useRef, useState } from "react";

export function DesignFirstOutputNextStep({
  outputId,
  userScope,
  generationActive,
  outputReady,
  labels,
  onRefine,
  onExport,
  onShareLink,
}: {
  outputId: string;
  userScope?: string;
  generationActive: boolean;
  outputReady: boolean;
  labels: FirstOutputNextStepLabels;
  onRefine: () => void;
  onExport: () => void;
  onShareLink: () => void;
}) {
  const [ready, setReady] = useState(false);
  const sawGenerationRef = useRef(generationActive);

  useEffect(() => {
    if (generationActive) {
      sawGenerationRef.current = true;
      return;
    }
    if (sawGenerationRef.current && outputReady) {
      sawGenerationRef.current = false;
      setReady(true);
    }
  }, [generationActive, outputReady]);

  return (
    <FirstOutputNextStepBar
      appId="design"
      {...(userScope ? { userScope } : {})}
      outputId={outputId}
      ready={ready}
      labels={labels}
      onRefine={onRefine}
      onExport={onExport}
      onShareLink={onShareLink}
      onTrack={(event, properties) => trackEvent(event, properties)}
    />
  );
}
