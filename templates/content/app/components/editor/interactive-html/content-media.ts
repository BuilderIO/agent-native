import { appApiPath } from "@agent-native/core/client/api-path";
import { MAX_INTERACTIVE_HTML_IMAGES } from "@shared/interactive-html";
import {
  privateMediaIdsInContent,
  privateMediaPath,
  replacePrivateMediaLinks,
} from "@shared/private-media";
import { useEffect, useState } from "react";

const MAX_INLINED_IMAGES_LENGTH = 40_000_000;
const IMAGES_AT_ONCE = 4;

type LoadedImages = Map<string, Promise<string | null>>;

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

function imageDataUrl(
  images: LoadedImages,
  id: string,
): Promise<string | null> {
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

export async function imageDataUrls(
  images: LoadedImages,
  ids: readonly string[],
  stopped: () => boolean,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  let room = MAX_INLINED_IMAGES_LENGTH;
  for (let at = 0; at < ids.length && !stopped(); at += IMAGES_AT_ONCE) {
    const loaded = await Promise.all(
      ids
        .slice(at, at + IMAGES_AT_ONCE)
        .map(async (id) => [id, await imageDataUrl(images, id)] as const),
    );
    for (const [id, url] of loaded) {
      if (!url) continue;
      room -= url.length;
      if (room < 0) {
        console.warn(
          "[content] an interactive block's images are too large to show together",
        );
        return urls;
      }
      urls.set(id, url);
    }
  }
  return urls;
}

export function useContentMediaWrittenIn(source: string): string | null {
  const [written, setWritten] = useState<{
    source: string;
    html: string;
  } | null>(null);
  const [images] = useState((): LoadedImages => new Map());
  const needsImages = privateMediaIdsInContent(source).size > 0;
  useEffect(() => {
    if (!needsImages) return;
    let cancelled = false;
    const ids = [...privateMediaIdsInContent(source)].slice(
      0,
      MAX_INTERACTIVE_HTML_IMAGES,
    );
    void imageDataUrls(images, ids, () => cancelled).then((urls) => {
      if (cancelled) return;
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
  }, [source, needsImages, images]);
  if (!needsImages) return source;
  return written?.source === source ? written.html : null;
}
