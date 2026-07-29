import { useActionQuery } from "@agent-native/core/client/hooks";
import { useDemoModeStatus } from "@agent-native/core/client/hooks";
import { useMemo } from "react";

import type { ComplianceSnapshot } from "../../shared/types";
import { getDemoComplianceSnapshot } from "./demo-snapshot";

/**
 * Wraps the real `compliance-status` query. When demo mode is on, the
 * displayed snapshot is fully replaced with a fabricated scenario (see
 * `demo-snapshot.ts`) built from the real snapshot's `today` — the real
 * query keeps polling underneath, so turning demo mode back off shows real
 * data instantly with no extra fetch. Backend and agent always see real data;
 * this substitution happens only here, at render time.
 */
export function useComplianceSnapshot() {
  const query = useActionQuery<ComplianceSnapshot>("compliance-status", {});
  const { enabled: isDemo } = useDemoModeStatus();
  const real = query.data;

  const data = useMemo(() => {
    if (!real) return real;
    return isDemo ? getDemoComplianceSnapshot(real.today) : real;
  }, [real, isDemo]);

  return { ...query, data, isDemo };
}
