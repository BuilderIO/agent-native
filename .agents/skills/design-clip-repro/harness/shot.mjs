import { mkdirSync } from "node:fs";

import { SHOTS_DIR } from "./harness-env.mjs";

/**
 * Per-interaction capture. The point is not to save files — it is to make the
 * evidence cheap enough that there is no excuse for a claim without it, and to
 * return the paths so the report can cite them.
 *
 *   const cap = shots("drag-into-col");
 *   await cap.app(page, "before");
 *   ...gesture...
 *   const paths = await cap.app(page, "after");
 *   // then OPEN paths with the Read tool. Saving is not looking.
 */
const safe = (part) =>
  String(part)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^\.+/, "");

export function shots(rawTag, dir = SHOTS_DIR) {
  const tag = safe(rawTag);
  mkdirSync(dir, { recursive: true });
  const taken = [];
  const record = (p) => {
    taken.push(p);
    return p;
  };
  return {
    taken,
    /** Whole editor viewport. */
    async app(page, phase = "") {
      const p = `${dir}/${tag}${phase ? `-${safe(phase)}` : ""}-app.png`;
      await page.screenshot({ path: p });
      return record(p);
    },
    /** Just the rendered screen, cropped to the first sizeable iframe. */
    async screen(page, phase = "") {
      const p = `${dir}/${tag}${phase ? `-${safe(phase)}` : ""}-screen.png`;
      const frame = page.locator("iframe").first();
      await frame
        .screenshot({ path: p })
        .catch(() => page.screenshot({ path: p }));
      return record(p);
    },
    /** One node, cropped from its rect inside the iframe. */
    async node(page, nodeId, phase = "") {
      const clip = await page.evaluate((id) => {
        for (const f of document.querySelectorAll("iframe")) {
          const d = f.contentDocument;
          if (!d) continue;
          const el = d.querySelector(`[data-agent-native-node-id="${id}"]`);
          if (!el) continue;
          const fr = f.getBoundingClientRect();
          const s = fr.width / d.documentElement.clientWidth;
          const r = el.getBoundingClientRect();
          const pad = 12;
          return {
            x: Math.max(0, fr.x + r.x * s - pad),
            y: Math.max(0, fr.y + r.y * s - pad),
            width: r.width * s + pad * 2,
            height: r.height * s + pad * 2,
          };
        }
        return null;
      }, nodeId);
      const p = `${dir}/${tag}-${safe(nodeId)}${phase ? `-${safe(phase)}` : ""}.png`;
      await page.screenshot({ path: p, ...(clip ? { clip } : {}) });
      return record(p);
    },
    /** Figma side — caller must already hold withLock("osmouse", …). */
    async figma(page, phase = "") {
      const p = `${dir}/${tag}${phase ? `-${safe(phase)}` : ""}-figma.png`;
      await page.screenshot({ path: p });
      return record(p);
    },
    /** Paste into the report so every finding carries its evidence. */
    report() {
      return taken.map((p) => `      ${p}`).join("\n");
    },
  };
}
