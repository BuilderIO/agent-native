import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { expect, type Page } from "@playwright/test";
import { z } from "zod";

import { publishBrowserFixture } from "./publish-fixture";
import { fetchUiAction } from "./ui-capability";

export async function checkLibrary(page: Page, base: string): Promise<void> {
  const headers = {
    "x-agent-native-frontend": "1",
    "x-agent-native-csrf": "1",
  };
  const post = async (action: string, data: object) => {
    const result = await fetchUiAction(
      page.request,
      base,
      `${base}/_agent-native/actions/${action}`,
      { method: "POST", data },
    );
    if (!result.ok()) throw new Error(`${action} HTTP ${result.status()}`);
    return result.json();
  };
  const local =
    new URL(base).hostname === "127.0.0.1" ||
    new URL(base).hostname === "localhost";
  const roster = "**/_agent-native/org/members*";
  if (local) {
    await page.route(roster, (route) =>
      route.fulfill({
        json: {
          members: Array.from({ length: 25 }, (_, index) => ({
            email: `fake-${index}@example.invalid`,
            name: `Fake Person ${index}`,
            role: "member",
          })),
          hasMore: false,
          nextOffset: null,
        },
      }),
    );
  }
  console.log("LIBRARY stage create status");
  const title = `Library ${randomUUID()}`;
  const { status } = z.object({ status: z.object({ id: z.string() }) }).parse(
    await post("create-data-status", {
      name: title,
      color: "#4488cc",
      inLibrary: true,
    }),
  );
  let id: string | undefined;
  try {
    console.log("LIBRARY stage create project");
    id = z
      .object({ id: z.string() })
      .parse(await post("create-project", { title })).id;
    const projectId = id;
    console.log("LIBRARY stage set status");
    await post("update-project", { projectId: id, statusId: status.id });
    console.log("LIBRARY stage publish");
    await publishBrowserFixture(page, base, id);
    const projectResponse = await page.request.get(
      `${base}/_agent-native/actions/list-projects`,
      { headers, params: { view: "active", search: title } },
    );
    expect(projectResponse.ok()).toBe(true);
    const projectList = z
      .object({
        projects: z.array(
          z.object({
            id: z.string(),
            statusId: z.string().nullable(),
            lastPublishedAt: z.string().nullable(),
          }),
        ),
      })
      .parse(await projectResponse.json());
    const savedProject = projectList.projects.find((entry) => entry.id === id);
    expect(savedProject?.statusId).toBe(status.id);
    expect(savedProject?.lastPublishedAt).toBeTruthy();
    const statusResponse = await page.request.get(
      `${base}/_agent-native/actions/list-data-statuses`,
      { headers },
    );
    expect(statusResponse.ok()).toBe(true);
    const statusList = z
      .object({
        statuses: z.array(
          z.object({
            id: z.string(),
            inLibrary: z.boolean(),
            endorsed: z.boolean(),
          }),
        ),
      })
      .parse(await statusResponse.json());
    expect(
      statusList.statuses.find((entry) => entry.id === status.id)?.inLibrary,
    ).toBe(true);
    console.log("LIBRARY stage share");
    await page.goto(`${base}/project/${encodeURIComponent(id)}/latest`, {
      waitUntil: "domcontentloaded",
    });
    const shareButton = page.getByRole("button", {
      name: "Share",
      exact: true,
    });
    let sharePhase = "open Share";
    try {
      await shareButton.click();
      sharePhase = "inspect and close Share";
      const sharePanel = page
        .locator("[data-agent-native-share-overlay]")
        .filter({
          has: page.getByRole("combobox", { name: "General access" }),
        });
      await expect(
        sharePanel.getByText("Owner", { exact: true }),
      ).toBeVisible();
      await expect(sharePanel.getByRole("combobox").first()).toBeFocused();
      const invite = sharePanel.locator('input[role="combobox"]');
      const { expanded, listboxId } = await invite.evaluate((element) => ({
        expanded: element.getAttribute("aria-expanded"),
        listboxId: element.getAttribute("aria-controls"),
      }));
      console.log(
        "LIBRARY invite layer",
        JSON.stringify({ expanded, listboxId }),
      );
      expect(["true", "false"]).toContain(expanded);
      if (expanded === "true") {
        expect(listboxId).toBeTruthy();
        const listbox = page.locator(`[id=${JSON.stringify(listboxId)}]`);
        await expect(listbox).toHaveAttribute("role", "listbox");
        await expect(listbox).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(invite).toHaveAttribute("aria-expanded", "false");
        await expect(listbox).not.toBeVisible();
        await expect(sharePanel).toBeVisible();
        await expect(invite).toBeFocused();
      }
      const viewport = page.viewportSize();
      await page.setViewportSize({ width: 375, height: 800 });
      await expect(sharePanel).toBeVisible();
      await expect
        .poll(
          async () => {
            const bounds = await sharePanel.boundingBox();
            return (
              bounds !== null && bounds.x >= 0 && bounds.x + bounds.width <= 375
            );
          },
          {
            timeout: 5000,
            message: "Share panel extends beyond the narrow viewport",
          },
        )
        .toBe(true);
      if (viewport) {
        await page.setViewportSize(viewport);
        await expect(sharePanel).toBeVisible();
      }
      if ((await invite.getAttribute("aria-expanded")) === "true") {
        await page.keyboard.press("Escape");
        await expect(invite).toHaveAttribute("aria-expanded", "false");
      }
      await page.keyboard.press("Escape");
      await expect(sharePanel).not.toBeVisible();
      await expect(shareButton).toBeFocused();
      const readShares = async () => {
        const response = await page.request.get(
          `${base}/_agent-native/actions/list-resource-shares`,
          {
            headers,
            params: {
              resourceType: "analytics-project",
              resourceId: projectId,
            },
          },
        );
        expect(response.ok()).toBe(true);
        return z
          .object({
            visibility: z.enum(["private", "org", "public"]),
            shares: z.array(
              z.object({ principalType: z.string(), role: z.string() }),
            ),
          })
          .parse(await response.json());
      };
      expect((await readShares()).visibility).toBe("private");
      sharePhase = "reopen Share";
      await shareButton.click();
      sharePhase = "open General access";
      if (local) {
        const invite = sharePanel.locator('input[role="combobox"]');
        await expect(invite).toHaveAttribute("aria-expanded", "true");
        const listboxId = await invite.getAttribute("aria-controls");
        if (!listboxId) throw new Error("Invite listbox is missing");
        const listbox = page.locator(`[id=${JSON.stringify(listboxId)}]`);
        await expect(listbox.getByRole("option")).toHaveCount(25);
        const geometry = await listbox.evaluate((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return {
            maxHeight: style.maxHeight,
            overflowY: style.overflowY,
            height: rect.height,
            scrollHeight: element.scrollHeight,
          };
        });
        const anchor = await page
          .locator("span.fixed.end-4.top-16.size-px")
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              position: getComputedStyle(element).position,
            };
          });
        const target = page.getByRole("combobox", { name: "General access" });
        const hit = await target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2,
          );
          return {
            target: hit === element || element.contains(hit),
            tag: hit?.tagName,
            role: hit?.getAttribute("role"),
          };
        });
        console.log(
          "LIBRARY local geometry",
          JSON.stringify({ geometry, anchor, hit }),
        );
        expect(geometry.maxHeight).toBe("224px");
        expect(geometry.overflowY).toBe("auto");
        expect(geometry.height).toBeLessThanOrEqual(224);
        expect(geometry.scrollHeight).toBeGreaterThan(geometry.height);
        expect(anchor.position).toBe("fixed");
        expect(anchor.y).toBe(64);
        expect(anchor.x).toBe((page.viewportSize()?.width ?? 0) - 17);
        expect(hit.target).toBe(true);
      }
      await page.getByRole("combobox", { name: "General access" }).click();
      sharePhase = "select Anyone";
      await page.getByRole("option", { name: /Anyone (?:in|at)/ }).click();
      sharePhase = "verify organization visibility";
      await expect
        .poll(async () => (await readShares()).visibility)
        .toBe("org");
      sharePhase = "open Role";
      await page.getByRole("combobox", { name: "Role" }).last().click();
      sharePhase = "select Can edit";
      await page.getByRole("option", { name: "Can edit" }).click();
      sharePhase = "verify organization editor role";
      await expect
        .poll(async () => (await readShares()).shares)
        .toContainEqual(
          expect.objectContaining({ principalType: "org", role: "editor" }),
        );
      sharePhase = "reopen General access";
      await page.getByRole("combobox", { name: "General access" }).click();
      sharePhase = "select Invite only";
      await page.getByRole("option", { name: "Invite only" }).click();
      sharePhase = "verify private visibility";
      await expect
        .poll(async () => (await readShares()).visibility)
        .toBe("private");
      expect(
        (await readShares()).shares.some(
          (share) => share.principalType === "org",
        ),
      ).toBe(false);
      await page.keyboard.press("Escape");
    } catch (error) {
      console.error(`LIBRARY Share failure phase: ${sharePhase}`);
      if (local) console.error("LIBRARY Share failure detail", error);
      try {
        const directory = ".tmp/analytics-2-library";
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const path = `${directory}/share-failure-${randomUUID()}.png`;
        await page.screenshot({ path });
        console.log("LIBRARY active Share failure screenshot captured", path);
      } catch (diagnosticError) {
        console.error("LIBRARY Share screenshot failed", diagnosticError);
      }
      throw new Error(`Share phase: ${sharePhase}`, { cause: error });
    }
    console.log("LIBRARY stage menu");
    await page.addInitScript(() => {
      const trace: string[] = [];
      Object.assign(window, { __libraryRouteTrace: trace });
      for (const method of ["pushState", "replaceState"] as const) {
        const original = history[method].bind(history);
        history[method] = (...args) => {
          const next = args[2];
          if (next)
            trace.push(
              `${method}:${new URL(String(next), location.href).pathname}`,
            );
          return original(...args);
        };
      }
    });
    await page.goto(`${base}/home`);
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Library" }).click();
    console.log("LIBRARY stage list");
    const library = page.locator('[data-workspace-surface="library"]');
    const appLink = library.getByRole("link", { name: title, exact: true });
    try {
      await expect(library).toBeVisible();
      await expect(appLink).toBeVisible();
    } catch (error) {
      console.log(
        "LIBRARY UI diagnostic",
        JSON.stringify({
          path: new URL(page.url()).pathname,
          transitions: await page.evaluate(
            () =>
              (window as unknown as { __libraryRouteTrace?: string[] })
                .__libraryRouteTrace ?? [],
          ),
          librarySurface: await page
            .locator('[data-workspace-surface="library"]')
            .count(),
          libraryTitle: await page
            .getByText("Library", { exact: true })
            .count(),
          empty: await page
            .getByText("No apps in the Library", { exact: true })
            .count(),
          error: await page
            .getByText("Error loading apps", { exact: true })
            .count(),
        }),
      );
      await page.screenshot({
        path: ".tmp/analytics-owner/report-library-failure.png",
      });
      throw error;
    }
    await page.screenshot({
      path: ".tmp/analytics-owner/report-1794899298-library-results.png",
    });
    await appLink.click();
    console.log("LIBRARY stage reader");
    await expect(page).toHaveURL(
      `${base}/app/${encodeURIComponent(id)}/latest`,
    );
    await expect(
      page
        .locator('[data-published-app="true"]')
        .getByRole("heading", { name: title }),
    ).toBeVisible();
    await page.screenshot({
      path: ".tmp/analytics-owner/report-1794899298-library.png",
    });
  } finally {
    if (local) await page.unroute(roster);
    console.log("LIBRARY stage cleanup");
    await page.goto(`${base}/home`);
    if (id) {
      await post("trash-project", { projectId: id });
      await post("delete-project", { projectId: id });
      const readback = await page.request.get(
        `${base}/_agent-native/actions/get-project?${new URLSearchParams({ projectId: id })}`,
        { headers },
      );
      expect(readback.status()).toBe(404);
    }
    await post("delete-data-status", { id: status.id });
    const statuses = await page.request.get(
      `${base}/_agent-native/actions/list-data-statuses`,
      { headers },
    );
    expect(statuses.ok()).toBe(true);
    const saved = z
      .object({ statuses: z.array(z.object({ id: z.string() })) })
      .parse(await statuses.json());
    expect(saved.statuses.some((entry) => entry.id === status.id)).toBe(false);
  }
}
