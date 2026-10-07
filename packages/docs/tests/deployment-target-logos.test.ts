import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const deploymentDoc = new URL(
  "../../core/docs/content/deployment.mdx",
  import.meta.url,
);
const logoDirectory = new URL("../public/integration-logos/", import.meta.url);

const deploymentLogos = [
  "nodejs.svg",
  "docker.svg",
  "vercel.svg",
  "netlify.svg",
  "cloudflare.svg",
];

describe("deployment target logos", () => {
  it("uses a real public logo for every supported target", () => {
    const content = readFileSync(deploymentDoc, "utf8");

    expect(content).toContain(
      'title="Supported deployment targets" summary="Agent-Native apps can deploy to Node.js, Docker, Vercel, Netlify, and Cloudflare Workers." frame="hide" renderMode="design"',
    );

    for (const logo of deploymentLogos) {
      expect(content).toContain(`src="/integration-logos/${logo}"`);
      expect(existsSync(new URL(logo, logoDirectory))).toBe(true);
    }

    expect(content).not.toContain("deployment-target-mark text-mark");
  });

  it("provides a dark-mode logo for marks that fade on dark", () => {
    const content = readFileSync(deploymentDoc, "utf8");

    for (const logo of ["vercel-white.svg", "netlify-darkmode.svg"]) {
      expect(content).toContain(`src="/integration-logos/${logo}"`);
      expect(existsSync(new URL(logo, logoDirectory))).toBe(true);
    }

    expect(content).toContain(
      '[data-theme="dark"] .deployment-target-logo-light',
    );
    expect(content).toContain(
      '[data-theme="dark"] .deployment-target-logo-dark',
    );
  });
});
