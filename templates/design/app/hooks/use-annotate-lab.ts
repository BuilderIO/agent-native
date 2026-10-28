import { useLabState } from "@agent-native/core/client/labs";
import { ANNOTATE_LAB } from "@shared/labs";

import type { AnnotateLabStatus } from "@/pages/design-editor/tool-state";

/**
 * The Annotate lab, read from its definition so it reads off (not on) until the
 * server answers. `loading` lets a request that needs the lab wait for it.
 */
export function useAnnotateLab(): AnnotateLabStatus {
  const lab = useLabState(ANNOTATE_LAB);
  if (lab.enabled) return "on";
  return lab.isLoading ? "loading" : "off";
}
