import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCampaignCtaUrl } from "../app/lib/campaign-links";
import { campaignMeta } from "../app/lib/campaign-seo";
import { buildCampaignPages } from "../app/vite-sitemap-plugin";
import {
  ARTICLE_TOPICS,
  getArticleTopics,
  type ArticleTopic,
  type ArticleTopicSummary,
} from "../lib/article-topics";
import { articleMarkdown, parseCampaignContent } from "../lib/campaign-content";
import { loadCampaignContentFromDisk } from "../lib/campaign-content-node";
import { loadCampaignContent } from "../lib/campaign-content.server";

const common = {
  slug: "sample",
  job_id: "sample-job",
  title: "Sample",
  meta_description: "Sample description",
  app_cta_url: "https://example.com/app?existing=1",
  cta_label: "Try",
  screenshot_alt: "Sample image",
  cta_band_heading: "Try the workflow",
  cta_band_subhead: "Start here",
};
const useCase = {
  ...common,
  app: "clips",
  subhead: "Sample workflow",
  secondary_cta_label: "Read",
  old_way: {
    heading: "Before",
    body: "Manual work",
    internal: "PRIVATE-NESTED",
  },
  new_way: { heading: "After", steps: ["Start"] },
  faqs: [{ q: "Why?", a: "Time" }],
  updated: "2026-09-01",
  audience: "PRIVATE-AUDIENCE",
  internal: { strategy: "PRIVATE-STRATEGY" },
};
const todaysStack = {
  heading: "Tools today",
  items: [{ text: "**A doc** keeps notes, but they get lost." }],
  in_app: "Keep the notes together.",
};
const replacementItems: Record<string, string[]> = {
  "ai-meeting-notes": [
    "**Your video call app** holds the meeting, but the notes are whatever someone typed while half-listening.",
    "**A note-taker, like Granola,** transcribes and summarizes, but meeting notes live apart from your screen recordings and dictations.",
    "**A shared doc** keeps the notes and decisions, until nobody opens it again and the owners and dates get lost.",
    "**Email** carries the recap, which someone rewrites from memory.",
  ],
  "ask-your-database-in-plain-english": [
    "**A SQL client** can answer anything, but only for the people who write SQL.",
    "**A BI tool, like Looker,** covers the questions someone planned for, and new ones wait for a data request.",
    "**A chat assistant with a CSV export** can answer a question, but every answer starts with exporting the data again.",
  ],
  "bug-reports-with-console-logs": [
    "**A screen recorder, like Loom,** shows what happened on screen, but not the console errors or the failed request behind it.",
    "**Browser DevTools** has those errors, but you have to copy them out by hand, and it's easy to grab the wrong one.",
    "**A ticket tracker** holds the write-up, so the video, the logs, and the steps end up in three different places.",
    "**Your coding agent** only sees what you paste into its chat. It never sees the moment things broke.",
  ],
  "crm-and-call-questions": [
    "**Your CRM's reports** cover the standard pipeline views, but the view you need usually isn't one of them.",
    "**A spreadsheet export** handles the custom analysis, and it's rebuilt every week.",
    "**A call recorder** captures what was said, but it sits apart from the deal data.",
    "**Slides** carry the pipeline review, with charts pasted in by hand.",
  ],
  "design-brief-to-prototype": [
    "**A doc** holds the brief. People agree with it, but they only react once they see something.",
    "**A design tool** turns the brief into screens, but someone has to draw every screen and state before anyone can click anything.",
    "**Chat and comment threads** collect the feedback, which lands on screenshots instead of the design itself.",
  ],
  "dictate-instead-of-typing": [
    "**Typing** is the default, so long prompts get shortened, and the detail is what gets cut.",
    "**Your operating system's built-in dictation** handles quick notes, but it may stumble on product and library names, and there's usually no history to search later.",
    "**A dictation app, like Wispr Flow,** lets you speak instead of type, but your dictations live in a separate app from your recordings and meeting notes.",
  ],
  "find-where-users-drop-off": [
    "**A product analytics tool, like Amplitude or Mixpanel,** has the events, but only a few people on the team know how to query it.",
    "**A session replay tool** shows what people did, in a separate place from your numbers.",
    "**A spreadsheet or doc** is how findings get shared, and the screenshot is stale by the next standup.",
  ],
  "landing-page-prototypes": [
    "**Last launch's page** is the usual starting point, so you inherit its structure even when the offer is different.",
    "**A page builder** is good for building and publishing, but harder to use for comparing directions before you commit.",
    "**Screenshots in chat** are how review happens, so feedback arrives as a list of comments about spacing.",
  ],
  "see-what-your-coding-agent-plans": [
    "**The terminal** is where the agent's plan shows up, as long text that's easy to skim and approve.",
    "**A design doc** captures the approach before building, but it's separate from the plan the agent actually follows.",
    "**A whiteboard or diagram tool** works for sketching the architecture and screens, but the diagram lives somewhere the agent doesn't.",
  ],
  "spec-your-coding-agent-builds-from": [
    "**A doc tool** holds the spec, but your coding agent can't open it.",
    "**Your agent's prompt** gets chunks of the spec pasted in, and that copy goes stale the moment the doc changes.",
    "**Chat threads** are where decisions get made, and the spec never hears about them.",
  ],
  "startup-kpi-dashboard": [
    "**Your billing system's export** has the revenue numbers, but someone has to export and paste them every month.",
    "**A spreadsheet** calculates MRR, churn, and growth, but it's rebuilt by hand and goes stale between updates.",
    "**A product analytics tool, like Amplitude or Mixpanel,** covers usage and retention, but only a few people know how to query it.",
    "**ChatGPT with a CSV** can answer questions about the numbers, but every answer starts with uploading the data again.",
  ],
  "startup-pitch-deck": [
    "**A template or last round's deck** is the starting point, so you restyle it by hand and hunt for stale numbers.",
    "**A spreadsheet** holds the traction and financials, and every number gets pasted into slides by hand.",
    "**Product screenshots** show the product, but they go stale as the product changes.",
    "**A general AI chat** can draft the story, but you still build every slide in your brand yourself.",
  ],
  "understand-what-your-coding-agent-changed": [
    "**The diff** is the review, line by line, and the important part is easy to miss.",
    "**The pull request description** explains what changed, but rarely how the change behaves.",
    "**A call with whoever made the change** answers questions, but it takes both people's time, and nothing is written down afterward.",
  ],
  "weekly-marketing-report": [
    "**Google Analytics** has traffic and conversions, but its reports rarely match the question you were asked.",
    "**Your CRM** has leads and pipeline, separate from the traffic numbers.",
    "**A spreadsheet** is where it all gets combined, and it's rebuilt every week.",
    "**A doc or slides** is how the report gets shared, and the screenshots go stale.",
  ],
  "wireframe-before-agent-builds": [
    "**A prompt** is where you describe the layout, so the agent guesses at what you meant.",
    "**A sketch on paper or a whiteboard** shows the layout, but the agent can't see it.",
    "**A design tool** gives you detailed mockups, which is more than you need before the agent builds a first version.",
  ],
};
const replacementConclusions: Record<string, string> = {
  "ai-meeting-notes":
    "In Clips, meetings from your Google Calendar get a transcript, a summary, notes, and action items, in the same searchable library as your recordings.",
  "ask-your-database-in-plain-english":
    "In Analytics, your database answers plain-English questions, and the answers stay in dashboards your team can open.",
  "bug-reports-with-console-logs":
    "In Clips, the recording, the transcript, and, with the Chrome extension, the console messages and request details sit behind one link that people and agents can both use.",
  "crm-and-call-questions":
    "In Analytics, your CRM data and the other GTM sources you connect answer plain-English questions, and the answers live in dashboards the team can share.",
  "design-brief-to-prototype":
    "In Design, the brief becomes an interactive prototype, directions sit side by side, and comments pin to the elements they're about.",
  "dictate-instead-of-typing":
    "In Clips, dictations, screen recordings, and meetings share one searchable library, and a personal vocabulary helps with your own terms.",
  "find-where-users-drop-off":
    "In Analytics, plain-English questions, dashboards, and session replays are in one app.",
  "landing-page-prototypes":
    "In Design, you compare versions side by side, pin comments to elements, and export the HTML. Publishing is still a separate step.",
  "see-what-your-coding-agent-plans":
    "In Plans, the agent's plan comes with diagrams, wireframes, and annotated code, and the agent can read your comments and revise it.",
  "spec-your-coding-agent-builds-from":
    "In Content, the spec, the decisions, and the tasks live in pages and databases your coding agent can reach through MCP.",
  "startup-kpi-dashboard":
    "In Analytics, you connect your sources, ask in plain English, and keep the answers as dashboards. The agent writes the SQL.",
  "startup-pitch-deck":
    "In Slides, the deck is drafted from your brief in your brand, and you edit it slide by slide or with the agent.",
  "understand-what-your-coding-agent-changed":
    "In Plans, a visual recap shows the behavior that changed, the files it touched, and annotated code, so you know where to look first.",
  "weekly-marketing-report":
    "In Analytics, traffic and pipeline data answer the same plain-English questions, and the report lives in a dashboard instead of a screenshot.",
  "wireframe-before-agent-builds":
    "In Plans, the wireframes are part of the agent's plan, so your comments go straight back to the agent that will build the screen.",
};
const recipe = {
  id: "sample-recipe",
  title: "Draft a summary",
  when: "After a meeting",
  do: "Ask for a summary",
  prompt: "Summarize the meeting",
  you_get: "A summary",
  save: "Keep the summary",
  how_often: "Every meeting",
};
const angle = {
  id: "engineering",
  audience: "Engineers",
  title: "Engineering workflow",
  subhead: "Share the technical details",
  old_way_body: "Manual engineering notes",
};
const optionalFields = {
  recipes: [recipe],
  connects_to: ["Calendar", "CRM"],
  next_jobs: ["next-job"],
  frequency: "weekly",
  how_often_label: "Every week",
  roles: ["engineering", "everyone"],
  angles: [angle],
};
const article = {
  ...common,
  use_case: "sample",
  topic: "coding-agents",
  apps: ["clips"],
  published: "2026-09-02",
  author: "Writer",
  related_resources: [
    { label: "Docs", url: "/docs/", internal: "PRIVATE-LINK" },
  ],
  audience: "PRIVATE-AUDIENCE",
  internal: "PRIVATE-STRATEGY",
};
const yaml = (value: unknown) => JSON.stringify(value);
const markdown = (value: unknown, body = "Public article body.") =>
  `---\n${yaml(value)}\n---\n\n${body}`;
