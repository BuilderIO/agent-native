/**
 * Avatar hooks for fetching and uploading user avatars.
 *
 * Avatars are stored as compressed base64 JPEG data URLs (64×64, ~2-4 KB)
 * in the settings table under the key `avatar:<email>`.
 *
 * Avatars are semi-public — any client can read any user's avatar by email.
 */

import { useState, useEffect } from "react";

// Module-level cache so multiple components sharing the same email don't race
const _cache = new Map<string, string | null>();
const _inFlight = new Map<string, Promise<string | null>>();

async function fetchAvatar(email: string): Promise<string | null> {
  if (_cache.has(email)) return _cache.get(email)!;
  if (_inFlight.has(email)) return _inFlight.get(email)!;

  const p = fetch(`/_agent-native/avatar/${encodeURIComponent(email)}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      const url = d?.image ?? null;
      _cache.set(email, url);
      _inFlight.delete(email);
      return url as string | null;
    })
    .catch(() => {
      _cache.set(email, null);
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
    return () => {
      cancelled = true;
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

/**
 * Returns a function that compresses and uploads an avatar image for the
 * currently authenticated user.
 */
export function useUploadAvatar(): (
  file: File,
  email: string,
) => Promise<void> {
  return async (file: File, email: string) => {
    const image = await compressAvatar(file);
    await fetch("/_agent-native/avatar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image }),
    });
    // Invalidate cache so next useAvatarUrl call re-fetches
    invalidateAvatarCache(email);
    // Force re-read by setting cache to new value immediately
    _cache.set(email, image);
  };
}
