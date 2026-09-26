import { test, expect, type Page } from "@playwright/test";

import { PLAN_EDITIONS } from "../shared/labs";

/*
 * EDITION READER (authed).
 *
 * The engineering-newspaper reader at /editions/:id and the archive at
 * /editions. Every assertion here is a statement of correct behavior.
 *
 * The load-bearing one is the diff-stat check: a recap whose diff stats could
 * not be resolved must render as unavailable, never as `+0 -0 / 0 files`. A
 * reader who sees zeros next to a real change concludes nothing happened, which
 * is the exact failure this whole surface exists to prevent.
 */

const REPO = "BuilderIO/agent-native";
/**
 * A day no seeded fixture uses. `create-edition` replaces the edition for a
 * given owner + window day key, so sharing a day with a hand-seeded edition
 * means running this spec silently overwrites it.
 */
const WINDOW = {
  // Aligned to UTC midnights so the day key is a single day, not a range.
  windowStart: "2026-02-03T00:00:00.000Z",
  windowEnd: "2026-02-04T00:00:00.000Z",
  timezone: "UTC",
};

/** Editions ships behind a lab, so every action here 404s until it is on. */
test.beforeEach(async ({ page }) => {
  const res = await page.request.post("/_agent-native/actions/set-lab", {
    data: { key: PLAN_EDITIONS.key, enabled: true },
  });
  expect(res.ok(), `set-lab: ${res.status()}`).toBe(true);
});