function sources(
  useCases = { "sample.yaml": yaml(useCase) },
  articles = { "sample.md": markdown(article) },
) {
  return { useCases, articles };
}

afterEach(() => vi.restoreAllMocks());

describe("campaign content", () => {
  it("strips private and unknown fields recursively, including Markdown mirrors", () => {
    const content = parseCampaignContent(sources());
    expect(content.useCases).toHaveLength(1);
    expect(content.articles).toHaveLength(1);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
    expect(articleMarkdown(content.articles[0])).toBe(
      "# Sample\n\n\nPublic article body.\n",
    );
    expect(JSON.stringify(buildCampaignPages(content))).not.toContain(
      "PRIVATE",
    );
  });

  it("accepts missing or valid todays_stack without adding defaults", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const absent = parseCampaignContent(sources()).useCases[0];
    expect(absent).toBeDefined();
    expect(absent).not.toHaveProperty("todays_stack");
    for (const stack of [todaysStack, { ...todaysStack, items: [] }]) {
      const content = parseCampaignContent(
        sources({ "sample.yaml": yaml({ ...useCase, todays_stack: stack }) }),
      );
      expect(content.useCases).toHaveLength(1);
      expect(content.useCases[0].todays_stack).toEqual(stack);
    }
    expect(error).not.toHaveBeenCalled();
  });

  it("strips unknown fields from todays_stack and its items", () => {
    const content = parseCampaignContent(
      sources({
        "sample.yaml": yaml({
          ...useCase,
          todays_stack: {
            ...todaysStack,
            internal: "PRIVATE-STACK",
            items: todaysStack.items.map((item) => ({
              ...item,
              tool: "PRIVATE-OLD-TOOL",
              used_for: "PRIVATE-OLD-USE",
              breaks: "PRIVATE-OLD-BREAKS",
              unknown: "PRIVATE-UNKNOWN",
              internal: { strategy: "PRIVATE-TOOL" },
            })),
          },
        }),
      }),
    );
    expect(content.useCases).toHaveLength(1);
    expect(content.useCases[0].todays_stack).toEqual(todaysStack);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
  });

  it.each([
    null,
    "Tools",
    {},
    { ...todaysStack, heading: undefined },
    { ...todaysStack, heading: "   " },
    { ...todaysStack, heading: 1 },
    { ...todaysStack, in_app: undefined },
    { ...todaysStack, in_app: "" },
    { ...todaysStack, in_app: false },
    { ...todaysStack, items: undefined },
    { ...todaysStack, items: "A doc" },
    { ...todaysStack, items: [null] },
    ...[undefined, "", " \t ", null, 1, false, {}, []].map((text) => ({
      ...todaysStack,
      items: [{ text }],
    })),
    { ...todaysStack, items: ["A doc"] },
    { ...todaysStack, items: [{ tool: "A doc" }] },
    {
      ...todaysStack,
      items: [
        { tool: "A doc", used_for: "Taking notes", breaks: "Notes get lost" },
      ],
    },
  ])("skips malformed todays_stack explicitly (%#)", (stack) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseCampaignContent(
      sources({ "sample.yaml": yaml({ ...useCase, todays_stack: stack }) }),
    );
    expect(content.useCases).toEqual([]);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/invalid content skipped \(todays_stack/),
    );
  });

  it("accepts absent and populated optional workflow fields without inventing defaults", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const absent = parseCampaignContent(sources()).useCases[0];
    for (const key of Object.keys(optionalFields))
      expect(absent).not.toHaveProperty(key);
    const populated = parseCampaignContent(
      sources({
        "sample.yaml": yaml({ ...useCase, ...optionalFields }),
      }),
    ).useCases[0];
    expect(populated).toMatchObject(optionalFields);
    const { prompt: _prompt, save: _save, ...minimalRecipe } = recipe;
    const { old_way_body: _oldWay, ...minimalAngle } = angle;
    const minimal = parseCampaignContent(
      sources({
        "sample.yaml": yaml({
          ...useCase,
          recipes: [minimalRecipe],
          angles: [minimalAngle],
        }),
      }),
    ).useCases[0];
    expect(minimal.recipes).toEqual([minimalRecipe]);
    expect(minimal.angles).toEqual([minimalAngle]);
    const emptyArrays = {
      recipes: [],
      connects_to: [],
      next_jobs: [],
      roles: [],
      angles: [],
    };
    expect(
      parseCampaignContent(
        sources({
          "sample.yaml": yaml({ ...useCase, ...emptyArrays }),
        }),
      ).useCases[0],
    ).toMatchObject(emptyArrays);
    expect(error).not.toHaveBeenCalled();
  });

  it.each(["daily", "weekly", "per-project", "occasional"])(
    "accepts frequency %s",
    (frequency) => {
      expect(
        parseCampaignContent(
          sources({
            "sample.yaml": yaml({ ...useCase, frequency }),
          }),
        ).useCases[0].frequency,
      ).toBe(frequency);
    },
  );

  it("accepts every configured role and strips private nested recipe and angle properties", () => {
    const roles = [
      "engineering",
      "product",
      "design",
      "marketing",
      "revops",
      "sales",
      "founders",
      "finance",
      "everyone",
    ];
    const content = parseCampaignContent(
      sources({
        "sample.yaml": yaml({
          ...useCase,
          ...optionalFields,
          roles,
          recipes: [
            {
              ...recipe,
              internal: "PRIVATE-RECIPE",
              audience: "PRIVATE-RECIPE-AUDIENCE",
            },
          ],
          angles: [
            {
              ...angle,
              internal: "PRIVATE-ANGLE",
              strategy: "PRIVATE-STRATEGY",
            },
          ],
        }),
      }),
    );
    expect(content.useCases[0]).toMatchObject({ ...optionalFields, roles });
    expect(content.useCases[0].recipes).toEqual([recipe]);
    expect(content.useCases[0].angles).toEqual([angle]);
    expect(JSON.stringify(content)).not.toContain("PRIVATE");
  });

  it.each([
    ...Object.keys(optionalFields).flatMap((field) =>
      [null, 42, {}].map((value) => ({ field, value })),
    ),
    { field: "recipes", value: "recipe" },
    ...["id", "title", "when", "do", "you_get", "how_often"].flatMap((key) =>
      [undefined, "  ", 3].map((value) => ({
        field: "recipes",
        value: [{ ...recipe, [key]: value }],
      })),
    ),
    ...["prompt", "save"].flatMap((key) =>
      [" ", null, 3].map((value) => ({
        field: "recipes",
        value: [{ ...recipe, [key]: value }],
      })),
    ),
    { field: "recipes", value: [{ ...recipe, id: "Invalid ID" }] },
    { field: "recipes", value: [null] },
    { field: "connects_to", value: [""] },
    { field: "connects_to", value: [1] },
    { field: "next_jobs", value: ["Invalid job"] },
    { field: "next_jobs", value: [1] },
    { field: "frequency", value: "monthly" },
    { field: "frequency", value: "" },
    { field: "how_often_label", value: " " },
    { field: "roles", value: ["admin"] },
    { field: "roles", value: [1] },
    { field: "angles", value: [null] },
    ...["id", "audience", "title", "subhead"].flatMap((key) =>
      [undefined, " ", 3].map((value) => ({
        field: "angles",
        value: [{ ...angle, [key]: value }],
      })),
    ),
    { field: "angles", value: [{ ...angle, id: "Invalid ID" }] },
    ...[" ", null, 3].map((value) => ({
      field: "angles",
      value: [{ ...angle, old_way_body: value }],
    })),
  ])(
    "logs and skips malformed $field (%#) without discarding valid siblings",
    ({ field, value }) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const content = parseCampaignContent(
        sources(
          {
            "sample.yaml": yaml({ ...useCase, [field]: value }),
            "valid.yaml": yaml({ ...useCase, slug: "valid" }),
          },
          {},
        ),
      );
      expect(content.useCases.map((item) => item.slug)).toEqual(["valid"]);
      expect(error).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining(
          `sample.yaml: invalid content skipped (${field}`,
        ),
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain("PRIVATE");
    },
  );

  it("accepts Content as a use-case app and article app without creating an app category page", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseCampaignContent(
      sources(
        { "sample.yaml": yaml({ ...useCase, app: "content" }) },
        { "sample.md": markdown({ ...article, apps: ["content"] }) },
      ),
    );
    expect(content.useCases[0].app).toBe("content");
    expect(content.articles[0].apps).toEqual(["content"]);
    expect(error).not.toHaveBeenCalled();
    const paths = buildCampaignPages(content).map((page) => page.path);
    expect(paths).toContain("/use-cases/sample/");
    expect(paths.some((path) => path.includes("/category/"))).toBe(false);
  });

  it.each(Object.keys(ARTICLE_TOPICS) as ArticleTopic[])(
    "accepts the configured article topic %s",
    (topic) => {
      const content = parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({
            ...article,
            topic,
            category: "unknown-legacy-category",
          }),
        }),
      );
      expect(content.articles[0].topic).toBe(topic);
      expect(content.articles[0]).not.toHaveProperty("category");
    },
  );

  it.each([undefined, null, "", "clips", "unknown", [], 1])(
    "logs and skips an absent or invalid required article topic (%j)",
    (topic) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const content = parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, topic, category: "clips" }),
          "valid.md": markdown({ ...article, slug: "valid" }),
        }),
      );
      expect(content.articles.map((item) => item.slug)).toEqual(["valid"]);
      expect(error).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("sample.md: invalid content skipped (topic"),
      );
    },
  );

  it.each([
    undefined,
    [],
    ["clips"],
    ["design"],
    ["plans"],
    ["analytics"],
    ["slides"],
    ["content"],
    ["clips", "design", "plans", "analytics", "slides", "content"],
  ])(
    "accepts optional article apps without inventing defaults (%j)",
    (apps) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const content = parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, apps }),
        }),
      );
      expect(content.articles).toHaveLength(1);
      if (apps === undefined)
        expect(content.articles[0]).not.toHaveProperty("apps");
      else expect(content.articles[0].apps).toEqual(apps);
      expect(error).not.toHaveBeenCalled();
    },
  );

  it("accepts a standalone article without a use case or screenshot alt", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { use_case: _useCase, screenshot_alt: _alt, ...standalone } = article;
    const content = parseCampaignContent(
      sources(
        {},
        {
          "sample.md": markdown({
            ...standalone,
            topic: "agentic-apps",
            apps: [],
          }),
        },
      ),
    );
    expect(content.articles).toHaveLength(1);
    expect(content.articles[0]).toMatchObject({
      slug: article.slug,
      title: article.title,
      topic: "agentic-apps",
      apps: [],
      body: "\nPublic article body.",
    });
    expect(content.articles[0]).not.toHaveProperty("use_case");
    expect(content.articles[0]).not.toHaveProperty("screenshot_alt");
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "clips",
    {},
    ["unknown"],
    ["plan"],
    ["clips", "unknown"],
    [1],
    [null],
  ])("logs and skips invalid article apps (%j)", (apps) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, apps }),
        }),
      ).articles,
    ).toEqual([]);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("sample.md: invalid content skipped (apps"),
    );
  });

  it("summarizes only populated configured topics, in configuration order, without mutating input", () => {
    const topics = Object.keys(ARTICLE_TOPICS) as ArticleTopic[];
    const fixtures = [
      { topic: topics[1] },
      { topic: topics[0] },
      { topic: topics[1] },
    ];
    const original = structuredClone(fixtures);
    const summaries: ArticleTopicSummary[] = getArticleTopics(fixtures);
    expect(summaries).toEqual([
      { slug: topics[0], ...ARTICLE_TOPICS[topics[0]], count: 1 },
      { slug: topics[1], ...ARTICLE_TOPICS[topics[1]], count: 2 },
    ]);
    expect(getArticleTopics([])).toEqual([]);
    expect(fixtures).toEqual(original);
    for (const slug of topics) {
      expect(getArticleTopics([{ topic: slug }])).toEqual([
        { slug, ...ARTICLE_TOPICS[slug], count: 1 },
      ]);
      const content = parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, topic: slug }),
        }),
      );
      const paths = buildCampaignPages(content).map((page) => page.path);
      expect(paths).toContain(`/articles/topic/${slug}/`);
      expect(
        paths.filter((path) => path.startsWith("/articles/topic/")),
      ).toEqual([`/articles/topic/${slug}/`]);
    }
  });

  it("accepts null stories as absent and normalizes used_before strings to lists", () => {
    const absent = parseCampaignContent(
      sources({ "sample.yaml": yaml({ ...useCase, story: null }) }),
    ).useCases[0];
    expect(absent).toBeDefined();
    expect(absent.story).toBeUndefined();
    expect(JSON.parse(JSON.stringify(absent))).not.toHaveProperty("story");
    for (const used_before of ["Manual notes", ["Manual notes"]]) {
      const item = parseCampaignContent(
        sources({
          "sample.yaml": yaml({
            ...useCase,
            story: {
              quote: "Useful",
              name: "Writer",
              role: "Founder",
              used_before,
              internal: "PRIVATE-STORY",
            },
          }),
        }),
      ).useCases[0];
      expect(item.story?.used_before).toEqual(["Manual notes"]);
      expect(JSON.stringify(item)).not.toContain("PRIVATE");
    }
  });

  it("does not validate or project removed screenshot fields and preserves original public text", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const removed = {
      screenshot_url: { internal: "PRIVATE-SCREENSHOT" },
      screenshot_brief: null,
    };
    const content = parseCampaignContent(
      sources(
        { "sample.yaml": yaml({ ...useCase, ...removed, title: " Sample " }) },
        { "sample.md": markdown({ ...article, ...removed }) },
      ),
    );
    expect(content.useCases).toHaveLength(1);
    expect(content.articles).toHaveLength(1);
    for (const item of [...content.useCases, ...content.articles]) {
      expect(item).not.toHaveProperty("screenshot_url");
      expect(item).not.toHaveProperty("screenshot_brief");
      expect(item.screenshot_alt).toBe("Sample image");
    }
    expect(JSON.stringify(content)).not.toContain("PRIVATE-SCREENSHOT");
    expect(content.useCases[0].title).toBe(" Sample ");
    expect(content.articles[0].body).toBe("\nPublic article body.");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("validates all fifteen use cases and eleven articles through bundled and disk loaders without warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bundled = loadCampaignContent();
    const disk = loadCampaignContentFromDisk(
      new URL("..", import.meta.url).pathname,
    );
    expect(bundled.useCases).toHaveLength(15);
    expect(bundled.articles).toHaveLength(11);
    expect(
      bundled.articles.map(({ slug, topic, apps }) => ({ slug, topic, apps })),
    ).toEqual([
      {
        slug: "can-people-and-an-ai-agent-edit-the-same-document",
        topic: "agentic-apps",
        apps: [],
      },
      {
        slug: "how-do-you-add-skills-to-claude-code-and-codex",
        topic: "coding-agents",
        apps: ["plans"],
      },
      {
        slug: "what-is-an-agent-native-app",
        topic: "agentic-apps",
        apps: [],
      },
      {
        slug: "how-do-you-build-a-landing-page-with-ai",
        topic: "prototyping",
        apps: ["design"],
      },
      {
        slug: "how-to-write-a-bug-report",
        topic: "coding-agents",
        apps: ["clips"],
      },
      {
        slug: "what-goes-in-a-design-brief",
        topic: "prototyping",
        apps: ["design"],
      },
      {
        slug: "what-goes-in-a-technical-design-document",
        topic: "coding-agents",
        apps: ["plans"],
      },
      {
        slug: "what-should-a-saas-metrics-dashboard-include",
        topic: "metrics",
        apps: ["analytics"],
      },
      {
        slug: "what-should-a-startup-pitch-deck-include",
        topic: "presentations",
        apps: ["slides"],
      },
      {
        slug: "what-should-meeting-notes-include",
        topic: "meetings-and-notes",
        apps: ["clips"],
      },
      {
        slug: "what-should-you-look-for-in-dictation-software",
        topic: "meetings-and-notes",
        apps: ["clips"],
      },
    ]);
    for (const item of bundled.articles) {
      expect(item).not.toHaveProperty("category");
      if (item.topic === "agentic-apps") {
        expect(item).not.toHaveProperty("use_case");
        expect(item).not.toHaveProperty("screenshot_alt");
      }
    }
    expect(
      bundled.articles.find(
        (item) =>
          item.slug === "how-do-you-add-skills-to-claude-code-and-codex",
      )?.use_case,
    ).toBe("see-what-your-coding-agent-plans");
    expect(
      getArticleTopics(bundled.articles).map(({ count }) => count),
    ).toEqual([2, 3, 2, 2, 1, 1]);
    expect(
      bundled.useCases.map((item) => [
        item.slug,
        item.todays_stack?.heading,
        item.todays_stack?.items.length,
      ]),
    ).toEqual([
      ["ai-meeting-notes", "Four places one meeting ends up", 4],
      [
        "ask-your-database-in-plain-english",
        "Where data questions go today",
        3,
      ],
      ["bug-reports-with-console-logs", "Four tools for one bug", 4],
      ["crm-and-call-questions", "Four tools for one pipeline review", 4],
      [
        "design-brief-to-prototype",
        "From brief to something clickable, today",
        3,
      ],
      ["dictate-instead-of-typing", "Where your words go today", 3],
      ["find-where-users-drop-off", "Three tools for one drop-off question", 3],
      ["landing-page-prototypes", "How a launch page usually gets made", 3],
      [
        "see-what-your-coding-agent-plans",
        "Where an agent's plan lives today",
        3,
      ],
      ["spec-your-coding-agent-builds-from", "Where a spec lives today", 3],
      ["startup-kpi-dashboard", "Four tools for one set of numbers", 4],
      ["startup-pitch-deck", "What goes into a pitch deck today", 4],
      [
        "understand-what-your-coding-agent-changed",
        "How a change gets reviewed today",
        3,
      ],
      ["weekly-marketing-report", "Four tools for one weekly report", 4],
      ["wireframe-before-agent-builds", "How a screen gets described today", 3],
    ]);
    const slugs = bundled.useCases.map((item) => item.slug);
    expect(slugs).toEqual(Object.keys(replacementItems));
    expect(
      bundled.useCases.find((item) => item.slug === "ai-meeting-notes")
        ?.next_jobs,
    ).toEqual(["crm-and-call-questions", "dictate-instead-of-typing"]);
    for (const item of bundled.useCases) {
      expect(item.todays_stack?.items, item.slug).toEqual(
        replacementItems[item.slug].map((text) => ({ text })),
      );
      expect(item.todays_stack?.in_app, item.slug).toBe(
        replacementConclusions[item.slug],
      );
      expect(item.recipes, item.slug).toHaveLength(3);
      expect(
        new Set(item.recipes!.map((recipe) => recipe.id)).size,
        item.slug,
      ).toBe(3);
      expect(item.next_jobs?.length, item.slug).toBeGreaterThan(0);
      for (const next of item.next_jobs!) {
        expect(slugs, `${item.slug} → ${next}`).toContain(next);
        expect(next).not.toBe(item.slug);
      }
    }
    expect(
      bundled.useCases.find(
        (item) => item.slug === "spec-your-coding-agent-builds-from",
      )?.app,
    ).toBe("content");
    expect(bundled).toEqual(disk);
    expect(warn).not.toHaveBeenCalled();
    for (const item of [...bundled.useCases, ...bundled.articles]) {
      expect(item).not.toHaveProperty("screenshot_url");
      expect(item).not.toHaveProperty("screenshot_brief");
    }
    expect(error).not.toHaveBeenCalled();
    const serialized = JSON.stringify(bundled);
    expect(serialized).not.toMatch(/"internal":/);
    for (const item of [...bundled.useCases, ...bundled.articles]) {
      expect(item).not.toHaveProperty("audience");
    }
    expect(bundled.useCases.every((item) => item.story === undefined)).toBe(
      true,
    );
  });

  it("normalizes YAML dates and rejects impossible dates", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    // A block YAML scalar exercises gray-matter's Date parser rather than JSON strings.
    const dated = `slug: sample\nupdated: 2026-09-01\n${Object.entries(useCase)
      .filter(([key]) => !["slug", "updated"].includes(key))
      .map(([key, value]) => `${key}: ${yaml(value)}`)
      .join("\n")}`;
    expect(
      parseCampaignContent(sources({ "sample.yaml": dated })).useCases[0]
        .updated,
    ).toBe("2026-09-01");
    expect(
      parseCampaignContent(
        sources({ "sample.yaml": yaml({ ...useCase, updated: "2026-02-30" }) }),
      ).useCases,
    ).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("invalid content skipped"),
    );
  });

  it("skips invalid files, filename mismatches, unsafe URLs and mismatched jobs explicitly", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      parseCampaignContent(sources({ "wrong.yaml": yaml(useCase) })).useCases,
    ).toEqual([]);
    expect(
      parseCampaignContent(sources({ "sample.yaml": "[broken" })).useCases,
    ).toEqual([]);
    expect(
      parseCampaignContent(
        sources({
          "sample.yaml": yaml({ ...useCase, app_cta_url: "javascript:evil()" }),
        }),
      ).useCases,
    ).toEqual([]);
    expect(
      parseCampaignContent(
        sources(undefined, {
          "sample.md": markdown({ ...article, job_id: "wrong" }),
        }),
      ).articles,
    ).toEqual([]);
    expect(error).toHaveBeenCalledTimes(4);
  });

  it("allows an absent matching use case and valid content without screenshot warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const content = parseCampaignContent(
      sources({}, { "sample.md": markdown(article) }),
    );
    expect(content.articles).toHaveLength(1);
    const complete = parseCampaignContent(sources());
    expect(complete.useCases).toHaveLength(1);
    expect(complete.articles).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("throws on unreadable/missing source directories rather than reporting empty content", () => {
    expect(() =>
      loadCampaignContentFromDisk("/missing-campaign-content"),
    ).toThrow("Unable to enumerate/read");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "campaign-content-"));
    try {
      fs.mkdirSync(path.join(root, "content", "use-cases"), {
        recursive: true,
      });
      fs.mkdirSync(path.join(root, "content", "articles"));
      expect(loadCampaignContentFromDisk(root)).toEqual({
        useCases: [],
        articles: [],
      });
      fs.writeFileSync(
        path.join(root, "content", "use-cases", "sample.yaml"),
        yaml(useCase),
      );
      expect(loadCampaignContentFromDisk(root).useCases).toHaveLength(1);
      const read = vi.spyOn(fs, "readFileSync").mockImplementation(() => {
        throw new Error("Unreadable");
      });
      expect(() => loadCampaignContentFromDisk(root)).toThrow(
        "Unable to enumerate/read",
      );
      read.mockRestore();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes only populated topics, index pagination at twelve, supplied dates and safe article mirrors", () => {
    const content = parseCampaignContent(sources());
    content.articles = Array.from({ length: 13 }, (_, index) => ({
      ...content.articles[0],
      slug: `article-${index}`,
    }));
    const pages = buildCampaignPages(content);
    expect(pages.map((page) => page.path)).toEqual(
      expect.arrayContaining([
        "/use-cases/",
        "/use-cases/sample/",
        "/articles/",
        "/articles/page/2/",
        "/articles/topic/coding-agents/",
      ]),
    );
    expect(
      pages.find((page) => page.path === "/use-cases/sample/")?.lastmod,
    ).toEqual(new Date("2026-09-01T00:00:00Z"));
    expect(
      pages.find((page) => page.path === "/articles/article-0/")?.markdownPath,
    ).toBe("/articles/article-0.md");
    expect(
      pages.find((page) => page.path === "/articles/page/2/")?.markdown,
    ).toContain("article-12");
    expect(pages.map((page) => page.path)).not.toContain("/articles/page/1/");
    expect(pages.some((page) => page.path.includes("/category/"))).toBe(false);
    expect(pages.some((page) => /\/topic\/[^/]+\/page\//.test(page.path))).toBe(
      false,
    );
    expect(pages.some((page) => page.path.includes("/topic/metrics/"))).toBe(
      false,
    );
    const topic = pages.find(
      (page) => page.path === "/articles/topic/coding-agents/",
    )!;
    expect(topic.markdown?.match(/^- \[/gm)).toHaveLength(13);
    expect(topic.markdown).toContain("article-12");
  });
});

