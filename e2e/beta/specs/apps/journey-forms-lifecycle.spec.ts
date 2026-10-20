import { expect, test } from "@playwright/test";

import {
  assertSignedInOnBeta,
  signedInContext,
  skipUnlessAuthed,
} from "../../lib/authed";
import { originFor, selectedSites, siteById } from "../../lib/fleet";
import {
  callAction,
  describeCall,
  expectJsonOk,
  journeyToken,
  withCleanup,
} from "../../lib/journey-browser";
import {
  BETA_E2E_TEST_TRAFFIC_HEADERS,
  installBetaE2ETrafficMarker,
} from "../../lib/test-traffic";

/**
 * Forms lifecycle: create, publish, answer as a stranger, read the answer.
 *
 * Forms had one beta check, that the list does not show a signed-out prompt.
 * The product is the round trip: an owner builds a form, publishes it, a
 * member of the public fills it in with no account, and the owner sees the
 * response. Public submission is anonymous by design, so a regression there
 * (a 5xx, a rejected honeypot or timing check, a published form that 404s)
 * is invisible to every signed-in check.
 *
 * Creates one run-marked form and purges it, with its response, in `finally`.
 * A Turnstile captcha, if the host enables one, ends the journey as a skip:
 * it is not something this suite may complete.
 */

skipUnlessAuthed();

const site = siteById("forms");
const origin = originFor(site);
const FIELD_ID = "e2e_note";

test("[journey] [forms] forms: create, publish, submit as an anonymous visitor, and see the response", async ({
  browser,
}) => {
  test.skip(
    !selectedSites().some((entry) => entry.id === site.id),
    "forms is not in this run's selection",
  );
  test.setTimeout(300_000);

  const token = journeyToken("forms");
  const answer = `${token} answer`;
  const ownerContext = await signedInContext(browser, site, {
    seedModel: false,
  });
  const anonymousContext = await browser.newContext({
    extraHTTPHeaders: BETA_E2E_TEST_TRAFFIC_HEADERS,
  });
  await installBetaE2ETrafficMarker(anonymousContext);
  const owner = await ownerContext.newPage();
  let formId: string | null = null;

  try {
    await withCleanup(
      async () => {
        await assertSignedInOnBeta(ownerContext, site);

        const created = expectJsonOk<{
          id?: string;
          slug?: string;
          publicUrl?: string;
        }>(
          await callAction(owner.request, origin, "create-form", {
            method: "POST",
            data: {
              title: `${token} form`,
              status: "draft",
              fields: [
                {
                  id: FIELD_ID,
                  type: "text",
                  label: "Note",
                  required: true,
                },
              ],
            },
          }),
          `${site.host} create-form`,
        );
        if (!created.id || !created.slug) {
          throw new Error(
            `${site.host} create-form returned no id or slug: ${JSON.stringify(created).slice(0, 300)}`,
          );
        }
        formId = created.id;

        const publishCall = await callAction(
          owner.request,
          origin,
          "update-form",
          { method: "POST", data: { id: formId, status: "published" } },
        );
        const published = expectJsonOk<{ status?: string }>(
          publishCall,
          `${site.host} update-form status=published for ${formId}`,
        );
        expect(
          published.status,
          `${site.host} update-form did not publish ${formId}: ${describeCall(publishCall)}`,
        ).toBe("published");

        // The slug is the contract; the host in a returned publicUrl may be
        // the production host, and this journey stays on beta.
        const publicUrl = `${origin}/f/${encodeURIComponent(created.slug)}`;
        test.info().annotations.push({
          type: "forms-urls",
          description: `form=${formId} public=${publicUrl} returnedPublicUrl=${created.publicUrl ?? "(none)"}`,
        });

        const visitor = await anonymousContext.newPage();
        const opened = await visitor.goto(publicUrl, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        expect(
          opened?.status(),
          `anonymous GET ${publicUrl} for the published form ${formId}`,
        ).toBe(200);
        await expect(
          visitor.locator("#mainForm"),
          `${publicUrl} rendered no form for an anonymous visitor (title ${JSON.stringify(await visitor.title())})`,
        ).toBeVisible({ timeout: 60_000 });
        test.skip(
          (await visitor.locator("#turnstile").count()) > 0,
          "this host enables a Turnstile captcha on public forms, which the suite must not complete",
        );

        await visitor.locator(`input[name="${FIELD_ID}"]`).fill(answer);
        // The server rejects a submission under 500 ms after page load.
        await visitor.waitForTimeout(700);
        const submission = visitor.waitForResponse(
          (response) =>
            response.url().includes("/api/submit/") &&
            response.request().method() === "POST",
          { timeout: 60_000 },
        );
        await visitor.locator("#submitBtn").click();
        const submitted = await submission;
        const submittedBody = await submitted.text();
        expect(
          submitted.status(),
          `anonymous submit to ${submitted.url()} answered HTTP ${submitted.status()}: ${submittedBody.slice(0, 300)}`,
        ).toBe(200);
        await expect(
          visitor.locator("#successView"),
          `${publicUrl} did not show its success view after a 200 submit (${submittedBody.slice(0, 200)})`,
        ).toBeVisible({ timeout: 30_000 });

        // The owner sees it: through the action the agent uses, then the page.
        await expect
          .poll(
            async () => {
              const call = await callAction(
                owner.request,
                origin,
                "list-responses",
                { params: { formId: formId as string } },
              );
              const body = expectJsonOk<{
                responses?: { data?: Record<string, unknown> }[];
              }>(call, `${site.host} list-responses for ${formId}`);
              return (body.responses ?? []).some(
                (response) => response.data?.[FIELD_ID] === answer,
              );
            },
            {
              message: `${site.host} list-responses for ${formId} never returned the anonymous answer ${JSON.stringify(answer)} that the public form accepted with HTTP 200`,
              timeout: 45_000,
            },
          )
          .toBe(true);

        await owner.goto(`${origin}/forms/${formId}/responses`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await expect(
          owner.getByText(answer),
          `${site.host} /forms/${formId}/responses did not show the submitted answer (at ${owner.url()})`,
        ).toBeVisible({ timeout: 60_000 });
      },
      async () => {
        if (!formId) return [];
        const failures: string[] = [];
        const purge = await callAction(owner.request, origin, "delete-form", {
          method: "POST",
          data: { id: formId, purge: true },
        });
        if (!purge.ok) {
          failures.push(`delete-form purge ${formId}: ${describeCall(purge)}`);
          return failures;
        }
        const after = await callAction(owner.request, origin, "get-form", {
          params: { id: formId },
        });
        if (after.status !== 404) {
          failures.push(
            `form ${formId} still resolves after purge: ${describeCall(after)}`,
          );
        }
        return failures;
      },
    );
  } finally {
    await anonymousContext.close();
    await ownerContext.close();
  }
});
