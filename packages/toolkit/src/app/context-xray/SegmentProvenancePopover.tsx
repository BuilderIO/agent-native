import type { ContextManifestSegment } from "@agent-native/core/shared/context-xray";
import { SegmentProvenancePopoverView } from "@agent-native/toolkit/context-ui";
import type React from "react";

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
