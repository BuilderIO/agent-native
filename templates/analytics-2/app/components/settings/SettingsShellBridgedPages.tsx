import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  OrgAuthenticationPage,
  OrgGeneralPage,
} from "@agent-native/toolkit/app/org";
import {
  CORE_SETTINGS_PAGES,
  createSettingsBridge,
  SettingsShellProvider,
  SkillsSettingsPage as ToolkitSkillsSettingsPage,
  type SettingsPageContext,
  type SettingsPageHeader,
  type SettingsShellContextValue,
} from "@agent-native/toolkit/app/settings/shell";
import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { queueThreadSubmission } from "@/components/agent/search-submission";
import { useWorkspaceData } from "@/components/workspace/WorkspaceDataContext";
import { AppSettingsSections } from "@/skins/app-settings-sections";

import { AnalyticsNotificationsPage } from "./AnalyticsNotificationsPage";
import { AnalyticsUsersPage } from "./AnalyticsUsersPage";
import { OrganizationArchiveSettings } from "./OrganizationArchiveSettings";
import { routeSkillRequestToWriteResource } from "./skill-request-message";
import { useAnalyticsAssetLabelsSettingsSections } from "./useAnalyticsAssetLabelsSettingsSections";

/**
 * The shared org pages read the settings shell's context (route, navigate, header)
 * because their home is the toolkit's settings shell. This app has its own rail, so
 * these pages are mounted directly and would otherwise throw
 * "useSettingsShell must be used inside the Settings shell" — which is exactly what
 * testers saw as "Something went wrong" on Settings > Users (sprint-analytics-2#153).
 *
 * The bridge supplies the three things the context carries, from this app's own
 * router. The page titles stay this app's own, but a page still owns its header
 * ACTION - the member surface puts "Invite members" there, and a setHeader that
 * swallowed it left Settings > Users promising "Invite someone to get a link" with
 * no control to do it. So the action a page sets is rendered above it.
 */
function SettingsShellContextBridge({
  page,
  children,
  showHeaderAction = true,
}: {
  page: string;
  children: ReactNode;
  showHeaderAction?: boolean;
}) {
  const navigate = useNavigate();
  const [header, setHeader] = useState<SettingsPageHeader | null>(null);
  const updateHeader = useCallback(
    (next: SettingsPageHeader | null) => setHeader(next),
    [],
  );
  const value = useMemo<SettingsShellContextValue>(
    () => ({
      route: { page, sub: null },
      navigate: (next: string, sub?: string | null) => {
        const href =
          sub === undefined || sub === null
            ? `/settings/${next}`
            : `/settings/${next}/${sub}`;
        void navigate(href);
      },
      setHeader: updateHeader,
    }),
    [navigate, page, updateHeader],
  );
  return (
    <SettingsShellProvider value={value}>
      {showHeaderAction && header?.action != null ? (
        <div className="analytics-settings-page-action" data-settings-action="">
          {header.action}
        </div>
      ) : null}
      {children}
    </SettingsShellProvider>
  );
}

/** Settings > Users: the app's own page (invite links) plus the shared member surface. */
export function UsersSettingsPage() {
  const workspace = useWorkspaceData();
  const isAdmin = workspace?.shell.features.isAdmin === true;
  return (
    <SettingsShellContextBridge page="members" showHeaderAction={isAdmin}>
      <AnalyticsUsersPage isAdmin={isAdmin} />
    </SettingsShellContextBridge>
  );
}

/** Settings > Directory sync and Settings > SSO: SSO, SCIM, allowed email domain. */
export function AuthenticationSettingsPage() {
  return (
    <SettingsShellContextBridge page="auth">
      <OrgAuthenticationPage />
    </SettingsShellContextBridge>
  );
}

/**
 * Settings > Skills: the shared skills surface (personal and organization groups, add
 * menu, row menu). It is the page the reference lists in its settings catalogue, so the
 * app mounts it rather than growing its own.
 */
export function SkillsSettingsPage() {
  const workspace = useWorkspaceData();
  const navigate = useNavigate();
  const t = useT();
  const onDescribe = async (request: AgentChatMessage) => {
    const { message, context } = routeSkillRequestToWriteResource(request);
    if (!workspace?.shell.features.canCreateThread)
      throw new Error(t("agentChat.composer.submitFailed"));
    const thread = await callAction("create-thread", {});
    const submission = queueThreadSubmission(
      thread.id,
      workspace.shell.workspace.id,
      { message, ...(context !== undefined ? { context } : {}) },
    );
    void navigate(thread.href);
    const result = await submission;
    if (!result.delivered) toast.error(t("agentChat.composer.submitFailed"));
  };
  return (
    <SettingsShellContextBridge page="skills">
      <ToolkitSkillsSettingsPage onDescribe={onDescribe} trashRemovedSkills />
    </SettingsShellContextBridge>
  );
}

const ORGANIZATION_CATALOG_SECTION_IDS: Partial<Record<string, string>> = {
  "settings.asset-statuses.statuses": "settings-organization-statuses",
  "settings.asset-categories.categories": "settings-organization-categories",
};

/** Settings > Organization: workspace identity and its general settings. */
function OrganizationCatalog() {
  const sections = useAnalyticsAssetLabelsSettingsSections("organization");
  return (
    <>
      {sections.flatMap((section) =>
        section.rows.map((row) => (
          <section
            key={row.id}
            id={ORGANIZATION_CATALOG_SECTION_IDS[row.id]}
            aria-label={row.label}
          >
            <h2 className="ws-labels-title">{row.label}</h2>
            <AppSettingsSections
              sections={[{ ...section, rows: [{ ...row, labelHidden: true }] }]}
              hints={{ frame: "catalog" }}
            />
          </section>
        )),
      )}
    </>
  );
}

export function OrganizationSettingsPage() {
  return (
    <SettingsShellContextBridge page="org">
      <OrgGeneralPage />
      <OrganizationArchiveSettings />
      <OrganizationCatalog />
    </SettingsShellContextBridge>
  );
}

const ToolkitApiKeysPage = CORE_SETTINGS_PAGES.find(
  (entry) => entry.id === "api-keys",
)?.component;

const EMPTY_SETTINGS_BRIDGE = createSettingsBridge({});

export function NotificationsSettingsPage() {
  const t = useT();
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {t("analytics.settings.notifications.description")}
      </p>
      <AnalyticsNotificationsPage />
    </div>
  );
}

export function ApiKeysSettingsPage() {
  const t = useT();
  const workspace = useWorkspaceData();
  const isAdmin = workspace?.shell.features.isAdmin === true;
  const context = useMemo<SettingsPageContext>(
    () => ({
      role: isAdmin ? "admin" : "member",
      isOwner: false,
      isAdmin,
      hasOrganization: true,
      soloDeploymentAdmin: false,
      appId: "analytics-2",
      labs: {},
      flags: {},
    }),
    [isAdmin],
  );
  if (!ToolkitApiKeysPage) return null;
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        {t("analytics.settings.apiKeys.description")}
      </p>
      <SettingsShellContextBridge page="api-keys">
        <Suspense fallback={null}>
          <ToolkitApiKeysPage
            pageId="api-keys"
            sub={null}
            context={context}
            bridge={EMPTY_SETTINGS_BRIDGE}
          />
        </Suspense>
      </SettingsShellContextBridge>
    </div>
  );
}
