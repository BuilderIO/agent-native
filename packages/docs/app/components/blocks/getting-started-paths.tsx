import {
  CalloutBlock,
  defineBlock,
  type BlockReadProps,
} from "@agent-native/core/blocks";
import { trackEvent } from "@agent-native/core/client/analytics";
import { useLocale, useT } from "@agent-native/core/client/i18n";
import { Link } from "react-router";

import { BuildOnlinePopover } from "../BuilderWaitlistPopover";
import { sitePathForLocale } from "../docs-locale";
import {
  gettingStartedPathsMdx,
  gettingStartedPathsSchema,
  type GettingStartedPathsData,
} from "./getting-started-paths.config";

function choosePath(option: "browse_apps" | "build_online") {
  trackEvent("choose get started path", {
    option,
    location: "getting_started",
  });
}

export function GettingStartedPathsBlock({
  blockId,
}: BlockReadProps<GettingStartedPathsData>) {
  const t = useT();
  const { locale } = useLocale();

  return (
    <CalloutBlock
      blockId={blockId}
      data={{ tone: "info", body: "Getting started paths" }}
      ctx={{
        renderMarkdown: () => (
          <div className="docs-content">
            <p>
              {t("gettingStarted.guideNote.prompt")}{" "}
              <strong>
                <Link
                  to={sitePathForLocale("/apps", locale)}
                  onClick={() => choosePath("browse_apps")}
                >
                  {t("gettingStarted.guideNote.exploreApp")}
                </Link>
              </strong>{" "}
              {t("gettingStarted.guideNote.between")}{" "}
              <BuildOnlinePopover
                location="getting_started"
                onOpen={() => choosePath("build_online")}
                trigger={
                  <button
                    type="button"
                    className="inline cursor-pointer border-0 bg-transparent p-0 font-[inherit] font-semibold text-[var(--docs-accent)] hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--docs-accent)]"
                  >
                    {t("gettingStarted.guideNote.joinWaitlist")}
                  </button>
                }
              />{" "}
              {t("gettingStarted.guideNote.end")}
            </p>
          </div>
        ),
      }}
    />
  );
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
