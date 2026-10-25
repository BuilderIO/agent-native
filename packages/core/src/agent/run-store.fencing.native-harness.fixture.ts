import { createInterface } from "node:readline";

const sessionId = process.argv[2];
if (!sessionId) throw new Error("A resumed session id is required");

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
process.stdout.write(`${JSON.stringify({ type: "ready", sessionId })}\n`);

input.on("line", (line) => {
  let message: {
    type?: string;
    id?: string;
    approved?: boolean;
    prompt?: string;
  };
  try {
    message = JSON.parse(line) as typeof message;
  } catch {
    process.stderr.write("Invalid harness fixture message\n");
    process.exitCode = 1;
    input.close();
    return;
  }
  if (message.type === "start-turn") {
    process.stdout.write(
      `${JSON.stringify({
        type: "approval-request",
        id: `${sessionId}:approval`,
        tool: "write_file",
        message: `Approve native action: ${message.prompt ?? ""}`,
      })}\n`,
    );
  }
  if (message.type === "approve" && typeof message.id === "string") {
    process.stdout.write(
      `${JSON.stringify({
        type: "approval-ack",
        sessionId,
        id: message.id,
        approved: message.approved === true,
      })}\n`,
    );
  }
});
