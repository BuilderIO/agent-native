import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconArrowRight,
  IconBrandVisualStudio,
  IconBraces,
  IconCheck,
  IconCopy,
  IconFolders,
  IconHierarchy,
  IconLayoutKanban,
  IconLink,
} from "@tabler/icons-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import { SectionDivider } from "../components/SectionDivider";
import {
  TemplateCapabilityGrid,
  TemplateComparisonTable,
  TemplateFinalCta,
  TemplateHero,
  TemplateLandingFaq,
  TemplateLandingShell,
  TemplateSplitFeature,
  TemplateStatOrStepsGrid,
  TemplateStatOrStepsGridItem,
} from "../components/template-landing";
import { templates, trackEvent } from "../components/TemplateCard";
import { withTemplateSocialImage } from "../seo";

export const meta = () =>
  withTemplateSocialImage(
    [
      {
        title:
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        name: "description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, prototypes, and shareable review links — installed in seconds as a skill for Codex, Claude Code, and any coding agent.",
      },
      {
        property: "og:title",
        content:
          "Agent-Native Plans — Visual Planning for Codex, Claude Code & Coding Agents",
      },
      {
        property: "og:description",
        content:
          "Give your coding agent a visual plan surface. Wireframes, diagrams, annotated code, and shareable review links.",
      },
      {
        name: "keywords",
        content:
          "AI coding agent plans, visual planning, Codex visual plan, Claude Code plans, coding agent wireframe, agent plan skill, visual plan mode, AI diagram generator, agent-native plans, annotated code review, shareable agent plans",
      },
    ],
    "Plans",
  );

const template = templates.find((t) => t.slug === "plan")!;

const INSTALL_COMMAND = "npx @agent-native/core@latest skills add visual-plan";
const AGENT_PROMPT = `Install the Agent-Native Plans skill
(${INSTALL_COMMAND}),
then run /visual-plan on my current branch before writing any code.`;

const PLAN_VIDEO_PREVIEWS = [
  {
    title: "Triggering code to diagram itself",
    href: "https://clips.agent-native.com/share/F5l6RppFaQDF?ref=clip_share",
    thumbnail: "https://clips.agent-native.com/api/thumbnail/F5l6RppFaQDF",
  },
  {
    title: "Better, more visual plans for Claude Code",
    href: "https://clips.agent-native.com/share/F6SlN9TdlK30?ref=clip_share",
    thumbnail: "https://clips.agent-native.com/api/thumbnail/F6SlN9TdlK30",
  },
  {
    title: "Visual MDX Plans for APIs, UIs, and Flows",
    href: "https://clips.agent-native.com/share/YuM1nM1pcX3e?ref=clip_share",
    thumbnail: "https://clips.agent-native.com/api/thumbnail/YuM1nM1pcX3e",
  },
];

type PlanVideoCarouselHandle = {
  scroll: (direction: -1 | 1) => void;
};

const PlanVideoCarousel = forwardRef<PlanVideoCarouselHandle>(
  function PlanVideoCarousel(_props, ref) {
    const sliderRef = useRef<HTMLDivElement>(null);

    function scroll(direction: -1 | 1) {
      const slider = sliderRef.current;
      if (!slider) return;
      const isRtl = getComputedStyle(slider).direction === "rtl";
      slider.scrollBy({
        left: direction * slider.clientWidth * 0.8 * (isRtl ? -1 : 1),
        behavior: "smooth",
      });
    }

    useImperativeHandle(ref, () => ({ scroll }), []);

    return (
      <div
        ref={sliderRef}
        aria-label="Visual plan videos"
        className="flex snap-x snap-mandatory overflow-x-auto border border-[var(--docs-border)] bg-[var(--bg)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {PLAN_VIDEO_PREVIEWS.map((video, index) => (
          <a
            key={video.href}
            href={video.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`group flex basis-[82%] shrink-0 snap-start flex-col bg-[var(--bg)] text-[var(--fg)] no-underline transition hover:no-underline sm:basis-[46%] lg:basis-1/3 ${
              index > 0 ? "border-s border-[var(--docs-border)]" : ""
            }`}
            onClick={() =>
              trackEvent("view plan video preview", {
                clip: video.href,
                location: "landing_page_video_carousel",
              })
            }
          >
            <img
              src={video.thumbnail}
              alt=""
              loading="lazy"
              decoding="async"
              className="aspect-video w-full border-b border-[var(--docs-border)] object-cover"
            />
            <div className="flex flex-1 items-center justify-between gap-4 p-6 sm:p-8">
              <h3 className="m-0 text-xl font-medium leading-[1.15] text-[var(--fg)]">
                {video.title}
              </h3>
              <IconArrowRight
                aria-hidden="true"
                className="size-[18px] shrink-0 transition-transform group-hover:translate-x-1"
              />
            </div>
          </a>
        ))}
      </div>
    );
  },
);

