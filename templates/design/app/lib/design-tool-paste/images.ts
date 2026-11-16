import type { FigmaPasteLayer } from "@shared/figma-paste-plan";

import { escapeHtml } from "./emit";

const MAX_CONCURRENT_UPLOADS = 6;

// How the emitter writes a linked image inside an HTML-escaped style attribute.
const LINKED_IMAGE = /url\(&quot;(.+?)&quot;\)/g;

export interface HostedImages {
  layers: FigmaPasteLayer[];
  /** Images that stay linked to their source because they could not be hosted. */
  kept: number;
  /** Why the first of them could not be hosted, for the user. */
  reason: string | null;
}

/**
 * Re-hosts remote images through `mirror` so a pasted design does not depend
 * on another app keeping them online. `mirror` returns the hosted URL or
 * throws; an image it fails on keeps its link and is counted, never dropped.
 */
export async function hostRemoteImages(
  layers: FigmaPasteLayer[],
  urls: readonly string[],
  mirror: (url: string) => Promise<string>,
): Promise<HostedImages> {
  const hosted = new Map<string, string>();
  let reason: string | null = null;
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        hosted.set(url, await mirror(url));
      } catch (error) {
        reason ??=
          error instanceof Error ? error.message : "it could not be hosted";
      }
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_CONCURRENT_UPLOADS, urls.length) },
      worker,
    ),
  );
  if (hosted.size === 0) return { layers, kept: urls.length, reason };
  const escaped = new Map(
    Array.from(hosted, ([from, to]) => [escapeHtml(from), escapeHtml(to)]),
  );
  return {
    layers: layers.map((layer) => ({
      ...layer,
      // One pass over the document, however many images were hosted.
      content: layer.content.replace(LINKED_IMAGE, (link, url: string) => {
        const hostedUrl = escaped.get(url);
        return hostedUrl ? `url(&quot;${hostedUrl}&quot;)` : link;
      }),
    })),
    kept: urls.length - hosted.size,
    reason,
  };
}
