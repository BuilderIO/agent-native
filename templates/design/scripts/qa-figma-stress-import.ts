import {
  resolveBuilderPrivateKey,
  resolveSecret,
  runWithRequestContext,
} from "@agent-native/core/server";

import createDesign from "../actions/create-design.js";
import importFigmaFrame from "../actions/import-figma-frame.js";
import { getDb } from "../server/db/index.js";
import {
  isLocalFigmaQaUploadEnabled,
  registerLocalFigmaQaUploadProvider,
} from "../server/lib/local-figma-qa-upload.js";

const STRESS_FRAME_URL =
  "https://www.figma.com/design/qi8LfxivK6QzV5ujdLLqR6/Untitled?node-id=4-3";

function requiredEnvironment(name: "AGENT_USER_EMAIL") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required. Select an authenticated local QA account and organization without printing credential values.`,
    );
  }
  return value;
}

const userEmail = requiredEnvironment("AGENT_USER_EMAIL");
const orgId = process.env.AGENT_ORG_ID?.trim() || undefined;
const existingDesignId = process.env.FIGMA_STRESS_DESIGN_ID?.trim();

const evidence = await runWithRequestContext({ userEmail, orgId }, async () => {
  getDb();
  // Resolve only inside the authenticated request scope. These values are
  const [figmaCredential, builderCredential] = await Promise.all([
    resolveSecret("FIGMA_ACCESS_TOKEN"),
    resolveBuilderPrivateKey(),
  ]);
  if (!figmaCredential) {
    throw new Error(
      "This QA account has no request-scoped Figma credential. Connect Figma in Design and retry.",
    );
  }
  const localQaStorageEnabled = isLocalFigmaQaUploadEnabled();
  if (!builderCredential && !localQaStorageEnabled) {
    throw new Error(
      "This QA account has no request-scoped durable upload provider. Connect Builder (free tier available) in Design and retry.",
    );
  }
  if (localQaStorageEnabled) registerLocalFigmaQaUploadProvider();

  const designId =
    existingDesignId ??
    (
      await createDesign.run({
        id: undefined,
        title: "Figma Parity Stress Import QA",
        description:
          "Real Figma REST import verification for the AN Parity Stress frame.",
        projectType: "prototype",
        designSystemId: undefined,
      })
    ).id;
  const imported = await importFigmaFrame.run({
    figmaUrl: STRESS_FRAME_URL,
    fileKey: undefined,
    nodeId: undefined,
    designId,
    asNewScreen: true,
  });

  return {
    designId: imported.designId,
    fileCount: imported.files.length,
    placedFrameCount: imported.placedFrames.length,
    figma: imported.figma,
    fidelity: {
      exactCount: imported.fidelityReport.exactCount,
      approximatedCount: imported.fidelityReport.approximated.length,
      imageFallbackCount: imported.fidelityReport.imageFallbacks.length,
    },
    durableAssetsVerified: imported.fidelityReport.imageFallbacks.length > 0,
    warningCount: imported.warnings.length,
  };
});

console.log(JSON.stringify(evidence, null, 2));
