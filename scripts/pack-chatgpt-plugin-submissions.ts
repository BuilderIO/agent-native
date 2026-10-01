import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type {
  AppSkillChatGptPlugin,
  AppSkillChatGptTestCase,
} from "../packages/core/src/cli/app-skill.js";
import { normalizeAppSkillManifest } from "../packages/core/src/cli/app-skill.js";
import {
  MCP_DIRECTORY_ROUTE_PREFIX,
  MCP_PUBLIC_ROUTE_PREFIX,
} from "../packages/core/src/mcp/route-paths.js";
import { CHATGPT_DIRECTORY_TOOL_NAMES as contentTools } from "../templates/content/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_TOOL_NAMES as designTools } from "../templates/design/server/lib/chatgpt-directory-tools.js";
import { CHATGPT_DIRECTORY_TOOL_NAMES as slidesTools } from "../templates/slides/server/lib/chatgpt-directory-tools.js";

interface SourceManifest {
  id: string;
  hosted: { url: string; mcpUrl: string };
  mcp: { serverName: string };
  chatgpt: AppSkillChatGptPlugin;
}

const repoRoot = process.cwd();
const outputArg = process.argv.find((arg) => arg.startsWith("--out="));
const outputDir = path.resolve(
  repoRoot,
  outputArg?.slice("--out=".length) ?? ".tmp/chatgpt-plugin-submissions",
);
const apps = ["slides", "design", "content"] as const;
const directoryTools = {
  slides: slidesTools,
  design: designTools,
  content: contentTools,
};
const categories = new Set([
  "Productivity",
  "Creativity",
  "Developer Tools",
  "Business & Operations",
  "Data & Analytics",
  "Communication",
  "Education & Research",
  "Security",
  "Finance",
  "Healthcare",
  "Travel",
  "Entertainment",
  "Other",
]);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertHttpsUrl(value: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTPS URL.`);
  }
  assert(parsed.protocol === "https:", `${label} must use HTTPS.`);
  assert(
    !parsed.username && !parsed.password,
    `${label} cannot contain embedded credentials.`,
  );
}

function assertTestCases(
  appId: string,
  allowlist: Set<string>,
  cases: AppSkillChatGptTestCase[],
  positive: boolean,
): void {
  const expectedCount = positive ? 5 : 3;
  assert(
    cases.length === expectedCount,
    `${appId} needs exactly ${expectedCount} ${positive ? "positive" : "negative"} review cases.`,
  );
  for (const [index, testCase] of cases.entries()) {
    assert(
      testCase.description.trim().length > 0 &&
        testCase.prompt.trim().length > 0,
      `${appId} review case ${index + 1} needs a description and prompt.`,
    );
    if (positive) {
      assert(
        typeof testCase.tools_triggered === "string" &&
          testCase.tools_triggered.trim().length > 0 &&
          typeof testCase.expected_behavior === "string" &&
          testCase.expected_behavior.trim().length > 0,
        `${appId} positive review case ${index + 1} needs tools_triggered and expected_behavior.`,
      );
      for (const name of testCase.tools_triggered
        .split(",")
        .map((part) => part.trim())) {
        assert(
          allowlist.has(name),
          `${appId} review case ${index + 1} refers to unlisted tool "${name}".`,
        );
      }
    }
  }
}

function validateManifest(appId: (typeof apps)[number]): {
  source: SourceManifest;
  appDir: string;
  logoPath: string;
  widgetDomain: string;
} {
  const appDir = path.join(repoRoot, "templates", appId);
  const sourcePath = path.join(appDir, "agent-native.app-skill.json");
  const normalized = normalizeAppSkillManifest(
    JSON.parse(fs.readFileSync(sourcePath, "utf8")),
  );
  assert(normalized.chatgpt, `${appId} is missing ChatGPT plugin metadata.`);
  const source: SourceManifest = {
    id: normalized.id,
    hosted: normalized.hosted,
    mcp: normalized.mcp,
    chatgpt: normalized.chatgpt,
  };
  const metadata = source.chatgpt;
  assert(source.id === appId, `${sourcePath} has an unexpected app id.`);
  assert(metadata, `${appId} is missing ChatGPT plugin metadata.`);
  assert(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(metadata.version),
    `${appId} plugin version must be semantic version text.`,
  );

  const listing = metadata.interface;
  assert(
    listing.displayName.trim().length > 0 && listing.displayName.length <= 30,
    `${appId} displayName must be non-empty and at most 30 characters.`,
  );
  assert(
    listing.shortDescription.trim().length > 0 &&
      listing.shortDescription.length <= 30,
    `${appId} shortDescription must be non-empty and at most 30 characters.`,
  );
  assert(
    listing.longDescription.trim().length > 0 &&
      listing.longDescription.length <= 4000,
    `${appId} longDescription must be non-empty and at most 4000 characters.`,
  );
  assert(
    listing.developerName.trim().length > 0 &&
      listing.developerName.length <= 80,
    `${appId} developerName must be non-empty and at most 80 characters.`,
  );
  assert(
    categories.has(listing.category),
    `${appId} uses an unsupported OpenAI plugin category.`,
  );
  assert(
    listing.capabilities.length <= 20,
    `${appId} has more than 20 capabilities.`,
  );
  assert(
    listing.capabilities.every(
      (capability) => capability.trim().length > 0 && capability.length <= 120,
    ),
    `${appId} capabilities must be non-empty and at most 120 characters.`,
  );
  assert(
    listing.defaultPrompt.length > 0 && listing.defaultPrompt.length <= 3,
    `${appId} needs one to three starter prompts.`,
  );
  assert(
    new Set(listing.defaultPrompt).size === listing.defaultPrompt.length &&
      listing.defaultPrompt.every(
        (prompt) => prompt.trim().length > 0 && prompt.length <= 128,
      ),
    `${appId} starter prompts must be unique and at most 128 characters.`,
  );
  for (const key of [
    "websiteURL",
    "supportURL",
    "privacyPolicyURL",
    "termsOfServiceURL",
  ] as const) {
    assertHttpsUrl(listing[key], `${appId} ${key}`);
  }
  assert(
    metadata.review.commerce === false,
    `${appId} review.commerce must match the current no-commerce listing.`,
  );
  assert(
    metadata.review.iframeJustification.trim().length > 0,
    `${appId} needs an iframe justification for the hosted widget.`,
  );

  const allowlist = new Set(directoryTools[appId]);
  assert(
    new URL(source.hosted.mcpUrl).pathname === MCP_PUBLIC_ROUTE_PREFIX,
    `${appId} hosted.mcpUrl must keep the general-purpose MCP endpoint.`,
  );
  assertTestCases(appId, allowlist, metadata.review.test_cases.positive, true);
  assertTestCases(appId, allowlist, metadata.review.test_cases.negative, false);

  const logoPath = path.resolve(appDir, listing.logoPath);
  assert(
    logoPath.startsWith(`${appDir}${path.sep}`),
    `${appId} logoPath must stay inside the app directory.`,
  );
  const logo = fs.readFileSync(logoPath);
  assert(logo.byteLength <= 5 * 1024 * 1024, `${appId} logo exceeds 5 MiB.`);
  const svg = logo.toString("utf8");
  const dimensionMatch = svg.match(
    /<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/,
  );
  const viewBoxMatch = svg.match(
    /\bviewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"/,
  );
  const squareDimensions = Boolean(
    dimensionMatch &&
    Number(dimensionMatch[1]) >= 48 &&
    dimensionMatch[1] === dimensionMatch[2],
  );
  const squareViewBox = Boolean(
    viewBoxMatch &&
    Number(viewBoxMatch[3]) >= 48 &&
    viewBoxMatch[3] === viewBoxMatch[4],
  );
  assert(
    squareDimensions || squareViewBox,
    `${appId} SVG logo must be square and at least 48 by 48.`,
  );

  const widgetDomain = new URL(source.hosted.url).origin;
  assert(
    new URL(source.hosted.mcpUrl).origin === widgetDomain,
    `${appId} MCP URL must use the app's hosted origin.`,
  );
  return { source, appDir, logoPath, widgetDomain };
}

