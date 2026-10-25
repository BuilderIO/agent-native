import type { RunChunkControl } from "../run-manager.js";
import type {
  AgentHarnessEvent,
  AgentHarnessSession,
  AgentHarnessTurnInput,
} from "./types.js";

export interface DriveAgentHarnessTurnChunksOptions {
  session: AgentHarnessSession;
  input?: AgentHarnessTurnInput;
  control: Pick<
    RunChunkControl,
    "turnSignal" | "chunkSignal" | "chunkBoundaryReason" | "beginChunk"
  >;
  consume: (stream: AsyncIterable<AgentHarnessEvent>) => Promise<"stop" | void>;
  afterStream?: () => Promise<"stop" | void>;
}

export async function driveAgentHarnessTurnChunks(
  options: DriveAgentHarnessTurnChunksOptions,
): Promise<void> {
  let input = options.input;
  let firstStream = input !== undefined;

  while (!options.control.turnSignal.aborted) {
    const stream = firstStream
      ? options.session.streamTurn({
          ...input,
          abortSignal: options.control.chunkSignal,
        })
      : options.session.continueTurn?.({
          abortSignal: options.control.chunkSignal,
        });
    firstStream = false;
    input = undefined;
    if (!stream) return;

    if ((await options.consume(stream)) === "stop") return;
    if (options.control.turnSignal.aborted) return;
    if ((await options.afterStream?.()) === "stop") return;
    if (!options.control.chunkBoundaryReason()) return;
    if (!options.session.continueTurn) return;
    if (options.control.beginChunk().aborted) return;
  }
}
