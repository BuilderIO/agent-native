import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { z } from "zod";

export class FixtureControlError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 | 502 = 502,
  ) {
    super(message);
  }
}

export function localAppUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Expected an explicit loopback app URL");
  return url;
}

export function startControlServer<T extends z.ZodType>(
  port: number,
  path: string,
  schema: T,
  control: (input: z.output<T>) => Promise<object>,
  readFixture?: (req: IncomingMessage, res: ServerResponse) => boolean,
) {
  return new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (readFixture?.(req, res)) return;
      function send(status: number, value: object) {
        res.writeHead(status, {
          "content-type": "application/json",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(value));
      }
      if (req.method !== "POST" || req.url !== path) {
        send(404, { errorCode: "fixture_route_not_found" });
        return;
      }
      if (
        req.headers.origin ||
        req.headers.host !== `127.0.0.1:${port}` ||
        req.headers["content-type"] !== "application/json"
      ) {
        send(403, { errorCode: "fixture_client_denied" });
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      try {
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 16_384) {
            send(413, { errorCode: "fixture_request_too_large" });
            return;
          }
          chunks.push(chunk);
        }
        let input: z.output<T>;
        try {
          input = schema.parse(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (error) {
          if (error instanceof z.ZodError || error instanceof SyntaxError) {
            send(400, { errorCode: "fixture_invalid_request" });
            return;
          }
          throw error;
        }
        send(200, await control(input));
      } catch (error) {
        if (error instanceof FixtureControlError) {
          send(error.status, {
            errorCode: "fixture_operation_failed",
            error: error.message,
          });
        } else {
          console.error(
            "Phase 1 fixture control failed",
            error instanceof Error ? error.name : "unknown",
          );
          send(500, { errorCode: "fixture_operation_failed" });
        }
      }
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
