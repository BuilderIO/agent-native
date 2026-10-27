import { configureTracking } from "@agent-native/core/client/analytics";
import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import {
  createAgentNativeQueryClient,
  useDbSync,
  getBrowserTabId,
  useSession,
} from "@agent-native/core/client/hooks";
import {
  getEmbedAuthToken,
  isEmbedAuthActive,
  setAgentNativeApiDisabled,
} from "@agent-native/core/client/host";
import {
  getLocaleInitScript,
  useT,
  type LocaleCode,
} from "@agent-native/core/client/i18n";
import { getThemeInitScript } from "@agent-native/core/client/ui";
import {
  createHomeSuggestionOrder,
  createHomeSuggestionRandom,
  HomeSuggestionSeedProvider,
  pickHomeSuggestions,
  readHomeSuggestionRole,
  useHomeSuggestionSeedForHome,
} from "@agent-native/toolkit/app-shell";
import { PromptComposer } from "@agent-native/toolkit/app/chat/composer/index";
import { AppProviders } from "@agent-native/toolkit/app/providers";
import {
  AppShellSkeleton,
  type AppShellFirstPaintHome,
} from "@agent-native/toolkit/app/shared";
import { useCommandMenuShortcut } from "@agent-native/toolkit/app/shared";
import { CommandMenu } from "@agent-native/toolkit/app/shared";
import {
  IconArrowRight,
  IconArrowsMaximize,
  IconComponents,
  IconHome,
  IconHierarchy2,
  IconHistory,
  IconSun,
  IconMoon,
  IconTemplate,
} from "@tabler/icons-react";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useState } from "react";
import {
  Links,
  Meta,
  Outlet,
  Link,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router";
import type { LinksFunction } from "react-router";

import {
  DesignHomeLibrary,
  type DesignHomeLibraryTab,
} from "@/components/home/DesignHomeLibrary";
import { DesignRecentSkeleton } from "@/components/home/DesignRecentSkeleton";
import { Layout as AppLayout } from "@/components/layout/Layout";
import { DesignTemplateGrid } from "@/components/templates/DesignTemplateGrid";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { AppToolkitProvider } from "@/components/ui/toolkit-provider";
import {
  DESIGN_HOME_SUGGESTION_POOLS,
  trackDesignHomeSuggestionClick,
} from "@/home-suggestions";
import { DESIGN_CHAT_STORAGE_KEY } from "@/lib/agent-chat";
import { isBuilderHostEmbed } from "@/lib/builder-host-origin";
import { useDesignVariantPickTracking } from "@/lib/design-funnel-tracking";
import { shouldInvalidateDesignQueryForSync } from "@/lib/design-sync-invalidation";
import {
  requestDesignHistoryOpen,
  requestDesignUiToggle,
} from "@/lib/design-ui-events";

import changelog from "../CHANGELOG.md?raw";
import { getDesignGenerationPageviewProvenanceFromProperties } from "../shared/generation-provenance.js";
import {
  DESIGN_HOME_LIBRARY_TAB_HANDOFF_INIT_SCRIPT,
  readDesignHomeLibraryInitialState,
  setDesignHomeLibraryTab,
} from "./home-library-state";
import { i18nCatalog } from "./i18n";
import designEnglish from "./i18n/en-US";
import { OpenVisualEditWebMcp } from "./OpenVisualEditWebMcp";
import { isPublicDesignAppPath } from "./public-routes";

import stylesheet from "./global.css?url";

const loadFirstPaintSuggestionMessages = (locale: string) =>
  i18nCatalog.loadMessages(locale as LocaleCode);

if (isBuilderHostEmbed()) setAgentNativeApiDisabled("builder shell canvas");

configureTracking({
  llmConnectionStatus:
    typeof window === "undefined" ||
    !isPublicDesignAppPath(window.location.pathname),
  getDefaultProps: (name, properties) => {
    const provenance =
      name === "pageview"
        ? getDesignGenerationPageviewProvenanceFromProperties(
            properties,
            appBasePath(),
          )
        : null;
    return {
      ...(provenance?.kind === "design-output" ? provenance.properties : {}),
      ...properties,
      app: "design",
      app_name: "design",
      template_name: "design",
    };
  },
});

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
];

