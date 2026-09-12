import type { AgentStreamIntegrityReport } from "@agent-native/agentkit/protocol";

import { trackEvent } from "../analytics.js";

export const AGENTKIT_STREAM_INTEGRITY_EVENT = "agentkit_stream_integrity";

/**
 * AgentKit detects these but cannot fix them, and every one is silent from the
 * user's side: a gap or duplicate means the transport and the reducer disagree
 * about ordering, a missing terminal makes a finished run look frozen, and a
 * dropped promotion means a queued follow-up never runs. Counting them by
 * surface is what makes a bad migration attributable to the surface that
 * regressed rather than to AgentKit in general.
 */
export function createAgentKitIntegrityReporter(
  surface: string,
): (report: AgentStreamIntegrityReport) => void {
  return (report) => {
    trackEvent(AGENTKIT_STREAM_INTEGRITY_EVENT, {
      code: report.code,
      surface,
      reason: report.reason,
      thread_id: report.threadId,
      run_id: report.runId,
      expected_sequence: report.expectedSequence,
      received_sequence: report.receivedSequence,
    });
  };
}
