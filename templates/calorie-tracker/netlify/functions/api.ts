import serverless from "serverless-http";
import { createServer } from "../../server";
import type { Handler, HandlerEvent, HandlerContext } from "@netlify/functions";

const app = createServer();

const serverlessHandler = serverless(app, {
  request: (request: any, event: HandlerEvent) => {
    // Handle base64 encoded body
    let body = event.body;
    if (body && event.isBase64Encoded) {
      body = Buffer.from(body, "base64").toString("utf-8");
    }

    // Parse JSON body and attach to request
    if (body && typeof body === "string") {
      const contentType =
        event.headers?.["content-type"] ||
        event.headers?.["Content-Type"] ||
        "";
      if (contentType.includes("application/json")) {
        try {
          request.body = JSON.parse(body);
        } catch {
          request.body = body;
        }
      } else {
        request.body = body;
      }
    }
  },
});

export const handler: Handler = async (
  event: HandlerEvent,
  context: HandlerContext,
) => {
  return serverlessHandler(event, context);
};