const THEME_INIT_SCRIPT = getThemeInitScript();
const LOCALE_INIT_SCRIPT = getLocaleInitScript();
const DESIGN_WEBMCP_EXCLUDED_ACTIONS = ["open-visual-edit"] as const;
function designFirstPaintSuggestions(
  seed: number,
  order: readonly number[],
  role: string,
) {
  return pickHomeSuggestions(
    DESIGN_HOME_SUGGESTION_POOLS,
    role,
    createHomeSuggestionRandom(seed),
    order,
  ).map(({ id, label, prompt: messageKey }) => {
    if (!messageKey)
      throw new Error(`Missing Design home suggestion prompt key: ${label}`);
    const [, , roleKey, labelKey] = label.split(".");
    const [, , , promptKey] = messageKey.split(".");
    const roleLabels = designEnglish.home.suggestionLabels as Record<
      string,
      Record<string, string>
    >;
    const rolePrompts = designEnglish.home.suggestions as Record<
      string,
      Record<string, string>
    >;
    const shortLabel =
      roleKey && labelKey ? roleLabels[roleKey]?.[labelKey] : undefined;
    const prompt =
      roleKey && promptKey ? rolePrompts[roleKey]?.[promptKey] : undefined;
    if (!shortLabel || !prompt)
      throw new Error(`Missing Design home suggestion copy: ${label}`);
    return {
      id,
      label: shortLabel,
      prompt,
      labelMessageKey: label,
      messageKey,
    };
  });
}

function DesignFirstPaintLibrary() {
  const location = useLocation();
  const [value, setValue] = useState<DesignHomeLibraryTab>(
    () =>
      readDesignHomeLibraryInitialState(
        new URLSearchParams(location.search).get("gettingStarted") ===
          "save-template",
      ).tab,
  );
  return (
    <DesignHomeLibrary
      value={value}
      onValueChange={(nextValue) => {
        setValue(nextValue);
        setDesignHomeLibraryTab(nextValue);
      }}
      labels={{
        templates: designEnglish.navigation.templates,
        recent: designEnglish.home.recent,
      }}
      browseAll={
        <Button
          variant="ghost"
          size="sm"
          className="min-w-[111px] justify-center"
          asChild
        >
          <Link to="/templates">
            {designEnglish.home.browseAllTemplates}
            <IconArrowRight />
          </Link>
        </Button>
      }
      templates={
        <DesignTemplateGrid
          templates={[]}
          loading
          pendingId={null}
          pendingLabel={designEnglish.templatesPage.opening}
          disabled={false}
          loadingLabel={designEnglish.templatesPage.loading}
          emptyLabel={designEnglish.promptDialog.noTemplatesFound}
          onSelect={() => {}}
        />
      }
      recent={<DesignRecentSkeleton />}
    />
  );
}

const designFirstPaintHome: Omit<AppShellFirstPaintHome, "suggestions"> = {
  appId: "design",
  appName: designEnglish.navigation.brand,
  pageTitle: designEnglish.home.pageTitle,
  headerHeight: 56,
  promptTitle: designEnglish.home.designPromptTitle,
  promptPlaceholder: designEnglish.home.describeBuild,
  suggestedPromptsLabel: designEnglish.home.suggestedPrompts,
  sidebarItems: [
    {
      label: designEnglish.navigation.home,
      to: "/home",
      icon: IconHome,
    },
    {
      label: designEnglish.navigation.templates,
      to: "/templates",
      icon: IconTemplate,
    },
    {
      label: designEnglish.navigation.designSystems,
      to: "/design-systems",
      icon: IconComponents,
    },
  ],
  templatesLabel: designEnglish.navigation.templates,
  recentLabel: designEnglish.home.recent,
  browseAllLabel: designEnglish.home.browseAllTemplates,
  library: <DesignFirstPaintLibrary />,
  skipPromptLabel: designEnglish.promptDialog.skipPrompt,
  suggestionRole: "general",
  renderComposer: (props) => (
    <div data-design-inline-prompt data-agentkit-composer-size="large">
      <PromptComposer
        {...props}
        autoFocus
        attachmentsEnabled
        className="design-home-prompt-composer-area"
        layoutVariant="hero"
        modelStatusChecksEnabled
        requireAgentEngine
        showMissingApiKeySetup={false}
        showModelSelector
        voiceChatEnabled={false}
        voiceEnabled
      />
    </div>
  ),
};

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-design-app suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
        />
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
        <script
          data-agent-native-locale-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: LOCALE_INIT_SCRIPT }}
        />
        <script
          data-design-home-library-tab-init
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: DESIGN_HOME_LIBRARY_TAB_HANDOFF_INIT_SCRIPT,
          }}
        />
        <meta name="theme-color" content="#71717A" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Design" />
        <link rel="icon" type="image/svg+xml" href={appPath("/favicon.svg")} />
        <link rel="apple-touch-icon" href={appPath("/icon-180.svg")} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function isPrivateDesignEditorPath(pathname: string): boolean {
  return pathname.startsWith("/design/");
}

