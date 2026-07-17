import type { ActionEntry } from "@agent-native/core/server";

import confirmCanonicalLogo from "./confirm-canonical-logo.js";
import continueContextImport from "./continue-context-import.js";
import creativeContextA2A from "./creative-context-a2a.js";
import getBrandProfile from "./get-brand-profile.js";
import getContextImportStatus from "./get-context-import-status.js";
import getContextItem from "./get-context-item.js";
import getContextPack from "./get-context-pack.js";
import getGooglePickerSession from "./get-google-picker-session.js";
import inferBrandDna from "./infer-brand-dna.js";
import listCanonicalLogoCandidates from "./list-canonical-logo-candidates.js";
import listContextConnections from "./list-context-connections.js";
import listContextPacks from "./list-context-packs.js";
import listContextSources from "./list-context-sources.js";
import listContextSuggestions from "./list-context-suggestions.js";
import manageBrandProfile from "./manage-brand-profile.js";
import manageContextPack from "./manage-context-pack.js";
import manageContextSource from "./manage-context-source.js";
import manageLayoutTemplate from "./manage-layout-template.js";
import previewContextImport from "./preview-context-import.js";
import processContextPurge from "./process-context-purge.js";
import proposeBrandDna from "./propose-brand-dna.js";
import proposeCanonicalLogo from "./propose-canonical-logo.js";
import publishBrandDna from "./publish-brand-dna.js";
import recommendContextRoots from "./recommend-context-roots.js";
import recordContextFeedback from "./record-context-feedback.js";
import reviewContextItems from "./review-context-items.js";
import runEmbeddingBakeoff from "./run-embedding-bakeoff.js";
import searchCreativeContext from "./search-creative-context.js";
import setBrandDna from "./set-brand-dna.js";
import startContextEnrichment from "./start-context-enrichment.js";
import startContextImport from "./start-context-import.js";

export const creativeContextActions: Record<string, ActionEntry> = {
  "confirm-canonical-logo": confirmCanonicalLogo,
  "continue-context-import": continueContextImport,
  "creative-context-a2a": creativeContextA2A,
  "get-brand-profile": getBrandProfile,
  "get-context-import-status": getContextImportStatus,
  "get-context-item": getContextItem,
  "get-context-pack": getContextPack,
  "get-google-picker-session": getGooglePickerSession,
  "infer-brand-dna": inferBrandDna,
  "list-canonical-logo-candidates": listCanonicalLogoCandidates,
  "list-context-packs": listContextPacks,
  "list-context-connections": listContextConnections,
  "list-context-sources": listContextSources,
  "list-context-suggestions": listContextSuggestions,
  "manage-context-pack": manageContextPack,
  "manage-brand-profile": manageBrandProfile,
  "manage-context-source": manageContextSource,
  "manage-layout-template": manageLayoutTemplate,
  "preview-context-import": previewContextImport,
  "process-context-purge": processContextPurge,
  "propose-brand-dna": proposeBrandDna,
  "propose-canonical-logo": proposeCanonicalLogo,
  "publish-brand-dna": publishBrandDna,
  "record-context-feedback": recordContextFeedback,
  "recommend-context-roots": recommendContextRoots,
  "review-context-items": reviewContextItems,
  "run-embedding-bakeoff": runEmbeddingBakeoff,
  "search-creative-context": searchCreativeContext,
  "set-brand-dna": setBrandDna,
  "start-context-import": startContextImport,
  "start-context-enrichment": startContextEnrichment,
};
