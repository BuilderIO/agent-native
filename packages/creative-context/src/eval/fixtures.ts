import type { RetrievalEvalTask } from "./index.js";

export interface CreativeContextGoldDocument {
  key: string;
  kind: "slide" | "figma-frame" | "notion-section" | "web-page" | "image";
  title: string;
  text: string;
  imageBase64?: string;
  owner: "personal" | "organization" | "other-organization";
  status: "active" | "deprecated";
  revisionOf?: string;
}

export const CREATIVE_CONTEXT_PURPLE_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOI9n+JFTEMLQkAOpFkwUU6BmIAAAAASUVORK5CYII=";
export const CREATIVE_CONTEXT_INK_IMAGE_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGPg5hbAihiGlgQAtbUJgThTKnUAAAAASUVORK5CYII=";

export const CREATIVE_CONTEXT_GOLD_DOCUMENTS: readonly CreativeContextGoldDocument[] =
  [
    {
      key: "slide:metrics-v2",
      kind: "slide",
      title: "Weekly metrics scorecard",
      text: "Dark scorecard with four KPI tiles, a purple trend line, and a concise takeaway.",
      owner: "organization",
      status: "active",
      revisionOf: "slide:metrics-v1",
    },
    {
      key: "slide:metrics-v1",
      kind: "slide",
      title: "Weekly metrics scorecard old",
      text: "Previous scorecard with four KPI tiles.",
      owner: "organization",
      status: "deprecated",
    },
    {
      key: "figma:pricing-hero",
      kind: "figma-frame",
      title: "Pricing hero",
      text: "1440 by 820 dark hero, Inter 56 heading, three pricing cards, primary trial button.",
      imageBase64: CREATIVE_CONTEXT_INK_IMAGE_BASE64,
      owner: "organization",
      status: "active",
    },
    {
      key: "notion:dense-guidelines",
      kind: "notion-section",
      title: "Dense launch system guidance",
      text: "For launch narratives, lead with the user outcome, name the concrete workflow, support claims with one metric, keep headings under eight words, use direct active voice, avoid inflated superlatives, preserve the primary purple and ink palette, use compact scorecards for quantitative proof, and close with one explicit trial action. Product screenshots should center the working surface, annotations should identify the changed behavior, and supporting copy should remain subordinate to the artifact. For executive reviews, pair each KPI with a trend and a one-sentence interpretation. For campaign variants, retain the same hierarchy while adapting the evidence and call to action to the audience segment.",
      owner: "organization",
      status: "active",
    },
    {
      key: "notion:voice",
      kind: "notion-section",
      title: "Launch writing principles",
      text: "Direct, concise, optimistic product writing. Prefer concrete verbs and short sentences.",
      owner: "organization",
      status: "active",
    },
    {
      key: "web:palette",
      kind: "web-page",
      title: "Brand home page",
      text: "Primary #5B4FE9, ink #0B0B10, Inter headings, twelve-pixel radii.",
      owner: "organization",
      status: "active",
    },
    {
      key: "image:campaign",
      kind: "image",
      title: "Launch campaign hero",
      text: "Purple gradient product hero with a centered device render and compact white headline.",
      imageBase64: CREATIVE_CONTEXT_PURPLE_IMAGE_BASE64,
      owner: "organization",
      status: "active",
    },
    {
      key: "private:other-org",
      kind: "slide",
      title: "Confidential acquisition plan",
      text: "Restricted content owned by another organization.",
      owner: "other-organization",
      status: "active",
    },
  ] as const;

export const CREATIVE_CONTEXT_GOLD_TASKS: readonly RetrievalEvalTask[] = [
  {
    id: "exact-metrics-layout",
    query: { text: "weekly metrics scorecard with four KPI tiles" },
    relevantKeys: ["slide:metrics-v2"],
    forbiddenKeys: ["private:other-org"],
  },
  {
    id: "visual-pricing-match",
    query: { text: "dark pricing hero with three cards" },
    relevantKeys: ["figma:pricing-hero"],
    forbiddenKeys: ["private:other-org"],
  },
  {
    id: "voice-match",
    query: { text: "direct concise optimistic launch copy" },
    relevantKeys: ["notion:voice"],
    forbiddenKeys: ["private:other-org"],
  },
  {
    id: "text-to-image-campaign-match",
    query: { text: "purple campaign hero with centered device" },
    relevantKeys: ["image:campaign"],
    forbiddenKeys: ["private:other-org"],
  },
  {
    id: "image-to-image-campaign-match",
    query: {
      images: [
        {
          mimeType: "image/png",
          base64: CREATIVE_CONTEXT_PURPLE_IMAGE_BASE64,
        },
      ],
    },
    relevantKeys: ["image:campaign"],
    forbiddenKeys: ["private:other-org"],
  },
  {
    id: "dense-guidance-match",
    query: {
      text: "executive launch KPI trend interpretation active voice purple ink compact scorecard",
    },
    relevantKeys: ["notion:dense-guidelines"],
    forbiddenKeys: ["private:other-org"],
  },
] as const;
