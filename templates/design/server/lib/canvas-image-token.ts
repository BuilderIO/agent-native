import crypto from "node:crypto";

import { defineAppConfigSection } from "@agent-native/core/server";
import { resolveDeployEnvironment } from "@agent-native/core/server/deploy-environment";
import { z } from "zod";

const TOKEN_DOMAIN = "canvas-image:v1|";
const SUBJECT_DOMAIN = "canvas-image:subject|";
const SUBJECT_BYTES = 16;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_REMAINING_MS = 60 * 60 * 1000;
export const CANVAS_IMAGE_TOKEN_MAX_HORIZON_SECONDS = 48 * 60 * 60;

export const designCanvasImageConfigSchema = z.object({
  secret: z
    .string()
    .min(32)
    .optional()
    .meta({
      env: ["DESIGN_CANVAS_IMAGE_SECRET"],
      doc: "Secret that signs the short-lived tokens the canvas image resize proxy accepts. At least 32 characters. Unset outside local development, the proxy is off and canvas images load from their original URLs.",
    }),
});

export const designCanvasImageConfig = defineAppConfigSection(
  "designCanvasImage",
  designCanvasImageConfigSchema,
);

declare module "@agent-native/core/server" {
  interface AppConfigSections {
    designCanvasImage: typeof designCanvasImageConfigSchema;
  }
}

export interface CanvasImageToken {
  subject: string;
  exp: number;
  token: string;
}

let devKey: string | undefined;
let warnedUnavailable = false;

function resolveSecret(): string | null {
  const configured = designCanvasImageConfig.read().secret;
  if (configured) return configured;
  if (resolveDeployEnvironment() === "local") {
    devKey ??= crypto.randomBytes(32).toString("hex");
    return devKey;
  }
  if (!warnedUnavailable) {
    warnedUnavailable = true;
    console.warn(
      "[canvas-image] DESIGN_CANVAS_IMAGE_SECRET is not set; the image resize proxy is disabled",
    );
  }
  return null;
}

function hmac(secret: string, message: string): Buffer {
  return crypto.createHmac("sha256", secret).update(message).digest();
}

function tokenFor(secret: string, subject: string, exp: number): string {
  return hmac(secret, `${TOKEN_DOMAIN}${subject}|${exp}`).toString("base64url");
}

export function canvasImageTokenExpiry(nowMs: number): number {
  const midnight = (Math.floor(nowMs / DAY_MS) + 1) * DAY_MS;
  return (
    (midnight - nowMs < MIN_REMAINING_MS ? midnight + DAY_MS : midnight) / 1000
  );
}

export function mintCanvasImageToken(
  email: string,
  nowMs: number,
): CanvasImageToken | null {
  const secret = resolveSecret();
  if (secret === null) return null;
  const subject = hmac(secret, `${SUBJECT_DOMAIN}${email}`)
    .subarray(0, SUBJECT_BYTES)
    .toString("base64url");
  const exp = canvasImageTokenExpiry(nowMs);
  return { subject, exp, token: tokenFor(secret, subject, exp) };
}

export function verifyCanvasImageToken(
  params: Record<string, unknown>,
  nowMs: number,
): boolean {
  const { u, exp, t } = params;
  if (
    typeof u !== "string" ||
    typeof exp !== "string" ||
    typeof t !== "string"
  ) {
    return false;
  }
  if (!/^\d{1,12}$/.test(exp)) return false;
  const expiry = Number(exp);
  const now = Math.floor(nowMs / 1000);
  if (now >= expiry || expiry - now > CANVAS_IMAGE_TOKEN_MAX_HORIZON_SECONDS) {
    return false;
  }
  const secret = resolveSecret();
  if (secret === null) return false;
  const expected = Buffer.from(tokenFor(secret, u, expiry));
  const actual = Buffer.from(t);
  return (
    expected.length === actual.length &&
    crypto.timingSafeEqual(expected, actual)
  );
}