function buildPackage(
  appId: string,
  validated: ReturnType<typeof validateManifest>,
): string {
  const { source, logoPath } = validated;
  const listing = source.chatgpt.interface;
  const openAiListing = Object.fromEntries(
    Object.entries(listing).filter(
      ([key]) => key !== "logoPath" && key !== "keywords",
    ),
  );
  const name = `agent-native-${appId}`;
  assert(
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name),
    `${appId} plugin name must use at most 64 ASCII letters, digits, underscores, or hyphens and start with a letter or digit.`,
  );
  const packageRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), `chatgpt-plugin-${appId}-`),
  );
  fs.mkdirSync(path.join(packageRoot, "assets"));
  fs.copyFileSync(logoPath, path.join(packageRoot, "assets/logo.svg"));

  const pluginManifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name,
    version: source.chatgpt.version,
    description: listing.longDescription,
    author: { name: listing.developerName, url: "https://agent-native.com/" },
    homepage: listing.websiteURL,
    repository: "https://github.com/BuilderIO/agent-native",
    keywords: listing.keywords ?? [
      appId,
      ...listing.capabilities.map((capability) => capability.toLowerCase()),
    ],
    extensions: {
      "com.openai": {
        interface: {
          ...openAiListing,
          logo: "./assets/logo.svg",
        },
        review: {
          test_cases: source.chatgpt.review.test_cases,
          ...(source.chatgpt.review.demo_recording_url
            ? { demo_recording_url: source.chatgpt.review.demo_recording_url }
            : {}),
          commerce: source.chatgpt.review.commerce,
        },
      },
    },
  };
  const mcpManifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      [source.mcp.serverName]: {
        type: "streamable-http",
        url: new URL(MCP_DIRECTORY_ROUTE_PREFIX, source.hosted.url).toString(),
      },
    },
  };

  fs.writeFileSync(
    path.join(packageRoot, "plugin.json"),
    `${JSON.stringify(pluginManifest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(packageRoot, "mcp.json"),
    `${JSON.stringify(mcpManifest, null, 2)}\n`,
  );
  return packageRoot;
}

function main(): void {
  assert(
    !fs.existsSync(outputDir),
    `Output directory already exists: ${outputDir}`,
  );
  const validated = apps.map(
    (appId) => [appId, validateManifest(appId)] as const,
  );
  const domains = validated.map(([, app]) => app.widgetDomain);
  assert(
    new Set(domains).size === domains.length,
    "Each plugin with UI must use a unique widget domain.",
  );

  fs.mkdirSync(outputDir, { recursive: true });
  try {
    const prepared: string[] = [];
    for (const [appId, app] of validated) {
      const packageRoot = buildPackage(appId, app);
      try {
        const zipPath = path.join(outputDir, `${appId}.zip`);
        execFileSync(
          "zip",
          [
            "-X",
            "-q",
            "-r",
            zipPath,
            "plugin.json",
            "mcp.json",
            "assets/logo.svg",
          ],
          { cwd: packageRoot },
        );
        execFileSync("unzip", ["-t", zipPath], { stdio: "ignore" });
        prepared.push(`${appId}: ${zipPath}`);
      } finally {
        fs.rmSync(packageRoot, { recursive: true, force: true });
      }
    }

    const pending = validated
      .filter(([, app]) => !app.source.chatgpt.review.demo_recording_url)
      .map(
        ([appId]) =>
          `- ${appId}: record a reviewer-accessible walkthrough and add its URL to the source manifest, then rebuild and upload the ZIP.`,
      );
    const endpoints = validated.flatMap(([appId, app]) => {
      const origin = new URL(app.source.hosted.url).origin;
      return [
        `- ${appId}: MCP <${new URL(MCP_DIRECTORY_ROUTE_PREFIX, origin).toString()}>; challenge <${new URL("/.well-known/openai-apps-challenge", origin).toString()}>`,
      ];
    });
    const iframeNotes = validated.map(
      ([appId, app]) =>
        `### ${appId}\n\n${app.source.chatgpt.review.iframeJustification}`,
    );
    fs.writeFileSync(
      path.join(outputDir, "SUBMISSION.md"),
      [
        "# ChatGPT plugin submission packages",
        "",
        "DRAFT ONLY. These ZIPs are not ready for review submission until demo recordings, reviewer access, verified publisher identity, domain challenge tokens, and policy attestations are complete.",
        "",
        "Production promotion: `9e1dbd1c81`.",
        "",
        ...prepared.map((entry) => `- ${entry}`),
        "",
        "## Production endpoints",
        "",
        ...endpoints,
        "",
        "Challenge URLs return 404 until that app's `OPENAI_APPS_CHALLENGE_TOKEN` is set and the app is redeployed. Rescan after redeployment and verify the response matches the dashboard-issued token.",
        "",
        "## Remaining package work",
        ...(pending.length
          ? pending
          : [
              "- Add the reviewer-accessible demo URLs to the manifests and rebuild if the packages were generated before the walkthroughs were recorded.",
            ]),
        "",
        "Each ZIP contains one remote MCP server at the app's /mcp/directory endpoint, the portable plugin manifest, and the app logo. Reviewer credentials and secrets are intentionally excluded.",
        "",
        "The proposed walkthrough sequence is maintained in the repository at `docs/chatgpt-plugin-demo-script.md`; recordings must be created and hosted by the submitter.",
        "",
        "## Portal-only steps",
        "",
        "Confirm first that the organization's project residency is eligible. Then complete these steps for each app in order:",
        "",
        "1. Verify the publisher identity and confirm it matches `developerName` in the source manifest.",
        "2. Have an organization owner grant the submitter `api.apps.write`.",
        "3. Upload the draft ZIP.",
        "4. Connect its MCP server at the listed `/mcp/directory` URL and complete OAuth setup.",
        "5. Set that app's dashboard-issued challenge token as `OPENAI_APPS_CHALLENGE_TOKEN` on its deployment, then redeploy.",
        "6. Rescan the domain and verify the challenge response matches the token.",
        "7. Add reviewer credentials through the dashboard's secure form.",
        "8. Run all eight cases on ChatGPT web and mobile. Use only the seeded records in `docs/chatgpt-plugin-directory.md`.",
        "9. Record a reviewer-accessible walkthrough, add its URL to the source manifest, rebuild the ZIP, and upload the refreshed package. Provide the iframe explanation below if requested.",
        "10. Complete policy attestations and submit for review; wait for the review decision.",
        "11. After approval, select country availability and publish in the dashboard.",
        "",
        "## Iframe explanations",
        "",
        ...iframeNotes.flatMap((note) => [note, ""]),
        "Reviewer data to seed is listed in the repository at `docs/chatgpt-plugin-directory.md`.",
        "",
        "The project license is unresolved: root package metadata says ISC but there is no root `LICENSE` file. Do not make an open-source, ISC, MIT, free, or other specific license claim in the listings until the licensing decision is confirmed.",
        "",
      ].join("\n"),
    );
    process.stdout.write(
      `DRAFT ONLY — not ready for submission\n${prepared.join("\n")}\n`,
    );
    process.stdout.write(`Handoff: ${path.join(outputDir, "SUBMISSION.md")}\n`);
  } catch (error) {
    fs.rmSync(outputDir, { recursive: true, force: true });
    throw error;
  }
}

main();