export function DbSyncSetup() {
  const qc = useQueryClient();
  const location = useLocation();
  useDbSync({
    queryClient: qc,
    queryKeys: ["designs", "design-systems", "design-files"],
    ignoreSource: getBrowserTabId(),
    actionInvalidatePredicate: shouldInvalidateDesignQueryForSync,
    realtime: isPrivateDesignEditorPath(location.pathname)
      ? { reason: "collaborators can edit this design while it is open" }
      : undefined,
  });
  return null;
}

function ThemeToggleItem() {
  const { resolvedTheme, setTheme } = useTheme();
  const t = useT();
  const isDark = resolvedTheme === "dark";
  return (
    <CommandMenu.Item
      onSelect={() => setTheme(isDark ? "light" : "dark")}
      keywords={["theme", "dark", "light", "mode"]}
    >
      {isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
      {t("root.toggleTheme")}
    </CommandMenu.Item>
  );
}

function DesignCommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const isDesignEditor = location.pathname.startsWith("/design/");
  return (
    <CommandMenu
      open={open}
      onOpenChange={onOpenChange}
      changelog={changelog}
      changelogKey="design"
      chatStorageKey={DESIGN_CHAT_STORAGE_KEY}
    >
      <CommandMenu.Group heading={t("root.commandActions")}>
        {isDesignEditor ||
        location.pathname.startsWith("/templates") ||
        location.pathname.startsWith("/design-systems") ? (
          <CommandMenu.Item onSelect={() => navigate("/home")}>
            {t("navigation.home")}
          </CommandMenu.Item>
        ) : null}
        {location.pathname === "/home" ? (
          <CommandMenu.Item onSelect={() => navigate("/templates")}>
            {t("navigation.templates")}
          </CommandMenu.Item>
        ) : null}
        <CommandMenu.Item onSelect={() => navigate("/settings/agent")}>
          <IconHierarchy2 size={16} />
          {t("root.openAgent")}
        </CommandMenu.Item>
        {isDesignEditor ? (
          <CommandMenu.Item
            onSelect={requestDesignHistoryOpen}
            keywords={["history", "versions", "restore", "checkpoints"]}
          >
            <IconHistory size={16} />
            {"Version history" /* i18n-ignore */}
          </CommandMenu.Item>
        ) : null}
      </CommandMenu.Group>
      <CommandMenu.Group heading={t("root.commandAppearance")}>
        {isDesignEditor ? (
          <CommandMenu.Item
            onSelect={requestDesignUiToggle}
            keywords={["canvas", "focus", "panels", "hide ui", "show ui"]}
          >
            <IconArrowsMaximize size={16} />
            {t("designEditor.keyboardShortcuts.commands.toggleUi")}
          </CommandMenu.Item>
        ) : null}
        <ThemeToggleItem />
      </CommandMenu.Group>
    </CommandMenu>
  );
}

function DesignToaster() {
  return (
    <Toaster
      richColors
      position="bottom-right"
      offset={{ bottom: 44, right: 32 }}
      mobileOffset={{ bottom: 44, right: 16 }}
    />
  );
}

function PrivateRootContent() {
  const location = useLocation();
  const { session } = useSession();
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const hasSession = Boolean(session?.email);
  const isPublicVisualEdit = location.pathname === "/visual-edit";
  useDesignVariantPickTracking();
  // The home prompt composer takes focus on load, and without this the shortcut
  // is swallowed whenever a contenteditable has focus.
  useCommandMenuShortcut(
    useCallback(() => {
      if (!hasSession || isPublicVisualEdit) return;
      setCmdkOpen(true);
    }, [hasSession, isPublicVisualEdit]),
    { allowContentEditable: true },
  );

  const content = isPublicVisualEdit ? (
    <Outlet />
  ) : (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );

  return (
    <>
      {hasSession && <DbSyncSetup />}
      <OpenVisualEditWebMcp />
      {hasSession && !isPublicVisualEdit && (
        <DesignCommandMenu open={cmdkOpen} onOpenChange={setCmdkOpen} />
      )}
      {content}
    </>
  );
}

