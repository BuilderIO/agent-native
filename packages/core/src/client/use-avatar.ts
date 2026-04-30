/**
 * Avatar hooks for fetching and uploading user avatars.
 *
 * Avatars are stored as compressed base64 JPEG data URLs (64×64, ~2-4 KB)
 * in the settings table under the key `avatar:<email>`.
 *
 * Avatars are semi-public — any client can read any user's avatar by email.
 */

import { useState, useEffect } from "react";
import { agentNativePath } from "./api-path.js";

// Module-level cache so multiple components sharing the same email don't race
const _cache = new Map<string, string | null>();
const _inFlight = new Map<string, Promise<string | null>>();
// Listeners notified when an upload succeeds so mounted hooks re-render
const _listeners = new Map<string, Set<(url: string | null) => void>>();

function notifyListeners(email: string, url: string | null): void {
  _listeners.get(email)?.forEach((fn) => fn(url));
}

async function fetchAvatar(email: string): Promise<string | null> {
  if (_cache.has(email)) return _cache.get(email)!;
  if (_inFlight.has(email)) return _inFlight.get(email)!;

  const p = fetch(
    agentNativePath(`/_agent-native/avatar/${encodeURIComponent(email)}`),
  )
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const url = d?.image ?? null;
      // Only write to cache if not superseded by a more recent upload
      if (!_cache.has(email)) {
        _cache.set(email, url);
      }
      _inFlight.delete(email);
      // Return the cached value in case an upload superseded this fetch
      return (_cache.get(email) ?? null) as string | null;
    })
    .catch(() => {
      if (!_cache.has(email)) {
        _cache.set(email, null);
      }
      _inFlight.delete(email);
      return null;
    });

  _inFlight.set(email, p);
  return p;
}

/** Invalidate avatar cache for an email (call after upload). */
export function invalidateAvatarCache(email: string): void {
  _cache.delete(email);
  _inFlight.delete(email);
}

/** Returns the avatar data URL for a given email, or null if none is set. */
export function useAvatarUrl(email: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(
    email ? (_cache.get(email) ?? null) : null,
  );

  useEffect(() => {
    if (!email) return;
    let cancelled = false;
    fetchAvatar(email).then((u) => {
      if (!cancelled) setUrl(u);
    });
    // Subscribe to upload notifications so the avatar updates without remount
    if (!_listeners.has(email)) _listeners.set(email, new Set());
    const listener = (u: string | null) => setUrl(u);
    _listeners.get(email)!.add(listener);
    return () => {
      cancelled = true;
      const set = _listeners.get(email);
      if (set) {
        set.delete(listener);
        if (set.size === 0) _listeners.delete(email);
      }
    };
  }, [email]);

  return url;
}

/** Compress a File to a 64×64 JPEG data URL (~2-4 KB) using Canvas API. */
async function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d")!;
      // Center-crop to square
      const size = Math.min(img.width, img.height);
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      ctx.drawImage(img, sx, sy, size, size, 0, 0, 64, 64);
      resolve(canvas.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = reject;
    img.src = objectUrl;
  });
}

/** Compress and upload an avatar image for the given user. */
export async function uploadAvatar(file: File, email: string): Promise<void> {
  const image = await compressAvatar(file);
  const res = await fetch(agentNativePath("/_agent-native/avatar"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
  if (!res.ok) {
    throw new Error(`Avatar upload failed: ${res.status}`);
  }
  // Update cache and notify all mounted useAvatarUrl hooks for this email
  _cache.set(email, image);
  _inFlight.delete(email);
  notifyListeners(email, image);
}
