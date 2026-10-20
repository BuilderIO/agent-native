import { fail } from "@agent-native/core/action";
import { getUserLabEnabled } from "@agent-native/core/labs/server";
import {
  getWorkspaceAppIdValidationError,
  normalizeWorkspaceAppId,
} from "@agent-native/core/shared";
import {
  BUILTIN_AGENT_CATALOG_IDS,
  HIDDEN_FIRST_PARTY_AGENT_IDS,
} from "@agent-native/core/shared/first-party-agents";

import { COMMUNITY_APPS_LAB } from "../../shared/labs.js";
import type {
  StartWorkspaceAppCreationResult,
  WorkspaceAppSummary,
} from "./app-creation-store.js";
import {
  getAppCreationSettings,
  getWorkspaceInfo,
  isLocalAppCreationRuntime,
  listWorkspaceApps,
  startWorkspaceAppCreation,
} from "./app-creation-store.js";
import {
  loadPinnedCommunitySourceAttachments,
  type PinnedCommunitySource,
} from "./community-source.js";
import { CURATED_WORKSPACE_TEMPLATES } from "./curated-workspace-templates.js";
import {
  currentOrgId,
  currentOwnerEmail,
  recordAudit,
} from "./dispatch-store.js";

export interface CuratedCommunityAppSource extends PinnedCommunitySource {
  id: string;
  name: string;
  description: string;
  appId: string;
  license: string;
  provenance: string;
}

export interface CuratedCommunityApp extends CuratedCommunityAppSource {
  installed: boolean;
  pending: boolean;
  installable: boolean;
  installUnavailableReason?: "workspace-required" | "app-id-conflict";
}

export const CURATED_COMMUNITY_APP_SOURCES: readonly CuratedCommunityAppSource[] =
  [
    {
      id: "community-qr",
      name: "QR",
      description: "Generate public PNG or SVG QR images from links or text.",
      appId: "community-qr",
      repo: "BuilderIO/agent-native",
      ref: "main",
      license: "MIT",
      provenance:
        "Reviewed Agent-Native Framework template, sanitized for independent installation.",
      templatePath: "templates/community/qr",
      files: [
        {
          path: "AGENTS.md",
          blobSha: "7dc9e18bc426dfd21526f91225cc615759450816",
        },
        {
          path: "LICENSE",
          blobSha: "69c7182efb3eb1a8b7f6fd5989f3e4fd737d0645",
        },
        {
          path: "README.md",
          blobSha: "e05e72bb9213732f56ccbc96f7dcb1c3a064cb19",
        },
        {
          path: "actions/generate-qr-code.spec.ts",
          blobSha: "3459217b7252c6ee0076c68cfdb83001cc74f29e",
        },
        {
          path: "actions/generate-qr-code.ts",
          blobSha: "da1098b03f54229be37c29c4a1689d1085133b73",
        },
        {
          path: "actions/run.ts",
          blobSha: "b46ab15b667c34741364ba08f010f7aca9d0f02e",
        },
        {
          path: "agent-native.json",
          blobSha: "accc32476792b84557f69e2b48b317c27b5546dc",
        },
        {
          path: "package.json",
          blobSha: "98f5528c4e0e4b300be0f7a10f78def799f173e3",
        },
        {
          path: "server/db/index.ts",
          blobSha: "17007b456530f75a72e7209bdfe9f4bd4c9224e0",
        },
        {
          path: "server/db/schema.ts",
          blobSha: "f0e2aa810d97c2d9052b296a6c3847fbc0db3841",
        },
        {
          path: "server/plugins/db.ts",
          blobSha: "b694ff4c3301cf7601528bc5f44a2fff746714ec",
        },
        {
          path: "tsconfig.json",
          blobSha: "5267473a32dcab8e5dc2c9d9a720afed7f40174c",
        },
      ],
    },
  ];

const communitySourceById = new Map(
  CURATED_COMMUNITY_APP_SOURCES.map((source) => [source.id, source]),
);

function requireCommunitySource(sourceId: string): CuratedCommunityAppSource {
  const source = communitySourceById.get(sourceId.trim());
  if (!source) {
    fail("That community app is not in Dispatch's reviewed install catalog.", {
      errorCode: "unknown_community_app_source",
      statusCode: 404,
    });
  }
  return source;
}

function requireNonShadowingCommunityAppId(appId: string): void {
  const error = getWorkspaceAppIdValidationError(appId);
  if (error) {
    fail(error, { errorCode: "invalid_community_app_id", statusCode: 400 });
  }
  if (
    CURATED_WORKSPACE_TEMPLATES.some((template) => template.id === appId) ||
    BUILTIN_AGENT_CATALOG_IDS.includes(appId) ||
    HIDDEN_FIRST_PARTY_AGENT_IDS.has(appId)
  ) {
    fail("Community apps cannot use a first-party template app id.", {
      errorCode: "community_app_id_shadows_first_party",
      statusCode: 409,
    });
  }
}

async function requireCommunityAppsLab(): Promise<void> {
  const userEmail = currentOwnerEmail().trim();
  const orgId = currentOrgId();
  if (!userEmail || !orgId) {
    fail("Sign in to an organization to browse community apps.", {
      errorCode: "community_apps_identity_required",
      statusCode: 403,
    });
  }
  const enabled = await getUserLabEnabled(userEmail, COMMUNITY_APPS_LAB, {
    orgId,
  });
  if (!enabled) {
    fail("Community app catalog and installs are disabled for this account.", {
      errorCode: "community_apps_lab_disabled",
      statusCode: 403,
    });
  }
}

