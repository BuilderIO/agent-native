import { lazy, type ComponentType } from "react";

import type { DocsLocale } from "./docs-locale";

type DocBlocksContentComponent = ComponentType<{
  markdown: string;
  locale?: DocsLocale;
}>;
type DocBlocksContentModule = {
  default: DocBlocksContentComponent;
};

let preloadedDocBlocksContent: DocBlocksContentComponent | null = null;
let docBlocksContentPromise: Promise<DocBlocksContentModule> | null = null;

const loadDocBlocksContent = () => {
  if (!docBlocksContentPromise) {
    docBlocksContentPromise = import("./DocBlocksContent").then((module) => {
      preloadedDocBlocksContent = module.default;
      return module;
    });
  }
  return docBlocksContentPromise;
};

export const DocBlocksContent = lazy(loadDocBlocksContent);

export function preloadDocBlocksContent() {
  return loadDocBlocksContent();
}

export function getPreloadedDocBlocksContent() {
  return preloadedDocBlocksContent;
}
