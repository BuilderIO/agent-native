import { ContextTreemapView } from "@agent-native/toolkit/context-ui";

import type {
  ContextManifestSegment,
  ContextManifestSystemSection,
} from "../../shared/context-xray.js";

export function ContextTreemap({
  segments,
  systemSections = [],
  onSelect,
}: {
  segments: ContextManifestSegment[];
  systemSections?: ContextManifestSystemSection[];
  onSelect?: (segmentId: string) => void;
}) {
  return (
    <ContextTreemapView
      segments={segments}
      systemSections={systemSections}
      onSelect={onSelect}
    />
  );
}
