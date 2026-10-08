import { fail } from "../action.js";
import {
  composerSourceListSchema,
  composerSourceReferenceSchema,
  type ComposerSourceRequest,
  type ComposerSourceResult,
} from "../shared/composer-source.js";
import { resolveA2ACallerAuth } from "./caller-auth.js";
import { invokeAgentAction } from "./invoke.js";

export async function readPeerComposerSource(
  request: ComposerSourceRequest,
  selfAppId: "design" | "slides",
): Promise<ComposerSourceResult> {
  const target = request.source === "slides" ? "slides" : "design";
  if (target === selfAppId) {
    fail("Read this reference in its owning app.", {
      errorCode: "composer_source_local",
    });
  }
  const auth = await resolveA2ACallerAuth();
  if (!auth.userEmail) {
    fail("Sign in to attach a reference.", {
      statusCode: 401,
      errorCode: "unauthorized",
    });
  }
  let response;
  try {
    response = await invokeAgentAction({
      target,
      selfAppId,
      action: "read-composer-source",
      input: request,
      userEmail: auth.userEmail,
      orgDomain: auth.orgDomain,
      orgSecret: auth.orgSecret,
      requestTimeoutMs: 15000,
    });
  } catch {
    fail(
      "Could not reach the reference app. Check its connection and try again.",
      {
        statusCode: 502,
        errorCode: "composer_peer_unavailable",
      },
    );
  }
  if (response.result.status !== "completed") {
    fail(
      "The reference app could not read this source. Check your access and its connection.",
      {
        statusCode: 409,
        errorCode: "composer_reference_unavailable",
        ...(request.source === "figma" ? { details: { source: "figma" } } : {}),
      },
    );
  }
  let output: unknown;
  try {
    output = JSON.parse(response.result.output);
  } catch {
    fail("The reference app returned an incomplete response. Try again.", {
      statusCode: 502,
      errorCode: "composer_peer_invalid_response",
    });
  }
  const schema =
    request.operation === "list"
      ? composerSourceListSchema
      : composerSourceReferenceSchema;
  const parsed = schema.safeParse(output);
  if (
    !parsed.success ||
    (request.operation === "read" &&
      request.id &&
      "id" in parsed.data &&
      parsed.data.id !== request.id)
  ) {
    fail("The reference app returned an invalid source. Try again.", {
      statusCode: 502,
      errorCode: "composer_peer_invalid_response",
    });
  }
  return parsed.data;
}
