
import type { EmailCta, EmailLinkBlock } from "../server/email-template.js";
import type { UserProfile } from "../user-profile/shared.js";

export interface ShareEmailExtras {
  paragraphs?: string[];
  secondaryCta?: EmailCta;
  linkBlock?: EmailLinkBlock;
  closingParagraphs?: string[];
}

export interface ShareableResourceRegistration {
  type: string;
  resourceTable: any;
  sharesTable: any;
  displayName: string;
  titleColumn?: string;
  getResourcePath?: (resource: any) => string | undefined;
  getLogoUrl?: (
    resource: any,
  ) => string | undefined | Promise<string | undefined>;
  getBrandName?: (
    resource: any,
  ) => string | undefined | Promise<string | undefined>;
  getSender?: (
    resource: any,
    ctx: { sender: UserProfile },
  ) =>
    | { fromName?: string; replyTo?: string }
    | undefined
    | Promise<{ fromName?: string; replyTo?: string } | undefined>;
  getHeroHtml?: (
    resource: any,
    ctx: { href: string; alt?: string },
  ) => string | undefined | Promise<string | undefined>;
  getShareEmailExtras?: (
    resource: any,
    ctx: { href: string; sender: UserProfile; recipientEmail: string },
  ) => ShareEmailExtras | undefined | Promise<ShareEmailExtras | undefined>;
  getDb: () => any;
  /**
   * Optional resource-owned persistence hook for visibility changes. Use this
   * when changing visibility must share a transaction with another invariant,
   * such as reserving a human-readable name before the row becomes visible.
   * The generic action falls back to a direct update when this is omitted.
   */
  persistVisibilityChange?: (args: {
    resource: any;
    resourceId: string;
    visibility: "private" | "org" | "public";
    update: Record<string, unknown>;
    userEmail?: string;
    orgId?: string;
  }) => void | Promise<void>;
  allowPublic?: boolean;
  publicAccessRole?:
    | "viewer"
    | "commenter"
    | "editor"
    | "admin"
    | ((
        resource: any,
        ctx: {
          userEmail?: string;
          orgId?: string;
          authCapability?: string;
        },
      ) =>
        | "viewer"
        | "commenter"
        | "editor"
        | "admin"
        | Promise<"viewer" | "commenter" | "editor" | "admin">);
  requireOrgMemberForUserShares?: boolean;
  supportsGroupShares?: boolean;
  canManageAccess?: (
    resource: any,
    ctx: {
      userEmail?: string;
      orgId?: string;
    },
  ) => boolean | Promise<boolean>;
  resolveAccessContext?: (ctx: {
    userEmail?: string;
    orgId?: string;
    authCapability?: string;
  }) => {
    userEmail?: string;
    orgId?: string;
    authCapability?: string;
  };
  ownerAccessIgnoresOrg?: boolean;
  agentReadable?:
    | false
    | {
        resourceKind: string;
        getContextPath: (resource: any) => string | undefined;
        getPagePath?: (resource: any) => string | undefined;
        ttlSeconds?: number;
      };
}

const REGISTRY_KEY = "__agentNativeShareableResources__";
type RegistryStore = Map<string, ShareableResourceRegistration>;
const globalRegistry: { [K in typeof REGISTRY_KEY]?: RegistryStore } =
  globalThis as any;

function isTestRuntime(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.VITEST === "true" ||
    process.env.VITEST === "1"
  );
}

function registrationCameFromTestFile(): boolean {
  const stack = new Error().stack ?? "";
  return /[./\\](?:[^/\\]+[.-])(?:test|spec)\.[cm]?[jt]sx?(?::\d+)?(?::\d+)?/.test(
    stack,
  );
}

function getRegistry(): RegistryStore {
  let r = globalRegistry[REGISTRY_KEY];
  if (!r) {
    r = new Map<string, ShareableResourceRegistration>();
    globalRegistry[REGISTRY_KEY] = r;
  }
  return r;
}

export function registerShareableResource(
  entry: ShareableResourceRegistration,
): void {
  if (!isTestRuntime() && registrationCameFromTestFile()) return;
  getRegistry().set(entry.type, entry);
}

export function getShareableResource(
  type: string,
): ShareableResourceRegistration | undefined {
  return getRegistry().get(type);
}

export function requireShareableResource(
  type: string,
): ShareableResourceRegistration {
  const reg = getRegistry();
  const entry = reg.get(type);
  if (!entry) {
    throw new Error(
      `Unknown shareable resource type: "${type}". Did you forget registerShareableResource()?`,
    );
  }
  return entry;
}

export function listShareableResources(): ShareableResourceRegistration[] {
  return Array.from(getRegistry().values());
}