/**
 * Bypass requires an actual embed credential, not just the `embedded=1`
 * display flag: the Electron desktop shell opens every app tab with that
 * flag and no token, and a bare-flag bypass sent those signed-out tabs
 * straight into an infinite 401 poll instead of sign-in.
 */
export function computeSessionBypass(pathname: string): boolean {
  return Boolean(getEmbedAuthToken()) || isPublicDesignAppPath(pathname);
}

/**
 * The editor lives under `/design/`, a public path, so the notice cannot key
 * off session bypass. Embeds, the present view and visual edit stay as they are.
 */
function supportsUnsupportedDeviceNotice(pathname: string): boolean {
  return (
    !isEmbedAuthActive() &&
    !pathname.startsWith("/present/") &&
    !pathname.startsWith("/visual-edit")
  );
}

export default function Root() {
  const [queryClient] = useState(() => createAgentNativeQueryClient());
  const location = useLocation();
  const homeSuggestionSeed = useHomeSuggestionSeedForHome(
    location.pathname === "/" || location.pathname === "/home",
    "design",
  );
  const { session } = useSession();
  const homeSuggestionRoleScope =
    session?.authUserId || session?.userId
      ? JSON.stringify([
          session.authUserId ?? session.userId,
          session.orgId ?? "",
        ])
      : null;
  const homeSuggestionDraftScope = homeSuggestionRoleScope ?? "anonymous";
  const homeSuggestionRole = useMemo(
    () => readHomeSuggestionRole("design", homeSuggestionRoleScope),
    [homeSuggestionRoleScope, location.pathname],
  );
  const homeSuggestionOrder = useMemo(() => {
    const rolePool = DESIGN_HOME_SUGGESTION_POOLS[homeSuggestionRole];
    const pool = rolePool?.length
      ? rolePool
      : DESIGN_HOME_SUGGESTION_POOLS.general;
    return createHomeSuggestionOrder(
      pool.length,
      createHomeSuggestionRandom(homeSuggestionSeed),
    );
  }, [homeSuggestionRole, homeSuggestionSeed]);
  const sessionBypass = computeSessionBypass(location.pathname);
  const firstPaintSuggestions = useMemo(
    () =>
      designFirstPaintSuggestions(
        homeSuggestionSeed,
        homeSuggestionOrder,
        homeSuggestionRole,
      ),
    [homeSuggestionOrder, homeSuggestionRole, homeSuggestionSeed],
  );
  const firstPaintHome =
    location.pathname === "/" || location.pathname === "/home" ? (
      <QueryClientProvider client={queryClient}>
        <AppShellSkeleton
          layout="prompt-library"
          firstPaintHome={{
            ...designFirstPaintHome,
            promptDraftScope: `design:new:0:${homeSuggestionDraftScope}`,
            promptHandoffScope: homeSuggestionDraftScope,
            suggestions: firstPaintSuggestions,
            suggestionRole: homeSuggestionRole,
            suggestionSeed: homeSuggestionSeed,
            loadSuggestionMessages: loadFirstPaintSuggestionMessages,
            onHomeSuggestionClick: trackDesignHomeSuggestionClick,
          }}
        />
      </QueryClientProvider>
    ) : undefined;
  return (
    <HomeSuggestionSeedProvider
      seed={homeSuggestionSeed}
      role={homeSuggestionRole}
    >
      <AppToolkitProvider>
        <AppProviders
          queryClient={queryClient}
          skeletonLayout="prompt-library"
          {...(firstPaintHome ? { clientOnlyFallback: firstPaintHome } : {})}
          sessionBypass={sessionBypass}
          {...(supportsUnsupportedDeviceNotice(location.pathname)
            ? {
                unsupportedDevice: {
                  appName: "Design",
                  ...(isPrivateDesignEditorPath(location.pathname)
                    ? { subject: "design" }
                    : {}),
                },
              }
            : {})}
          webMcpExcludeActionNames={DESIGN_WEBMCP_EXCLUDED_ACTIONS}
          i18n={{ catalog: i18nCatalog }}
          toaster={<DesignToaster />}
        >
          <PrivateRootContent />
        </AppProviders>
      </AppToolkitProvider>
    </HomeSuggestionSeedProvider>
  );
}

export { ErrorBoundary } from "@agent-native/toolkit/app/shared";
