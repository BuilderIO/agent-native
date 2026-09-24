import { SegmentProvenancePopoverView } from "@agent-native/toolkit/context-ui";
import type React from "react";

import type { ContextManifestSegment } from "../../shared/context-xray.js";

export function SegmentProvenancePopover({
  segment,
  children,
}: {
  segment: ContextManifestSegment;
  children: React.ReactNode;
}) {
  return (
    <SegmentProvenancePopoverView segment={segment}>
      {children}
    </SegmentProvenancePopoverView>
  );
}