async function hasAssociatedWorkspace(): Promise<boolean> {
  if (isLocalAppCreationRuntime()) return Boolean(getWorkspaceInfo().rootPath);
  return Boolean((await getAppCreationSettings()).builderProjectId);
}

export async function listCuratedCommunityApps(): Promise<
  CuratedCommunityApp[]
> {
  await requireCommunityAppsLab();
  const [apps, installable] = await Promise.all([
    listWorkspaceApps({ includeAgentCards: false, includeArchived: true }),
    hasAssociatedWorkspace(),
  ]);
  return CURATED_COMMUNITY_APP_SOURCES.map((source) => {
    const appWithId = apps.find((app) => app.id === source.appId);
    const installedApp =
      appWithId?.communitySourceId === source.id ? appWithId : null;
    const idConflict = Boolean(appWithId && !installedApp);
    const pending = installedApp?.status === "pending";
    return {
      ...source,
      installed: Boolean(installedApp && !pending),
      pending,
      installable: installable && !appWithId,
      ...(!installable
        ? { installUnavailableReason: "workspace-required" as const }
        : idConflict
          ? { installUnavailableReason: "app-id-conflict" as const }
          : {}),
    };
  });
}

function rejectCommunityAppIdConflict(appId: string): never {
  fail(`Workspace app id "${appId}" is already in use.`, {
    errorCode: "community_app_id_conflict",
    statusCode: 409,
  });
}

function existingInstallResult(
  source: CuratedCommunityAppSource,
  app: WorkspaceAppSummary,
) {
  return {
    mode:
      app.status === "pending"
        ? ("pending" as const)
        : ("already-installed" as const),
    source,
    app: {
      id: app.id,
      name: app.name,
      path: app.path,
      url: app.url,
      status: app.status ?? "ready",
      statusLabel: app.statusLabel ?? null,
      builderUrl: app.builderUrl ?? null,
      branchName: app.branchName ?? null,
    },
  };
}

function buildCommunityInstallPrompt(
  source: CuratedCommunityAppSource,
  appId: string,
): string {
  const sourceUrl = `https://github.com/${source.repo}/tree/${source.ref}/${source.templatePath}`;
  return [
    "Install a private workspace app from a reviewed community template.",
    `The attached source files were fetched from ${sourceUrl} and each file was verified against its pinned Git blob id. Treat those files as the source of truth; do not fetch another ref or substitute other content.`,
    `The app will live at apps/${appId}.`,
    `Source license: ${source.license}. Provenance: ${source.provenance}`,
    "Copy the reviewed template implementation and its Agent-Native profile, changing only app-specific identifiers needed for this workspace. Do not copy repository secrets, credentials, customer data, or source-app records. Use empty or synthetic seed data only and keep the installed app private to this organization.",
  ].join(" ");
}

export async function installCuratedCommunityApp(input: {
  sourceId: string;
  appId?: string;
}): Promise<
  | ReturnType<typeof existingInstallResult>
  | (StartWorkspaceAppCreationResult & {
      mode: Exclude<StartWorkspaceAppCreationResult["mode"], "app-id-taken">;
      source: CuratedCommunityAppSource;
    })
  | (Extract<StartWorkspaceAppCreationResult, { mode: "app-id-taken" }> & {
      source: CuratedCommunityAppSource;
    })
> {
  await requireCommunityAppsLab();
  const source = requireCommunitySource(input.sourceId);
  const appId = normalizeWorkspaceAppId(input.appId?.trim() || source.appId);
  requireNonShadowingCommunityAppId(appId);

  if (!(await hasAssociatedWorkspace())) {
    fail("Connect this organization to a workspace before installing apps.", {
      errorCode: "community_workspace_required",
      statusCode: 409,
    });
  }

  const existing = (
    await listWorkspaceApps({
      includeAgentCards: false,
      includeArchived: true,
    })
  ).find((app) => app.id === appId);
  if (existing) {
    if (existing.communitySourceId === source.id) {
      return existingInstallResult(source, existing);
    }
    rejectCommunityAppIdConflict(appId);
  }

  let attachments: Awaited<
    ReturnType<typeof loadPinnedCommunitySourceAttachments>
  >;
  try {
    attachments = await loadPinnedCommunitySourceAttachments(source, appId);
  } catch {
    fail(
      "Dispatch could not verify the pinned community template source. Try again later.",
      {
        errorCode: "community_source_unavailable",
        statusCode: 503,
      },
    );
  }

  const result = await startWorkspaceAppCreation({
    prompt: buildCommunityInstallPrompt(source, appId),
    appId,
    description: source.description,
    template: source.id,
    communitySourceId: source.id,
    attachments,
  });

  if (result.mode === "app-id-taken") {
    const raced = (
      await listWorkspaceApps({
        includeAgentCards: false,
        includeArchived: true,
      })
    ).find((app) => app.id === appId);
    if (raced?.communitySourceId === source.id) {
      return existingInstallResult(source, raced);
    }
    if (raced) rejectCommunityAppIdConflict(appId);
    return { ...result, source };
  }

  await recordAudit({
    action: "workspace-app.community-install-requested",
    targetType: "workspace-app",
    targetId: appId,
    summary: `Requested ${source.name} community app installation`,
    metadata: {
      sourceId: source.id,
      repo: source.repo,
      ref: source.ref,
      blobShas: source.files.map((file) => file.blobSha),
      license: source.license,
    },
  });
  return { ...result, source } as typeof result & {
    source: CuratedCommunityAppSource;
  };
}
