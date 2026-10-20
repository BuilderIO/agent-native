import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

const httpsPort = Number(process.env.E2E_ATTACHMENT_STORAGE_HTTPS_PORT);
const controlPort = Number(process.env.E2E_ATTACHMENT_STORAGE_CONTROL_PORT);
const certificatePath = process.env.E2E_ATTACHMENT_STORAGE_CERT;
const keyPath = process.env.E2E_ATTACHMENT_STORAGE_KEY;
if (
  !Number.isInteger(httpsPort) ||
  !Number.isInteger(controlPort) ||
  !certificatePath ||
  !keyPath
) {
  throw new Error("The E2E HTTPS storage stub requires ports and a TLS pair.");
}

const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
const objects = new Map<string, { bytes: Buffer; contentType: string }>();
const uploads: Array<{ id: string; size: number; sha256: string }> = [];
const reads: Array<{
  id: string;
  size: number;
  sha256: string;
  userAgent?: string;
}> = [];

async function readBody(request: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    length += bytes.byteLength;
    if (length > MAX_UPLOAD_BYTES) {
      throw new Error("E2E storage upload exceeds the stub limit.");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, length);
}

const storageServer = createHttpsServer(
  {
    cert: readFileSync(certificatePath),
    key: readFileSync(keyPath),
  },
  async (request, response) => {
    const url = new URL(request.url ?? "/", "https://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/uploads") {
      try {
        const bytes = await readBody(request);
        const id = randomUUID();
        const contentType =
          typeof request.headers["content-type"] === "string"
            ? request.headers["content-type"].split(";", 1)[0]!.trim()
            : "application/octet-stream";
        objects.set(id, { bytes, contentType });
        uploads.push({
          id,
          size: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({ id }));
      } catch {
        response.writeHead(413).end("upload rejected");
      }
      return;
    }

    const objectId = url.pathname.match(/^\/objects\/([a-f0-9-]{36})$/)?.[1];
    if (request.method === "GET" && objectId) {
      const object = objects.get(objectId);
      if (!object) {
        response.writeHead(404).end("missing object");
        return;
      }
      reads.push({
        id: objectId,
        size: object.bytes.byteLength,
        sha256: createHash("sha256").update(object.bytes).digest("hex"),
        ...(typeof request.headers["user-agent"] === "string"
          ? { userAgent: request.headers["user-agent"] }
          : {}),
      });
      response.writeHead(200, {
        "content-type": object.contentType,
        "content-length": String(object.bytes.byteLength),
        "cache-control": "no-store",
      });
      response.end(object.bytes);
      return;
    }

    response.writeHead(404).end("not found");
  },
);

const controlServer = createHttpServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/health") {
    response.writeHead(200).end("ok");
    return;
  }
  if (request.method === "GET" && url.pathname === "/__state") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ uploads, reads }));
    return;
  }
  response.writeHead(404).end("not found");
});

storageServer.listen(httpsPort, "127.0.0.1");
controlServer.listen(controlPort, "127.0.0.1");
