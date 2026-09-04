import { defineBlock, type BlockReadProps } from "@agent-native/core/blocks";
import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { Link, useLocation } from "react-router";

import { BuilderLaunchLink } from "../BuilderWaitlistPopover";
import { sitePathForLocale, type DocsLocale } from "../docs-locale";
import {
  gettingStartedPathsMdx,
  gettingStartedPathsSchema,
  type GettingStartedPathsData,
} from "./getting-started-paths.config";

export type GettingStartedTab = "local" | "cloud";

export function gettingStartedTabFromSearch(search: string): GettingStartedTab {
  return new URLSearchParams(search).get("tab") === "cloud" ? "cloud" : "local";
}

export function gettingStartedIntro(markdown: string): string {
  const pathsIndex = markdown.indexOf("<GettingStartedPaths");
  return (pathsIndex === -1 ? markdown : markdown.slice(0, pathsIndex)).trim();
}

function choosePath(option: "build_local" | "build_cloud") {
  trackEvent("choose get started path", {
    option,
    location: "getting_started",
  });
}

function pathForTab(tab: GettingStartedTab, locale: DocsLocale) {
  const docsPath = sitePathForLocale("/docs", locale);
  return tab === "cloud" ? `${docsPath}?tab=cloud` : docsPath;
}

export function GettingStartedTabs({
  activeTab,
}: {
  activeTab?: GettingStartedTab;
}) {
  const t = useT();
  const { locale } = useLocale();
  const location = useLocation();
  const selectedTab = activeTab ?? gettingStartedTabFromSearch(location.search);
  const tabs = [
    {
      id: "local" as const,
      label: t("gettingStarted.tabs.local"),
      description: t("gettingStarted.tabs.localDescription"),
    },
    {
      id: "cloud" as const,
      label: t("gettingStarted.tabs.cloud"),
      description: t("gettingStarted.tabs.cloudDescription"),
    },
  ];

  return (
    <nav
      className="getting-started-tabs"
      aria-label={t("gettingStarted.tabs.label")}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === selectedTab;
        return (
          <Link
            key={tab.id}
            to={pathForTab(tab.id, locale)}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? "page" : undefined}
            className="getting-started-tab"
            onClick={() =>
              choosePath(tab.id === "cloud" ? "build_cloud" : "build_local")
            }
          >
            <span className="getting-started-tab-label">{tab.label}</span>
            <span className="getting-started-tab-description">
              {tab.description}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function GettingStartedCloudContent() {
  const t = useT();
  const steps = [
    {
      number: 1,
      title: t("gettingStarted.cloud.stepOneTitle"),
      body: t("gettingStarted.cloud.stepOneBody"),
    },
    {
      number: 2,
      title: t("gettingStarted.cloud.stepTwoTitle"),
      body: t("gettingStarted.cloud.stepTwoBody"),
    },
    {
      number: 3,
      title: t("gettingStarted.cloud.stepThreeTitle"),
      body: t("gettingStarted.cloud.stepThreeBody"),
    },
  ];

  return (
    <div className="docs-content getting-started-cloud">
      <p className="getting-started-cloud-intro">
        {t("gettingStarted.cloud.intro")}
      </p>
      <ol className="getting-started-cloud-steps">
        {steps.map((step) => (
          <li className="getting-started-cloud-step" key={step.number}>
            <h2>
              <span
                className="getting-started-cloud-step-number"
                aria-hidden="true"
              >
                {step.number}
              </span>
              {step.title}
            </h2>
            <p>{step.body}</p>
            {step.number === 1 ? (
              <BuilderLaunchLink
                className="getting-started-cloud-cta"
                onClick={() => choosePath("build_cloud")}
              />
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function GettingStartedPathsBlock(
  _props: BlockReadProps<GettingStartedPathsData>,
) {
  return <GettingStartedTabs />;
}

export const gettingStartedPathsBlock = defineBlock<GettingStartedPathsData>({
  type: "getting-started-paths",
  schema: gettingStartedPathsSchema,
  mdx: gettingStartedPathsMdx,
  Read: GettingStartedPathsBlock,
  placement: ["block"],
  label: "Getting started guide note", // i18n-ignore -- developer-only docs block registry metadata.
  description: "Orients readers to local, live, and browser-based starts.", // i18n-ignore -- developer-only docs block registry metadata.
  empty: () => ({}),
});