function tag(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

async function seedRecap(
  page: Page,
  prNumber: number,
  title: string,
): Promise<string> {
  const res = await page.request.post(
    "/_agent-native/actions/create-visual-recap",
    {
      data: {
        title,
        brief: `Recap brief for PR ${prNumber}.`,
        visibility: "private",
        sourceUrl: `https://github.com/${REPO}/pull/${prNumber}`,
        sourceType: "pull-request",
        sourceRepo: REPO,
        sourcePrNumber: prNumber,
        sourcePrState: "merged",
        sourcePrMergedAt: "2026-02-03T09:00:00.000Z",
        sourceAuthorLogin: "steve8708",
        idempotencyKey: `e2e-edition-${prNumber}-${tag()}`,
        mdx: {
          "plan.mdx": `---\ntitle: ${title}\nbrief: Recap brief for PR ${prNumber}.\n---\n\n# ${title}\n\nBody.\n\n\`\`\`ts\nexport const shipped = true;\n\`\`\`\n`,
        },
      },
    },
  );
  expect(res.ok(), `seed recap ${prNumber}: ${res.status()}`).toBe(true);
  const body = (await res.json()) as { plan?: { id?: string } };
  const id = body.plan?.id;
  expect(id, "seeded recap id").toBeTruthy();
  return id as string;
}

/**
 * A block id to cite as a story's lead art. Prefers a non-prose block, because
 * the whole point of citing one is that the edition shows the recap's visual.
 */
async function citableBlockId(page: Page, recapId: string): Promise<string> {
  const res = await page.request.get(
    `/_agent-native/actions/get-visual-plan?id=${encodeURIComponent(recapId)}`,
  );
  expect(res.ok(), `get-visual-plan ${recapId}: ${res.status()}`).toBe(true);
  const body = (await res.json()) as {
    plan?: { content?: { blocks?: { id: string; type: string }[] } };
  };
  const blocks = body.plan?.content?.blocks ?? [];
  const block = blocks.find((b) => b.type !== "rich-text") ?? blocks[0];
  expect(block?.id, `a citable block in ${recapId}`).toBeTruthy();
  return (block as { id: string }).id;
}

test("an edition reads as a newspaper and links back to its recaps", async ({
  page,
}) => {
  const suffix = tag();
  const leadHeadline = `Grouped drops survive grids ${suffix}`;
  const statlessHeadline = `Stats unavailable story ${suffix}`;
  const cohortName = `Grouped transactions ${suffix}`;
  const cohortSentence = `One pending Apply unit spans the selection ${suffix}.`;
  const missingPrNumber = 5485;

  const richRecapId = await seedRecap(page, 5447, `Rich recap ${suffix}`);
  const statlessRecapId = await seedRecap(
    page,
    5450,
    `Statless recap ${suffix}`,
  );
  const leadBlockId = await citableBlockId(page, richRecapId);

  const created = await page.request.post(
    "/_agent-native/actions/create-edition",
    {
      data: {
        ...WINDOW,
        series: "e2e-reader",
        title: `agent-native/daily ${suffix}`,
        brief: `Design hardens its canvas ${suffix}.`,
        visibility: "private",
        stories: [
          {
            storyId: "design-transactions",
            headline: leadHeadline,
            dek: "Multi-selection travels as one pending Apply unit.",
            tags: ["design-transactions"],
            lead: true,
            recaps: [
              {
                recapId: richRecapId,
                repo: REPO,
                prNumber: 5447,
                prUrl: `https://github.com/${REPO}/pull/5447`,
                authorLogin: "steve8708",
                filesChanged: 28,
                additions: 3052,
                deletions: 277,
                blockIds: [leadBlockId],
              },
            ],
            cohorts: [
              {
                name: cohortName,
                sentence: cohortSentence,
                prNumbers: [5447, 5451, 5452],
                repos: [REPO],
                additions: 3052,
                deletions: 277,
              },
            ],
            whatShipped: "A shared transactionId now spans the group.",
            why: "A partial group previously mutated the canvas alone.",
          },
          {
            storyId: "stats-unavailable",
            headline: statlessHeadline,
            dek: "This story's diff stats could not be resolved.",
            tags: ["editor-reliability"],
            lead: false,
            recaps: [
              {
                recapId: statlessRecapId,
                repo: REPO,
                prNumber: 5450,
                prUrl: `https://github.com/${REPO}/pull/5450`,
                filesChanged: null,
                additions: null,
                deletions: null,
              },
            ],
            cohorts: [
              {
                name: `Unresolved stats ${suffix}`,
                sentence: `Diff stats could not be resolved ${suffix}.`,
                prNumbers: [5450],
                repos: [REPO],
                additions: null,
                deletions: null,
              },
            ],
          },
        ],
        coverage: {
          mergedPrCount: 3,
          recapCount: 2,
          missingPrs: [
            {
              repo: REPO,
              prNumber: missingPrNumber,
              title: "fix(dispatch): isolate All-apps workspace resources",
              url: `https://github.com/${REPO}/pull/${missingPrNumber}`,
            },
          ],
          reposCovered: [REPO],
        },
      },
    },
  );
  expect(created.ok(), `create-edition: ${created.status()}`).toBe(true);
  const { editionId } = (await created.json()) as { editionId: string };

  await page.goto(`/editions/${editionId}`, { waitUntil: "domcontentloaded" });

  // The lead story and the "also in this edition" entry both render. Matched as
  // headings, because each headline also appears as a rail index link.
  await expect(page.getByRole("heading", { name: leadHeadline })).toBeVisible();
  // A non-lead story is a secondary grid cell when it has something to say and
  // a quick-link row when it does not, so this asserts the anchor, not the tag.
  const tailStory = page.locator("#edition-story-stats-unavailable");
  await expect(tailStory).toBeVisible();
  await expect(tailStory).toContainText(statlessHeadline);

  // A cohort row carries the group, not one row per pull request.
  await expect(page.getByText(cohortName)).toBeVisible();
  await expect(page.getByText(cohortSentence)).toBeVisible();

  // Every rail index entry points at a story that is actually on the page.
  const indexLinks = page
    .getByRole("navigation", { name: /in this build/i })
    .getByRole("link");
  const anchors = await indexLinks.evaluateAll((links) =>
    links.map((link) => (link as HTMLAnchorElement).hash),
  );
  expect(anchors.length).toBe(2);
  for (const anchor of anchors) {
    // A lead story is an <article>; a tail story is a quick-link row.
    await expect(page.locator(anchor)).toBeVisible();
  }

  // The block the lead story cites is reprinted as its lead art, above the
  // fold — an edition that kept only the prose is the failure this covers.
  await expect(
    page.locator(`[data-edition-block="${leadBlockId}"]`),
  ).toBeVisible();

  // Every story links back to the recap it was written from.
  await expect(
    page.locator(`a[href$="/recaps/${richRecapId}"]`).first(),
  ).toBeVisible();

  // The coverage note names the merged PR that shipped without a recap,
  // instead of implying the recaps were the whole window.
  await expect(page.getByText(String(missingPrNumber)).first()).toBeVisible();

  // An unresolved diff stat must never be rendered as a zero.
  const readerText = (await page.locator("body").innerText()).replace(
    /\s+/g,
    " ",
  );
  expect(readerText).not.toMatch(/\+\s*0\b/);
  expect(readerText).not.toMatch(/[-−]\s*0\b/);
  expect(readerText).not.toMatch(/\b0 files?\b/);

  // Per-PR attribution is restored: an engineer reading their own org's daily
  // wants the author, the size, and the pull request, not just a title.
  expect(readerText).toMatch(/@steve8708/);
  expect(readerText).toMatch(/#5447/);

  // An issue keeps the app sidebar. It is a page a reader moves around in, not
  // the immersive full-screen plan reader, which hides all app navigation.
  await expect(
    page.locator('.agent-layout-left-drawer a[href="/editions"]').first(),
  ).toBeVisible();

  // The way back lives in the app header, not only in the sidebar, and it
  // lands on the archive — which lists the issue.
  await page
    .getByRole("banner")
    .getByRole("link", { name: /^Editions$/ })
    .click();
  await expect(page).toHaveURL(/\/editions$/);
  const archiveLink = page.locator(`a[href$="/editions/${editionId}"]`).first();
  await expect(archiveLink).toBeVisible();
});

/**
 * A short valid WAV of silence. The neural path is exercised by stubbing the
 * framework's `/speak` route rather than the provider, so the test proves the
 * client half — playlist, playback, controls — without a credential or a spend.
 */
function silentWav(seconds = 0.4): Buffer {
  const rate = 8000;
  const samples = Math.floor(rate * seconds);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 128)]);
}