describe("campaign CTA and SEO", () => {
  it("preserves duplicate incoming tracking values, destination state and hash, and sets the job", () => {
    const url = new URL(
      buildCampaignCtaUrl(
        "https://example.com/?existing=1&utm_source=old&job=old#open",
        "new-job",
        "?utm_source=a&utm_source=b&utm_content=custom&gclid=1&gclid=2&msclkid=m&fbclid=f&angle=engineering&ignored=no&job=attacker",
      ),
    );
    expect(url.searchParams.getAll("utm_source")).toEqual(["a", "b"]);
    expect(url.searchParams.getAll("gclid")).toEqual(["1", "2"]);
    expect(url.searchParams.get("utm_content")).toBe("custom");
    expect(url.searchParams.get("msclkid")).toBe("m");
    expect(url.searchParams.get("fbclid")).toBe("f");
    expect(url.searchParams.get("job")).toBe("new-job");
    expect(url.searchParams.get("angle")).toBe("engineering");
    expect(url.searchParams.get("existing")).toBe("1");
    expect(url.searchParams.has("ignored")).toBe(false);
    expect(url.hash).toBe("#open");
  });

  it("overrides destination utm_content unless the visitor supplies it, preserving empty and duplicate values", () => {
    expect(
      new URL(
        buildCampaignCtaUrl("https://example.com/", "job", ""),
      ).searchParams.get("utm_content"),
    ).toBe("job");
    expect(
      new URL(
        buildCampaignCtaUrl("https://example.com/?utm_content=dest", "job", ""),
      ).searchParams.get("utm_content"),
    ).toBe("job");
    expect(
      new URL(
        buildCampaignCtaUrl(
          "https://example.com/",
          "job",
          "?utm_content=&utm_content=second",
        ),
      ).searchParams.getAll("utm_content"),
    ).toEqual(["", "second"]);
    expect(() => buildCampaignCtaUrl("javascript:evil()", "job", "")).toThrow();
  });

  it("uses www canonical origin and the existing title-aware OG endpoint", () => {
    const meta = campaignMeta(
      "Sample",
      "Description",
      "/articles/sample/",
      "article",
    );
    expect(meta).toContainEqual({ title: "Sample | Agent-Native" });
    expect(meta).toContainEqual({ property: "og:title", content: "Sample" });
    expect(meta).toContainEqual({
      property: "og:description",
      content: "Description",
    });
    expect(meta).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://www.agent-native.com/articles/sample/",
    });
    expect(meta).toContainEqual({ property: "og:type", content: "article" });
    expect(meta).toContainEqual({
      name: "robots",
      content: "index, max-image-preview:large",
    });
    expect(meta).toContainEqual({ name: "twitter:title", content: "Sample" });
    const image = meta.find(
      (item) => "property" in item && item.property === "og:image",
    );
    expect(
      image && "content" in image
        ? new URL(image.content as string).searchParams.get("title")
        : undefined,
    ).toBe("Sample");
    expect(() =>
      campaignMeta("Title", "Description", "//evil.example"),
    ).toThrow();
  });
});
