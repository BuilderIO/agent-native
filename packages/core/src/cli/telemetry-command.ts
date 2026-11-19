import {
  cliTelemetryMode,
  resetInstallId,
  setTelemetryEnabled,
  TELEMETRY_DOCS_URL,
  telemetryOffReason,
} from "./telemetry-settings.js";

const TELEMETRY_HELP = `agent-native telemetry — control anonymous usage data

Usage:
  agent-native telemetry status    Show whether telemetry is on
  agent-native telemetry disable   Turn it off on this machine
  agent-native telemetry enable    Turn it back on
  agent-native telemetry reset     Replace this machine's random ID

The setting covers @agent-native/core and @agent-native/skills. DO_NOT_TRACK=1
and AGENT_NATIVE_TELEMETRY_DISABLED=1 also turn it off, and
AGENT_NATIVE_TELEMETRY_DEBUG=1 prints each event instead of sending it.

${TELEMETRY_DOCS_URL}`;

function printStatus(): void {
  const reason = telemetryOffReason();
  if (!reason) {
    console.log("Agent-Native telemetry is on.");
    console.log('Run "npx @agent-native/core telemetry disable" to opt out.');
  } else if (reason === "setting") {
    console.log("Agent-Native telemetry is off.");
  } else {
    console.log(`Agent-Native telemetry is off because ${reason} is set.`);
  }
  if (cliTelemetryMode() === "debug") {
    console.log(
      "AGENT_NATIVE_TELEMETRY_DEBUG is set, so events print to stderr and nothing is sent.",
    );
  }
  console.log(TELEMETRY_DOCS_URL);
}

export function runTelemetryCommand(args: string[]): void {
  const subcommand = args[0] ?? "status";
  switch (subcommand) {
    case "status":
      printStatus();
      return;
    case "disable":
      setTelemetryEnabled(false);
      console.log("Agent-Native telemetry is off on this machine.");
      return;
    case "enable": {
      setTelemetryEnabled(true);
      const reason = telemetryOffReason();
      console.log(
        reason
          ? `Agent-Native telemetry is enabled, but stays off while ${reason} is set.`
          : "Agent-Native telemetry is on.",
      );
      return;
    }
    case "reset":
      resetInstallId();
      console.log("This machine has a new random ID.");
      return;
    case "help":
    case "--help":
    case "-h":
      console.log(TELEMETRY_HELP);
      return;
    default:
      console.error(`Unknown telemetry command: ${subcommand}\n`);
      console.error(TELEMETRY_HELP);
      process.exitCode = 1;
  }
}