/**
 * `create-edition` replaces the edition for a given owner, series and window
 * day, so each test seeds its own series. Sharing one means two tests running
 * in parallel overwrite each other's fixture.
 */
async function seedListenableEdition(
  page: Page,
  prNumber: number,
  series: string,
) {
  const suffix = tag();
  const recapId = await seedRecap(page, prNumber, `Listen recap ${suffix}`);
  const created = await page.request.post(
    "/_agent-native/actions/create-edition",
    {
      data: {
        ...WINDOW,
        series,
        title: `agent-native/daily ${suffix}`,
        brief: "Something worth hearing.",
        visibility: "private",
        stories: [
          {
            storyId: "listenable",
            headline: `Cross-screen saves recover ${suffix}`,
            dek: "A failed save replays against the live document.",
            tags: ["design-runtime"],
            lead: true,
            recaps: [
              {
                recapId,
                repo: REPO,
                prNumber,
                prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
              },
            ],
            cohorts: [],
            whatShipped: "The outbox serialises both writes.",
          },
        ],
      },
    },
  );
  expect(created.ok(), `create-edition: ${created.status()}`).toBe(true);
  const { editionId } = (await created.json()) as { editionId: string };
  return editionId;
}

test("the edition is read aloud by the neural voice when one is configured", async ({
  page,
}) => {
  const requests: { voice?: string; instructions?: string; text?: string }[] =
    [];
  await page.route("**/_agent-native/speak", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      body: silentWav(),
    });
  });

  const editionId = await seedListenableEdition(page, 7102, "e2e-neural");
  await page.goto(`/editions/${editionId}`, { waitUntil: "domcontentloaded" });

  const listen = page.getByRole("button", { name: /^Listen$/ });
  await expect(listen).toBeVisible({ timeout: 30_000 });
  await listen.click();
  await expect(page.getByRole("button", { name: /^Pause$/ })).toBeVisible();

  // The synthesised clip is what is playing — not the browser voice this
  // replaced. A fallback that fires while a provider is configured would hide
  // a broken credential behind a worse voice.
  expect(
    await page.evaluate(
      () => window.speechSynthesis.speaking || window.speechSynthesis.pending,
    ),
  ).toBe(false);

  // The script is the editorial layer, steered to read as a bulletin.
  expect(requests.length).toBeGreaterThan(0);
  expect(requests[0].voice).toBe("sage");
  expect(requests[0].instructions).toContain("newsroom anchor");
  expect(requests[0].text).toContain("Cross-screen saves recover");
  // Never the diffs and file lists the page also shows.
  expect(requests[0].text).not.toMatch(/\+\d|#7102/);

  // The browser-voice menu belongs to the fallback engine only.
  await expect(page.getByRole("button", { name: /^Voice$/ })).not.toBeVisible();

  // Playback outlives React, so leaving the page must silence it.
  await page.goto("/editions", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /^Pause$/ })).toHaveCount(0);
});

test("the edition falls back to the browser voice when no provider is configured", async ({
  page,
}) => {
  await page.route("**/_agent-native/speak", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        error: "No speech provider configured.",
        reason: "no-provider",
      }),
    }),
  );

  const editionId = await seedListenableEdition(page, 7103, "e2e-fallback");
  await page.goto(`/editions/${editionId}`, { waitUntil: "domcontentloaded" });

  const listen = page.getByRole("button", { name: /^Listen$/ });
  await expect(listen).toBeVisible({ timeout: 30_000 });
  await listen.click();

  // The engine is actually given something to say, and the control inverts.
  await expect(page.getByRole("button", { name: /^Pause$/ })).toBeVisible();
  expect(
    await page.evaluate(
      () => window.speechSynthesis.speaking || window.speechSynthesis.pending,
    ),
  ).toBe(true);

  // Speech outlives React, so leaving the page must silence it.
  await page.goto("/editions", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() =>
      page.evaluate(
        () => window.speechSynthesis.speaking || window.speechSynthesis.pending,
      ),
    )
    .toBe(false);
});
