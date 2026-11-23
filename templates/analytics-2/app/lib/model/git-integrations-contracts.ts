import { z } from "zod";

export const GIT_PROVIDERS = [
  "github",
  "github-enterprise",
  "gitlab",
  "gitlab-self-hosted",
  "bitbucket",
] as const;

export type GitProvider = (typeof GIT_PROVIDERS)[number];

export const GIT_PROVIDER_LABELS: Readonly<Record<GitProvider, string>> = {
  github: "GitHub",
  "github-enterprise": "GitHub Enterprise Server",
  gitlab: "GitLab",
  "gitlab-self-hosted": "GitLab self-hosted",
  bitbucket: "Bitbucket",
};

export const GIT_INTEGRATIONS_SECTION_IDS = {
  packageImport: "settings-integrations-git-package-import",
  projectExport: "settings-integrations-git-project-export",
  repoSync: "settings-integrations-git-repo-syncing",
} as const;

export const MAX_GIT_INTEGRATION_ENTRIES = 50;

const REPOSITORY_SLUG_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+$/;
const BRANCH_NAME_PATTERN = /^[A-Za-z0-9._/@-]+$/;
const SAFE_RELATIVE_PATH_PATTERN = /^[A-Za-z0-9._/-]*$/;

export function isValidRepositorySlug(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200) return false;
  if (trimmed.includes("..") || trimmed.includes("://")) return false;
  return REPOSITORY_SLUG_PATTERN.test(trimmed);
}

export function isValidBranchName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return false;
  if (
    trimmed.includes("..") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/")
  ) {
    return false;
  }
  return BRANCH_NAME_PATTERN.test(trimmed);
}

export function isValidSubdirPath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.length > 200) return false;
  if (
    trimmed.startsWith("/") ||
    trimmed.includes("..") ||
    trimmed.includes("\\")
  ) {
    return false;
  }
  return SAFE_RELATIVE_PATH_PATTERN.test(trimmed);
}

const providerSchema = z.enum(GIT_PROVIDERS);

const idSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);

const repositorySchema = z
  .string()
  .trim()
  .refine(isValidRepositorySlug, "Use owner/repository format.");

const branchSchema = z
  .string()
  .trim()
  .refine(isValidBranchName, "Enter a valid branch name.");

const subdirSchema = z
  .string()
  .trim()
  .refine(isValidSubdirPath, "Enter a valid relative directory path.");

const createdAtSchema = z.string().trim().min(1).max(64);

export const gitPackageImportEntrySchema = z
  .object({
    id: idSchema,
    provider: providerSchema,
    repository: repositorySchema,
    branch: branchSchema,
    subdir: subdirSchema,
    createdAt: createdAtSchema,
  })
  .strict();

export const gitProjectExportEntrySchema = z
  .object({
    id: idSchema,
    provider: providerSchema,
    repository: repositorySchema,
    branch: branchSchema,
    directory: subdirSchema,
    exportOnPublish: z.boolean(),
    createdAt: createdAtSchema,
  })
  .strict();

export const gitRepoSyncEntrySchema = z
  .object({
    id: idSchema,
    provider: providerSchema,
    repository: repositorySchema,
    branch: branchSchema,
    enabled: z.boolean(),
    createdAt: createdAtSchema,
  })
  .strict();

function hasNoDuplicateTargets<
  T extends { provider: GitProvider; repository: string; branch: string },
>(items: readonly T[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.provider}:${item.repository.toLowerCase()}:${item.branch}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

export const gitIntegrationsSettingsSchema = z
  .object({
    packageImports: z
      .array(gitPackageImportEntrySchema)
      .max(MAX_GIT_INTEGRATION_ENTRIES)
      .refine(
        hasNoDuplicateTargets,
        "Duplicate package import repository entry.",
      ),
    projectExports: z
      .array(gitProjectExportEntrySchema)
      .max(MAX_GIT_INTEGRATION_ENTRIES)
      .refine(
        hasNoDuplicateTargets,
        "Duplicate project export repository entry.",
      ),
    repoSyncs: z
      .array(gitRepoSyncEntrySchema)
      .max(MAX_GIT_INTEGRATION_ENTRIES)
      .refine(hasNoDuplicateTargets, "Duplicate sync repository entry."),
  })
  .strict();

export type GitPackageImportEntry = z.infer<typeof gitPackageImportEntrySchema>;
export type GitProjectExportEntry = z.infer<typeof gitProjectExportEntrySchema>;
export type GitRepoSyncEntry = z.infer<typeof gitRepoSyncEntrySchema>;
export type GitIntegrationsSettings = z.infer<
  typeof gitIntegrationsSettingsSchema
>;

export const EMPTY_GIT_INTEGRATIONS: GitIntegrationsSettings = {
  packageImports: [],
  projectExports: [],
  repoSyncs: [],
};
