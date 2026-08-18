import { ContextSegmentRowView } from "@agent-native/toolkit/context-ui";

import type { ContextManifestSegment } from "../../shared/context-xray.js";

export function ContextSegmentRow({
  segment,
  advisory,
  onPin,
  onEvict,
  onRestore,
}: {
  segment: ContextManifestSegment;
  advisory: boolean;
  onPin: () => void;
  onEvict: () => void;
  onRestore: () => void;
}) {
  return (
    <ContextSegmentRowView
      segment={segment}
      advisory={advisory}
      onPin={onPin}
      onEvict={onEvict}
      onRestore={onRestore}
    />
  );
}
