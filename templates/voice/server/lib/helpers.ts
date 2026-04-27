import { getRequestUserEmail } from "@agent-native/core/server/request-context";

export function getCurrentOwnerEmail(): string {
  return getRequestUserEmail() || "local@localhost";
}

export function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}
