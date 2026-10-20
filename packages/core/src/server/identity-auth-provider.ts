import { createHmac, timingSafeEqual } from "node:crypto";

import { deleteCookie, getCookie, getHeader, setCookie } from "h3";
import type { H3Event } from "h3";

import { getAuthSecret } from "./better-auth-instance.js";

const IDENTITY_GOOGLE_AUTH_COOKIE = "an_identity_google_auth";
const IDENTITY_GOOGLE_AUTH_TTL_SECONDS = 10 * 60;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

function cookieIsSecure(event: H3Event): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    getHeader(event, "x-forwarded-proto") === "https"
  );
}

function normalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function signature(payload: string): string {
  return createHmac("sha256", getAuthSecret())
    .update(payload)
    .digest("base64url");
}

export function setIdentityGoogleAuthCookie(
  event: H3Event,
  email: string,
): void {
  const normalized = normalizeEmail(email);
  if (!normalized) return;
  const expiresAt =
    Math.floor(Date.now() / 1_000) + IDENTITY_GOOGLE_AUTH_TTL_SECONDS;
  const payload = `google.${expiresAt}.${Buffer.from(normalized).toString("base64url")}`;
  const signed = signature(payload);
  setCookie(event, IDENTITY_GOOGLE_AUTH_COOKIE, `${payload}.${signed}`, {
    httpOnly: true,
    maxAge: IDENTITY_GOOGLE_AUTH_TTL_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: cookieIsSecure(event),
  });
}

export function clearIdentityGoogleAuthCookie(event: H3Event): void {
  deleteCookie(event, IDENTITY_GOOGLE_AUTH_COOKIE, { path: "/" });
}

export function hasIdentityGoogleAuthCookie(
  event: H3Event,
  email: string,
): boolean {
  const normalized = normalizeEmail(email);
  const raw = getCookie(event, IDENTITY_GOOGLE_AUTH_COOKIE);
  if (!normalized || !raw) return false;

  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "google") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now() / 1_000) {
    return false;
  }
  if (!/^[A-Za-z0-9_-]+$/.test(parts[2])) return false;
  const cookieEmail = Buffer.from(parts[2], "base64url").toString("utf8");
  if (cookieEmail !== normalized) return false;

  const expected = signature(parts.slice(0, 3).join("."));
  const actualBytes = Buffer.from(parts[3]);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
