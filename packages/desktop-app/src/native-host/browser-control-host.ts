import fs from "node:fs";

const MAX_NATIVE_MESSAGE_BYTES = 64 * 1024 * 1024;

type HostConfig = { baseUrl: string; bearerToken: string };

function loadConfig(): HostConfig {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("Native host config path is missing.");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as HostConfig;
  const url = new URL(config.baseUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !/^[A-Za-z0-9_-]{32,}$/.test(config.bearerToken)
  ) {
    throw new Error("Native host config is invalid.");
  }
  return config;
}

function writeNativeMessage(value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  if (body.byteLength > MAX_NATIVE_MESSAGE_BYTES) return;
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.byteLength, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

async function postMessage(config: HostConfig, value: unknown): Promise<void> {
  await fetch(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.bearerToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(value),
  });
}

function readNativeMessages(config: HostConfig): void {
  let buffered = Buffer.alloc(0);
  process.stdin.on("data", (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (buffered.byteLength >= 4) {
      const size = buffered.readUInt32LE(0);
      if (size <= 0 || size > MAX_NATIVE_MESSAGE_BYTES) {
        process.exitCode = 1;
        process.stdin.destroy();
        return;
      }
      if (buffered.byteLength < size + 4) return;
      const body = buffered.subarray(4, size + 4);
      buffered = buffered.subarray(size + 4);
      try {
        const message = JSON.parse(body.toString("utf8"));
        void postMessage(config, message).catch(() => undefined);
      } catch {
        // Ignore malformed extension messages without corrupting stdout framing.
      }
    }
  });
}

async function poll(config: HostConfig): Promise<void> {
  let retryMs = 250;
  while (!process.stdin.destroyed) {
    try {
      const response = await fetch(`${config.baseUrl}/v1/commands`, {
        headers: { authorization: `Bearer ${config.bearerToken}` },
      });
      if (response.status === 200) {
        const text = await response.text();
        if (Buffer.byteLength(text) <= MAX_NATIVE_MESSAGE_BYTES) {
          writeNativeMessage(JSON.parse(text));
        }
      } else if (response.status === 401 || response.status === 404) {
        return;
      }
      retryMs = 250;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      retryMs = Math.min(retryMs * 2, 5_000);
    }
  }
}

try {
  const config = loadConfig();
  readNativeMessages(config);
  void poll(config).finally(() => process.exit());
} catch (error) {
  process.stderr.write(
    `[agent-native-browser-host] ${error instanceof Error ? error.message : "startup failed"}\n`,
  );
  process.exit(1);
}