export default function PlanTemplate() {
  const t = useT();
  const [agentPromptCopied, setAgentPromptCopied] = useState(false);
  const videoCarouselRef = useRef<PlanVideoCarouselHandle>(null);

  function handleCopyAgentPrompt() {
    navigator.clipboard.writeText(AGENT_PROMPT);
    setAgentPromptCopied(true);
    trackEvent("copy agent prompt", {
      template: template.slug,
      location: "landing_page_final_cta",
    });
    setTimeout(() => setAgentPromptCopied(false), 2000);
  }
  const capabilities = [
    {
      icon: IconLayoutKanban,
      title: t("templateLanding.plan.s020"),
      body: t("templateLanding.plan.s021"),
    },
    {
      icon: IconHierarchy,
      title: t("templateLanding.plan.s022"),
      body: t("templateLanding.plan.s023"),
    },
    {
      icon: IconBraces,
      title: t("templateLanding.plan.s024"),
      body: t("templateLanding.plan.s025"),
    },
    {
      icon: IconLink,
      title: t("templateLanding.plan.s026"),
      body: t("templateLanding.plan.s027"),
    },
    {
      icon: IconFolders,
      title: t("templateLanding.plan.s028"),
      body: t("templateLanding.plan.s029"),
    },
  ];
  const workflowSteps = [
    {
      step: "1",
      title: t("templateLanding.plan.s006"),
      body: t("templateLanding.plan.s007"),
    },
    {
      step: "2",
      title: t("templateLanding.plan.s008"),
      body: t("templateLanding.plan.s009"),
    },
    {
      step: "3",
      title: t("templateLanding.plan.s010"),
      body: t("templateLanding.plan.s011"),
    },
    {
      step: "4",
      title: t("templateLanding.plan.s012"),
      body: t("templateLanding.plan.s013"),
    },
  ];
  const faqItems = Array.from({ length: 6 }, (_, index) => {
    const itemNumber = index + 1;
    return {
      id: `plan-question-${itemNumber}`,
      question: t(`templateLanding.plan.faq.question${itemNumber}`),
      answer: (
        <p className="m-0">
          {t(`templateLanding.plan.faq.answer${itemNumber}`)}
        </p>
      ),
    };
  });

  return (
    <TemplateLandingShell>
      <TemplateHero
        eyebrow={
          <span style={{ color: template.color }}>
            {t("templateDetail.badge", { name: template.name })}
          </span>
        }
        title={
          <>
            <span className="text-[var(--fg)] lg:whitespace-nowrap">
              {t("templateLanding.plan.s015Primary")}{" "}
            </span>
            <span className="text-[var(--fg-secondary)] lg:block">
              {t("templateLanding.plan.s015Secondary")}
            </span>
          </>
        }
        description={<p className="m-0">{t("templateLanding.plan.s016")}</p>}
        media={
          <img
            src="https://cdn.builder.io/api/v1/image/assets%2FYJIGb4i01jvw0SRdL5Bt%2F62611d0841544a819df6e057251306a1?format=webp&width=800&height=1200"
            crossOrigin="anonymous"
            alt={t("templateLanding.plan.s001")}
            loading="lazy"
            decoding="async"
            className="h-auto max-h-[536px] w-full object-cover object-top"
          />
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <TemplateStatOrStepsGrid className="sm:!grid-cols-4">
          {[
            { number: "10+", label: t("templateLanding.plan.s002") },
            { number: "3", label: t("templateLanding.plan.s003") },
            { number: "Live", label: t("templateLanding.plan.s004") },
            { number: "AI", label: t("templateLanding.plan.s005") },
          ].map((stat) => (
            <TemplateStatOrStepsGridItem key={stat.label}>
              <div
                className="text-3xl font-medium tracking-tight sm:text-4xl"
                style={{ color: template.color }}
              >
                {stat.number}
              </div>
              <div className="text-lg text-[var(--fg-secondary)] sm:text-xl">
                {stat.label}
              </div>
            </TemplateStatOrStepsGridItem>
          ))}
        </TemplateStatOrStepsGrid>
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateCapabilityGrid
        intro={
          <>
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] tracking-tight text-[var(--fg)]">
              {t("templateLanding.plan.s018")}
            </h2>
            <p className="m-0 max-w-[320px] text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s019")}
            </p>
          </>
        }
      >
        {capabilities.map(({ icon: Icon, title, body }) => (
          <div
            key={title}
            className="flex flex-col gap-6 border-b border-[var(--docs-border)] p-6 sm:border-e sm:p-8 sm:even:border-e-0 sm:[&:nth-child(5)]:border-b-0 sm:[&:nth-child(6)]:border-b-0"
          >
            <div
              className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--docs-border)]"
              style={{ color: template.color }}
            >
              <Icon aria-hidden="true" className="size-[18px]" stroke={1.75} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="m-0 text-lg font-medium leading-[1.15] text-[var(--fg)]">
                {title}
              </h3>
              <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
                {body}
              </p>
            </div>
          </div>
        ))}
        <div className="flex flex-col gap-6 border-b border-[var(--docs-border)] p-6 sm:border-e sm:p-8 sm:even:border-e-0 sm:[&:nth-child(5)]:border-b-0 sm:[&:nth-child(6)]:border-b-0">
          <div
            className="inline-flex size-9 items-center justify-center rounded-md border border-[var(--docs-border)]"
            style={{ color: template.color }}
          >
            <IconBrandVisualStudio
              aria-hidden="true"
              className="size-[18px]"
              stroke={1.75}
            />
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="m-0 text-lg font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.plan.s061")}
            </h3>
            <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s062")}{" "}
              <a
                href="https://marketplace.visualstudio.com/items?itemName=Builder.agent-native"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--fg)] underline underline-offset-2"
              >
                {t("templateLanding.plan.s063")}
              </a>
              {t("templateLanding.plan.s030")}
            </p>
          </div>
        </div>
      </TemplateCapabilityGrid>

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:px-8 sm:pb-14 sm:pt-20">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-tight text-[var(--fg)] sm:text-4xl">
            {t("templateLanding.plan.s031")}
          </h2>
          <p className="m-0 mt-4 max-w-2xl text-lg leading-[1.4] text-[var(--fg-secondary)]">
            {t("templateLanding.plan.s032")}
          </p>
        </div>
        <TemplateStatOrStepsGrid className="sm:!grid-cols-2 lg:!grid-cols-4">
          {workflowSteps.map((item, index) => (
            <TemplateStatOrStepsGridItem
              key={item.step}
              className={`${index > 1 ? "sm:!border-t" : "sm:!border-t-0"} ${
                index % 2 === 0 ? "sm:!border-s-0" : "sm:!border-s"
              } ${
                index > 0 ? "lg:!border-s" : "lg:!border-s-0"
              } lg:!border-t-0`}
            >
              <div
                className="font-mono text-sm font-semibold uppercase tracking-[0.14em]"
                style={{ color: template.color }}
              >
                {item.step}
              </div>
              <h3 className="m-0 text-xl font-medium leading-[1.15] text-[var(--fg)]">
                {item.title}
              </h3>
              <p className="m-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
                {item.body}
              </p>
            </TemplateStatOrStepsGridItem>
          ))}
        </TemplateStatOrStepsGrid>
      </section>

      <SectionDivider showOnSmallScreens={false} />

      <TemplateSplitFeature
        leading={
          <div className="flex h-full flex-col px-6 py-10 sm:px-8 lg:px-10 lg:py-16">
            <h2 className="m-0 text-[1.75rem] font-medium leading-[1.15] text-[var(--fg)]">
              {t("templateLanding.plan.s033")}
            </h2>
            <p className="m-0 pt-5 text-lg leading-[1.3] text-[var(--fg-secondary)]">
              {t("templateLanding.plan.s034")}
            </p>
            <ul className="m-0 mt-6 list-none p-0 text-base leading-[1.4] text-[var(--fg-secondary)]">
              {[
                "s064",
                "s065",
                "s066",
                "s067",
                "s068",
                "s069",
                "s070",
                "s071",
              ].map((key) => (
                <li key={key} className="flex items-start gap-3 py-2">
                  <IconCheck
                    aria-hidden="true"
                    className="mt-0.5 size-5 shrink-0"
                    stroke={2}
                    style={{ color: template.color }}
                  />
                  {t(`templateLanding.plan.${key}`)}
                </li>
              ))}
            </ul>
          </div>
        }
        trailing={
          <div className="flex h-full items-center p-6 sm:p-8 lg:p-10">
            <div className="w-full overflow-x-auto border border-[var(--code-border)] bg-[var(--code-bg)] p-6 font-mono text-sm">
              <div className="mb-4 text-[var(--fg-secondary)]">
                {t("templateLanding.plan.s072")}
              </div>
              <div className="grid min-w-[24rem] gap-3 text-[var(--fg)]">
                <div>
                  <span style={{ color: template.color }}>type:</span>{" "}
                  {t("templateLanding.plan.s035")}
                </div>
                <div>
                  <span style={{ color: template.color }}>file:</span>{" "}
                  src/actions/create-post.ts
                </div>
                <div>
                  <span style={{ color: template.color }}>annotations:</span>
                </div>
                <div className="ps-4">
                  <span style={{ color: template.color }}>line 12:</span>{" "}
                  {t("templateLanding.plan.s036")}
                </div>
                <div className="ps-4">
                  <span style={{ color: template.color }}>line 24:</span>{" "}
                  {t("templateLanding.plan.s037")}
                </div>
                <div>
                  <span style={{ color: template.color }}>change:</span>{" "}
                  {t("templateLanding.plan.s038")}
                </div>
              </div>
            </div>
          </div>
        }
      />

      <SectionDivider showOnSmallScreens={false} />

      <section className="border-t border-[var(--docs-border)]">
        <div className="border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:px-8 sm:pb-14 sm:pt-24 lg:pb-20 lg:pt-32">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-tight text-[var(--fg)] sm:text-4xl lg:text-[2.875rem]">
            {t("templateLanding.plan.s039")}
          </h2>
        </div>
        <TemplateComparisonTable
          caption={t("templateLanding.plan.s039")}
          featureHeader={t("templateLanding.plan.s039")}
          columns={[
            {
              id: "markdown",
              header: t("templateLanding.plan.s040"),
            },
            {
              id: "canvas",
              header: t("templateLanding.plan.s073"),
            },
            {
              id: "agent-native",
              emphasized: true,
              agentNative: { color: template.color, name: template.name },
            },
          ]}
          rows={[
            {
              id: "visual-rendering",
              label: t("templateLanding.plan.s041"),
              cells: {
                markdown: t("templateLanding.plan.s042"),
                canvas: t("templateLanding.plan.s043"),
                "agent-native": t("templateLanding.plan.s044"),
              },
            },
            {
              id: "agent-update",
              label: t("templateLanding.plan.s045"),
              cells: {
                markdown: t("templateLanding.plan.s046"),
                canvas: t("templateLanding.plan.s047"),
                "agent-native": t("templateLanding.plan.s048"),
              },
            },
            {
              id: "shareable-link",
              label: t("templateLanding.plan.s049"),
              cells: {
                markdown: t("templateLanding.plan.s042"),
                canvas: t("templateLanding.plan.s050"),
                "agent-native": t("templateLanding.plan.s051"),
              },
            },
            {
              id: "prototype-runner",
              label: t("templateLanding.plan.s005"),
              cells: {
                markdown: t("templateLanding.plan.s042"),
                canvas: t("templateLanding.plan.s042"),
                "agent-native": t("templateLanding.plan.s052"),
              },
            },
            {
              id: "agent-integrations",
              label: t("templateLanding.plan.s053"),
              cells: {
                markdown: t("templateLanding.plan.s050"),
                canvas: t("templateLanding.plan.s042"),
                "agent-native": t("templateLanding.plan.s054"),
              },
            },
            {
              id: "open-source",
              label: t("templateLanding.plan.s055"),
              cells: {
                markdown: t("templateLanding.plan.s074"),
                canvas: t("templateLanding.plan.s042"),
                "agent-native": t("templateLanding.plan.s056"),
              },
            },
          ]}
        />
      </section>

      <section
        id="watch-plans"
        className="border-t border-[var(--docs-border)]"
      >
        <div className="flex flex-col gap-6 border-x border-[var(--docs-border)] px-6 pb-10 pt-16 sm:flex-row sm:items-end sm:justify-between sm:px-8 sm:pb-14 sm:pt-24 lg:pb-20 lg:pt-32">
          <h2 className="m-0 text-[1.75rem] font-medium leading-[1.05] tracking-tight text-[var(--fg)] sm:text-4xl lg:text-[2.875rem]">
            Watch visual plans take shape
          </h2>
          <div className="flex gap-3">
            <button
              type="button"
              aria-label="Previous video"
              onClick={() => videoCarouselRef.current?.scroll(-1)}
              className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--docs-border)] bg-[var(--bg)] text-[var(--fg)] transition hover:border-[var(--fg-secondary)]"
            >
              <IconArrowLeft aria-hidden="true" className="size-[18px]" />
            </button>
            <button
              type="button"
              aria-label="Next video"
              onClick={() => videoCarouselRef.current?.scroll(1)}
              className="inline-flex size-10 items-center justify-center rounded-md border border-[var(--docs-border)] bg-[var(--bg)] text-[var(--fg)] transition hover:border-[var(--fg-secondary)]"
            >
              <IconArrowRight aria-hidden="true" className="size-[18px]" />
            </button>
          </div>
        </div>
        <div className="border-x border-[var(--docs-border)] pb-16">
          <PlanVideoCarousel ref={videoCarouselRef} />
        </div>
      </section>

      <TemplateFinalCta
        eyebrow={
          <span
            className="font-mono text-sm font-semibold uppercase tracking-[0.14em]"
            style={{ color: template.color }}
          >
            Agent-Native {template.name}
          </span>
        }
        title={t("templateLanding.plan.s057")}
        actions={
          <div className="flex w-full min-w-0 items-center gap-6 rounded-md border border-[var(--docs-border)] bg-[var(--code-bg)] px-4 py-3 sm:px-5">
            <p className="m-0 min-w-0 flex-1 whitespace-pre-wrap font-mono text-sm leading-6 text-[var(--fg)] sm:text-base">
              {AGENT_PROMPT}
            </p>
            <button
              type="button"
              onClick={handleCopyAgentPrompt}
              aria-label="Copy agent prompt"
              className="inline-flex size-[34px] shrink-0 items-center justify-center rounded-md border border-[var(--docs-border)] bg-[var(--bg)] text-[var(--fg)] transition hover:border-[var(--fg-secondary)]"
            >
              {agentPromptCopied ? (
                <IconCheck aria-hidden="true" className="size-[18px]" />
              ) : (
                <IconCopy aria-hidden="true" className="size-[18px]" />
              )}
            </button>
          </div>
        }
      >
        <p className="m-0 max-w-2xl px-6 text-lg leading-[1.4] text-[var(--fg-secondary)] sm:px-8">
          {t("templateLanding.plan.s058")}
        </p>
      </TemplateFinalCta>

      <TemplateLandingFaq
        idPrefix="plan-faq"
        eyebrow={
          <span style={{ color: template.color }}>
            {t("templateLanding.faq.eyebrow")}
          </span>
        }
        title={t("templateLanding.faq.title")}
        items={faqItems}
      />
    </TemplateLandingShell>
  );
}
