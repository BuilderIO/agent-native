import { Terminal } from "../../agentkit/react/terminal.js";

export interface BashCellMeta {
  toolKind: "bash";
  command: string;
  cwd: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
}

interface BashCellProps {
  meta: BashCellMeta;
  output?: string;
  isRunning: boolean;
  /** The call failed before or apart from the command's exit code. */
  isError?: boolean;
}

export function BashCell({ meta, output, isRunning, isError }: BashCellProps) {
  return (
    <Terminal
      className="my-1 w-full"
      command={meta.command}
      output={output}
      running={isRunning}
      exitCode={meta.exitCode}
      durationMs={meta.durationMs}
      timedOut={meta.timedOut}
      failed={isError}
    />
  );
}
