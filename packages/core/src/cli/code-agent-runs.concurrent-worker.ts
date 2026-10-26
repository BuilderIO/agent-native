import {
  addCodeAgentCommandToAllowlist,
  appendCodeAgentTranscriptEvent,
  updateCodeAgentRunRecord,
} from "./code-agent-runs.js";
import { appendMultiFrontierParticipantEvent } from "./multi-frontier-runs.js";

const [operation, runId, value] = process.argv.slice(2);
if (runId === undefined || value === undefined) {
  throw new Error("Usage: <operation> <run id> <value>");
}

if (operation === "code-update") {
  updateCodeAgentRunRecord(runId, () => ({
    metadata: { [value]: true },
  }));
} else if (operation === "code-event") {
  appendCodeAgentTranscriptEvent({
    id: value,
    runId,
    kind: "status",
    message: "Concurrent event",
  });
} else if (operation === "multi-event") {
  appendMultiFrontierParticipantEvent({
    id: value,
    collaborationId: runId,
    participantId: "codex",
    generation: 1,
    permission: "workspace_write",
  });
} else if (operation === "allowlist") {
  addCodeAgentCommandToAllowlist(value);
} else {
  throw new Error(`Unknown concurrency worker operation: ${operation}`);
}
