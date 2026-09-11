import {
  addCodeAgentCommandToAllowlist,
  appendCodeAgentTranscriptEvent,
  updateCodeAgentRunRecord,
} from "./code-agent-runs.js";
import { appendMultiFrontierParticipantEvent } from "./multi-frontier-runs.js";

const [operation, runId, value] = process.argv.slice(2);

if (operation === "code-update") {
  updateCodeAgentRunRecord(runId, (record) => ({
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
