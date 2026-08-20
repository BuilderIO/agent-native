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
  "aws-lambda.svg",
  "deno.svg",
  "azure.svg",
  "koyeb.svg",
  "render.svg",
];

describe("deployment target logos", () => {
  it("uses a real public logo for every supported target", () => {
    const content = readFileSync(deploymentDoc, "utf8");

    for (const logo of deploymentLogos) {
      expect(content).toContain(`src="/integration-logos/${logo}"`);
      expect(existsSync(new URL(logo, logoDirectory))).toBe(true);
    }

    expect(content).not.toContain("deployment-target-mark text-mark");
  });

  it("provides a dark-mode logo for monochrome providers", () => {
    const content = readFileSync(deploymentDoc, "utf8");

    for (const logo of [
      "vercel-white.svg",
      "deno-white.svg",
      "koyeb-white.svg",
      "render-white.svg",
    ]) {
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
