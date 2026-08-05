import { FigmaContextConnector } from "./figma.js";
import { GoogleSlidesContextConnector } from "./google-slides.js";
import { ManualContextConnector } from "./manual.js";
import { NotionContextConnector } from "./notion.js";
import { ContextImportConnectorRegistry } from "./registry.js";
import { UploadContextConnector } from "./upload.js";
import { WebsiteContextConnector } from "./website.js";

const DEFAULT_CONNECTORS = [
  new ManualContextConnector(),
  new UploadContextConnector(),
  new GoogleSlidesContextConnector(),
  new FigmaContextConnector(),
  new NotionContextConnector(),
  new WebsiteContextConnector(),
] as const;

const defaultCreativeContextConnectorRegistry =
  new ContextImportConnectorRegistry();

export function registerDefaultCreativeContextConnectors(
  registry = defaultCreativeContextConnectorRegistry,
): ContextImportConnectorRegistry {
  for (const connector of DEFAULT_CONNECTORS) {
    if (!registry.has(connector.kind)) registry.register(connector);
  }
  return registry;
}

export function getCreativeContextConnectorRegistry(): ContextImportConnectorRegistry {
  return registerDefaultCreativeContextConnectors();
}

export function createDefaultContextImportConnectorRegistry(): ContextImportConnectorRegistry {
  return registerDefaultCreativeContextConnectors(
    new ContextImportConnectorRegistry(),
  );
}

export {
  createDefaultContextConnectorExecutionContext,
  createWorkspaceConnectionResolver,
  type CreateContextConnectorExecutionContextOptions,
} from "./context.js";
export { FigmaContextConnector, figmaRecommendedFileKeys } from "./figma.js";
export {
  fetchFigmaNativeContextItems,
  MAX_INLINE_NATIVE_CODE_BYTES,
  nativeFidelityReportFromEntries,
} from "./figma-native.js";
export {
  GOOGLE_SLIDES_CONTEXT_OAUTH_SCOPES,
  GoogleSlidesContextConnector,
  googleSlidesRecommendedPresentationIds,
} from "./google-slides.js";
export {
  compileGoogleSlidesPresentation,
  type CompiledGoogleSlide,
  type CompiledGoogleSlideChild,
  type GoogleSlidesNativeCompileOptions,
  type SlidesNativeAssetRequest,
  type SlidesNativeBounds,
  type SlidesNativeFallbackRequest,
} from "./google-slides-native.js";
export { ManualContextConnector } from "./manual.js";
export {
  NotionContextConnector,
  notionRecommendedRootPageIds,
} from "./notion.js";
export {
  parseUploadedDocument,
  type ParseDocumentInput,
  type ParsedDocument,
} from "./document-parser.js";
export { ContextImportConnectorRegistry } from "./registry.js";
export {
  LayeredRenderedPageProvider,
  type LayeredRenderedPageProviderOptions,
  type RenderedPageMethod,
  type RenderedPageProvider,
  type RenderedPageRequest,
  type RenderedPageResult,
} from "./rendered-page.js";
export {
  recommendContextRoots,
  type ContextRootRecommendation,
  type ContextRootRecommendationProvider,
} from "./recommendations.js";
export { smartDefaultExternalIds } from "./smart-defaults.js";
export { UploadContextConnector } from "./upload.js";
export { WebsiteContextConnector } from "./website.js";
export type {
  ContextConnectorExecutionContext,
  ContextConnectorFetchRequest,
  ContextConnectorFetchResult,
  ContextConnectorInventoryItem,
  ContextConnectorInventoryPage,
  ContextConnectorInventoryRequest,
  ContextConnectorKind,
  ContextImportConnector,
  ContextImportConnectorSummary,
  ContextUploadContent,
} from "./types.js";
