import { runNativeHostPump } from "./host";

void runNativeHostPump({ input: process.stdin, output: process.stdout }).catch(
  (error) => {
    process.stderr.write(
      `[agent-native-chrome-host] ${error instanceof Error ? error.message : "Native host stopped."}\n`,
    );
    process.exitCode = 1;
  },
);
