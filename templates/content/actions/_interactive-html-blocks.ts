import {
  declaredLinkOrigin,
  getAppProductionUrl,
  getRequestContext,
  withConfiguredAppBasePath,
} from "@agent-native/core/server";

import type { getDb } from "../server/db/index.js";
import { interactiveHtmlDisplaySources } from "../server/lib/interactive-html-blocks.js";
import { identityBlockIds } from "../shared/block-identity-ids.js";
import { contentBlockLinkPath } from "../shared/block-link.js";
import { visitBlocksFieldBlocks } from "../shared/blocks-field-identity.js";
import {
  interactiveHtmlAsLinks,
  keepInteractiveHtml,
  type InteractiveHtmlUrl,
} from "../shared/interactive-html-fallback.js";
import {
  interactiveHtmlFromNode,
  mayHoldInteractiveHtml,
} from "../shared/interactive-html.js";
import { nfmToDoc } from "../shared/nfm.js";
import type { PublicInteractiveHtml } from "../shared/public-reader.js";
import { readBlocksFieldIdentity } from "./_blocks-field-identity.js";
import { bodyBlocksPropertyIds } from "./_body-block-fields.js";

export interface InteractiveHtmlBlockLink {
  blockId: string | null;
  title: string | null;
  url: string;
}

async function bodyBlockIdsByPath(
  documentId: string,
  content: string,
  db?: ReturnType<typeof getDb>,
): Promise<Record<string, string>> {
  const [propertyId] = await bodyBlocksPropertyIds(documentId, db);
  if (!propertyId) return {};
  const { blocks } = await readBlocksFieldIdentity({
    ...(db ? { db } : {}),
    documentId,
    propertyId,
    markdown: content,
  });
  return identityBlockIds(blocks).idsByPath;
}

async function interactiveBlocks(documentId: string, content: string | null) {
  if (!mayHoldInteractiveHtml(content)) return [];
  const blocks: { path: string; title: string | null }[] = [];
  visitBlocksFieldBlocks(nfmToDoc(content), (node, { path }) => {
    const block = interactiveHtmlFromNode(node);
    if (block) blocks.push({ path, title: block.title });
  });
  if (blocks.length === 0) return [];
  const ids = await bodyBlockIdsByPath(documentId, content);
  return blocks.map((block) => ({
    ...block,
    blockId: ids[block.path] ?? null,
  }));
}

function idsByPath(
  blocks: Awaited<ReturnType<typeof interactiveBlocks>>,
): Record<string, string> {
  return Object.fromEntries(
    blocks.flatMap(({ path, blockId }) => (blockId ? [[path, blockId]] : [])),
  );
}

export async function publicInteractiveHtml(
  documentId: string,
  content: string | null,
): Promise<PublicInteractiveHtml | null> {
  const blocks = await interactiveBlocks(documentId, content);
  return blocks.length > 0
    ? {
        blockIds: idsByPath(blocks),
        displaySources: interactiveHtmlDisplaySources(),
      }
    : null;
}

export async function interactiveHtmlBlockLinks(
  documentId: string,
  content: string | null,
  requestOrigin?: string,
): Promise<InteractiveHtmlBlockLink[]> {
  const blocks = await interactiveBlocks(documentId, content);
  return blocks.map(({ blockId, title }) => ({
    blockId,
    title,
    url: interactiveHtmlUrl(documentId, blockId, readerOrigin(requestOrigin)),
  }));
}

function readerOrigin(
  requestOrigin = getRequestContext()?.requestOrigin,
): string {
  return declaredLinkOrigin(requestOrigin) ?? getAppProductionUrl();
}

export function interactiveHtmlUrl(
  documentId: string,
  blockId: string | null = null,
  origin: string = readerOrigin(),
): string {
  const base = withConfiguredAppBasePath(origin);
  return `${base}${contentBlockLinkPath(documentId, blockId, { fullScreen: true })}`;
}

export function interactiveHtmlPageUrl(documentId: string): string {
  return `${withConfiguredAppBasePath(readerOrigin())}${contentBlockLinkPath(documentId, null)}`;
}

export async function interactiveHtmlUrls(
  documentId: string,
  content: string | null,
  origin: string = getAppProductionUrl(),
): Promise<InteractiveHtmlUrl> {
  const blockIds = idsByPath(await interactiveBlocks(documentId, content));
  return ({ path }) =>
    interactiveHtmlUrl(documentId, blockIds[path] ?? null, origin);
}

export async function withInteractiveHtmlLinks(
  documentId: string,
  content: string,
): Promise<string> {
  return interactiveHtmlAsLinks(
    content,
    await interactiveHtmlUrls(documentId, content, readerOrigin()),
  );
}

export async function withPublishedInteractiveHtmlLinks(
  documentId: string,
  content: string,
): Promise<string> {
  return interactiveHtmlAsLinks(
    content,
    await interactiveHtmlUrls(documentId, content),
  );
}

export async function keepInteractiveHtmlBlocks(args: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  local: string;
  incoming: string;
}): Promise<string> {
  const { db, documentId, local, incoming } = args;
  if (!mayHoldInteractiveHtml(local)) return incoming;
  const blockIds = await bodyBlockIdsByPath(documentId, local, db);
  return keepInteractiveHtml({ local, incoming, documentId, blockIds });
}
