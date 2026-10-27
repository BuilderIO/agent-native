import type { WorkflowGraph } from "../contract.js";
import { STORY_GRAPHS, type StoryKey } from "../story-graphs.fixture.js";
import {
  storyFixturesSchema,
  storyScriptSchema,
  type StoryFixtures,
  type StoryScriptData,
} from "../testing/story-data.js";
import expect01 from "./01-bug-report-to-builder/expect.json";
import ai01 from "./01-bug-report-to-builder/fixtures/ai.json";
import inbox01 from "./01-bug-report-to-builder/fixtures/inbox.json";
import provider01 from "./01-bug-report-to-builder/fixtures/provider.json";
import script01 from "./01-bug-report-to-builder/script.json";
import expect02 from "./02-builder-to-merge/expect.json";
import ai02 from "./02-builder-to-merge/fixtures/ai.json";
import inbox02 from "./02-builder-to-merge/fixtures/inbox.json";
import provider02 from "./02-builder-to-merge/fixtures/provider.json";
import script02 from "./02-builder-to-merge/script.json";
import expect03 from "./03-morning-digest/expect.json";
import ai03 from "./03-morning-digest/fixtures/ai.json";
import inbox03 from "./03-morning-digest/fixtures/inbox.json";
import provider03 from "./03-morning-digest/fixtures/provider.json";
import script03 from "./03-morning-digest/script.json";
import expect04 from "./04-hot-lead-routing/expect.json";
import ai04 from "./04-hot-lead-routing/fixtures/ai.json";
import inbox04 from "./04-hot-lead-routing/fixtures/inbox.json";
import provider04 from "./04-hot-lead-routing/fixtures/provider.json";
import script04 from "./04-hot-lead-routing/script.json";
import expect05 from "./05-after-every-customer-call/expect.json";
import ai05 from "./05-after-every-customer-call/fixtures/ai.json";
import inbox05 from "./05-after-every-customer-call/fixtures/inbox.json";
import provider05 from "./05-after-every-customer-call/fixtures/provider.json";
import script05 from "./05-after-every-customer-call/script.json";
import expect06 from "./06-support-ticket-routing/expect.json";
import ai06 from "./06-support-ticket-routing/fixtures/ai.json";
import inbox06 from "./06-support-ticket-routing/fixtures/inbox.json";
import provider06 from "./06-support-ticket-routing/fixtures/provider.json";
import script06 from "./06-support-ticket-routing/script.json";
import expect07 from "./07-incident-to-postmortem/expect.json";
import ai07 from "./07-incident-to-postmortem/fixtures/ai.json";
import inbox07 from "./07-incident-to-postmortem/fixtures/inbox.json";
import provider07 from "./07-incident-to-postmortem/fixtures/provider.json";
import script07 from "./07-incident-to-postmortem/script.json";
import expect08 from "./08-security-alert-to-safe-fix/expect.json";
import ai08 from "./08-security-alert-to-safe-fix/fixtures/ai.json";
import inbox08 from "./08-security-alert-to-safe-fix/fixtures/inbox.json";
import provider08 from "./08-security-alert-to-safe-fix/fixtures/provider.json";
import script08 from "./08-security-alert-to-safe-fix/script.json";
import expect09 from "./09-activation-nudge/expect.json";
import ai09 from "./09-activation-nudge/fixtures/ai.json";
import inbox09 from "./09-activation-nudge/fixtures/inbox.json";
import provider09 from "./09-activation-nudge/fixtures/provider.json";
import script09 from "./09-activation-nudge/script.json";
import expect10 from "./10-cloud-cost-spike/expect.json";
import ai10 from "./10-cloud-cost-spike/fixtures/ai.json";
import inbox10 from "./10-cloud-cost-spike/fixtures/inbox.json";
import provider10 from "./10-cloud-cost-spike/fixtures/provider.json";
import script10 from "./10-cloud-cost-spike/script.json";

export interface StoryBundle {
  key: StoryKey;
  /** `01-bug-report-to-builder`: the story's folder under `stories/`. */
  folder: string;
  graph: WorkflowGraph;
  script: StoryScriptData;
  fixtures: StoryFixtures;
  /** What each scenario must come to, by scenario name. Regenerate with `pnpm stories:update` and read the diff. */
  expect: Record<string, unknown>;
}

function bundle(
  key: StoryKey,
  folder: string,
  files: {
    script: unknown;
    provider: unknown;
    ai: unknown;
    inbox: unknown;
    expect: unknown;
  },
): StoryBundle {
  return {
    key,
    folder,
    graph: STORY_GRAPHS[key],
    script: storyScriptSchema.parse(files.script),
    fixtures: storyFixturesSchema.parse({
      provider: files.provider,
      ai: files.ai,
      inbox: files.inbox,
    }),
    expect: files.expect as Record<string, unknown>,
  };
}

/** The ten stories in order, each with its script, recorded fixtures and expected outcome, validated on load. */
export const STORIES: Record<StoryKey, StoryBundle> = {
  "bug-report-to-builder": bundle(
    "bug-report-to-builder",
    "01-bug-report-to-builder",
    {
      script: script01,
      provider: provider01,
      ai: ai01,
      inbox: inbox01,
      expect: expect01,
    },
  ),
  "builder-to-merge": bundle("builder-to-merge", "02-builder-to-merge", {
    script: script02,
    provider: provider02,
    ai: ai02,
    inbox: inbox02,
    expect: expect02,
  }),
  "morning-digest": bundle("morning-digest", "03-morning-digest", {
    script: script03,
    provider: provider03,
    ai: ai03,
    inbox: inbox03,
    expect: expect03,
  }),
  "hot-lead-routing": bundle("hot-lead-routing", "04-hot-lead-routing", {
    script: script04,
    provider: provider04,
    ai: ai04,
    inbox: inbox04,
    expect: expect04,
  }),
  "after-every-customer-call": bundle(
    "after-every-customer-call",
    "05-after-every-customer-call",
    {
      script: script05,
      provider: provider05,
      ai: ai05,
      inbox: inbox05,
      expect: expect05,
    },
  ),
  "support-ticket-routing": bundle(
    "support-ticket-routing",
    "06-support-ticket-routing",
    {
      script: script06,
      provider: provider06,
      ai: ai06,
      inbox: inbox06,
      expect: expect06,
    },
  ),
  "incident-to-postmortem": bundle(
    "incident-to-postmortem",
    "07-incident-to-postmortem",
    {
      script: script07,
      provider: provider07,
      ai: ai07,
      inbox: inbox07,
      expect: expect07,
    },
  ),
  "security-alert-to-safe-fix": bundle(
    "security-alert-to-safe-fix",
    "08-security-alert-to-safe-fix",
    {
      script: script08,
      provider: provider08,
      ai: ai08,
      inbox: inbox08,
      expect: expect08,
    },
  ),
  "activation-nudge": bundle("activation-nudge", "09-activation-nudge", {
    script: script09,
    provider: provider09,
    ai: ai09,
    inbox: inbox09,
    expect: expect09,
  }),
  "cloud-cost-spike": bundle("cloud-cost-spike", "10-cloud-cost-spike", {
    script: script10,
    provider: provider10,
    ai: ai10,
    inbox: inbox10,
    expect: expect10,
  }),
};
