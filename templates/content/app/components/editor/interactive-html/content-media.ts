import { appApiPath } from "@agent-native/core/client/api-path";
import {
  privateMediaIdsInContent,
  privateMediaPath,
  replacePrivateMediaLinks,
} from "@shared/private-media";
import { useEffect, useState } from "react";

const MAX_IMAGES = 40;

const images = new Map<string, Promise<string | null>>();

async function readAsDataUrl(id: string): Promise<string> {
  const response = await fetch(`${appApiPath(privateMediaPath(id))}?bytes=1`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(blob);
  });
}

function imageDataUrl(id: string): Promise<string | null> {
  const known = images.get(id);
  if (known) return known;
  const read = readAsDataUrl(id).catch((error: unknown) => {
    images.delete(id);
    console.warn(`[content] an interactive block's image didn't load`, error);
    return null;
  });
  images.set(id, read);
  return read;
}

export function useContentMediaWrittenIn(source: string): string | null {
  const [written, setWritten] = useState<{
    source: string;
    html: string;
  } | null>(null);
  const needsImages = privateMediaIdsInContent(source).size > 0;
  useEffect(() => {
    if (!needsImages) return;
    let cancelled = false;
    const ids = [...privateMediaIdsInContent(source)].slice(0, MAX_IMAGES);
    void Promise.all(
      ids.map(async (id) => [id, await imageDataUrl(id)] as const),
    ).then((loaded) => {
      if (cancelled) return;
      const urls = new Map(loaded);
      setWritten({
        source,
        html: replacePrivateMediaLinks(
          source,
          (id, link) => urls.get(id) ?? link,
        ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [source, needsImages]);
  if (!needsImages) return source;
  return written?.source === source ? written.html : null;
}
