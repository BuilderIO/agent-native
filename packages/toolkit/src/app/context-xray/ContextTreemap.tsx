import type {
  ContextManifestSegment,
  ContextManifestSystemSection,
} from "@agent-native/core/shared/context-xray";
import { ContextTreemapView } from "@agent-native/toolkit/context-ui";

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
