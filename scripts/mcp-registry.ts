import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";

import {
  TEMPLATES,
  type TemplateMeta,
} from "../packages/shared-app-config/templates.ts";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DEFAULT_OUTPUT_DIRECTORY = ".tmp/mcp-registry";
const REGISTRY_SCHEMA =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
const REPOSITORY_URL = "https://github.com/BuilderIO/agent-native";
const REGISTRY_NAMESPACE = "io.github.builderio";
const registrySchema = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "mcp-registry/server.schema.json"), "utf8"),
) as Record<string, unknown>;
if (registrySchema.$id !== REGISTRY_SCHEMA) {
  throw new Error(`MCP Registry schema snapshot must be ${REGISTRY_SCHEMA}.`);
}
const registryAjv = new Ajv({ allErrors: true, strict: false });
addFormats(registryAjv);
const registrySchemaValidator = registryAjv.compile(registrySchema);

const REGISTRY_VERSIONS: Record<string, string> = {
  analytics: "1.0.0",
  assets: "1.0.0",
  brain: "1.0.0",
  calendar: "1.0.0",
  chat: "1.0.0",
  clips: "1.0.0",
  content: "1.0.0",
  design: "1.0.0",
  dispatch: "1.0.0",
  forms: "1.0.0",
  mail: "1.0.0",
  plan: "1.0.0",
  slides: "1.0.0",
};

const REGISTRY_DESCRIPTION_OVERRIDES: Record<string, string> = {
  plan: "Structured visual plans and PR recaps with diagrams, prototypes, annotations, and sharing",
};

const REGISTRY_WEBSITE_OVERRIDES: Record<string, string> = {
  brain: "https://brain.agent-native.com",
};

const DEPLOYMENT_SITE_ALIASES: Record<string, string> = {
  chat: "starter",
};

type ProductionSite = {
  host: string;
};

type RegistryServer = {
  $schema: string;
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl: string;
  repository: {
    url: string;
    source: "github";
  };
  remotes: Array<{
    type: "streamable-http";
    url: string;
  }>;
};

const productionSites = readProductionSites();
const servers = buildRegistryServers(productionSites);

const cliArguments = process.argv.slice(2);
if (cliArguments[1] === "--") cliArguments.splice(1, 1);
const [command, outputArgument, ...unexpectedArguments] = cliArguments;

if (unexpectedArguments.length > 0) {
  throw new Error(`Unexpected argument(s): ${unexpectedArguments.join(", ")}`);
}
if (command === "--check" && outputArgument !== undefined) {
  throw new Error("--check does not accept an output directory.");
}

if (command === "--check") {
  console.log(
    `MCP Registry metadata is valid for ${servers.length} public apps.`,
  );
} else if (command === "--write") {
  const outputDirectory = path.resolve(
    REPO_ROOT,
    outputArgument ?? DEFAULT_OUTPUT_DIRECTORY,
  );
  writeRegistryServers(outputDirectory, servers);
  console.log(
    `Wrote ${servers.length} MCP Registry server.json files to ${outputDirectory}`,
  );
} else {
  throw new Error(
    "Usage: node --experimental-strip-types scripts/mcp-registry.ts --check | --write [directory]",
  );
}

function readProductionSites(): Record<string, ProductionSite> {
  const value = JSON.parse(
    readFileSync(
      path.join(REPO_ROOT, "scripts/netlify-production-sites.json"),
      "utf8",
    ),
  ) as unknown;

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "scripts/netlify-production-sites.json must contain an object.",
    );
  }

  const sites: Record<string, ProductionSite> = {};
  for (const [name, site] of Object.entries(value)) {
    if (
      !site ||
      typeof site !== "object" ||
      Array.isArray(site) ||
      typeof (site as { host?: unknown }).host !== "string"
    ) {
      throw new Error(`Production site ${name} is missing a host.`);
    }
    sites[name] = { host: (site as { host: string }).host };
  }
  return sites;
}

function buildRegistryServers(
  sites: Record<string, ProductionSite>,
): RegistryServer[] {
  const publicTemplates = TEMPLATES.filter((template) => !template.hidden);
  const publicNames = new Set(publicTemplates.map((template) => template.name));

  for (const name of publicNames) {
    if (!REGISTRY_VERSIONS[name]) {
      throw new Error(`Missing MCP Registry version for public app ${name}.`);
    }
  }
  for (const name of Object.keys(REGISTRY_VERSIONS)) {
    if (!publicNames.has(name)) {
      throw new Error(
        `MCP Registry version exists for non-public app ${name}.`,
      );
    }
  }
  for (const name of Object.keys(REGISTRY_DESCRIPTION_OVERRIDES)) {
    if (!publicNames.has(name)) {
      throw new Error(
        `MCP Registry description exists for non-public app ${name}.`,
      );
    }
  }
  for (const name of Object.keys(REGISTRY_WEBSITE_OVERRIDES)) {
    if (!publicNames.has(name)) {
      throw new Error(
        `MCP Registry website exists for non-public app ${name}.`,
      );
    }
  }

  const names = new Set<string>();
  return publicTemplates.map((template) => {
    if (names.has(template.name)) {
      throw new Error(
        `Duplicate public app in the template catalog: ${template.name}.`,
      );
    }
    names.add(template.name);
    return buildRegistryServer(template, sites);
  });
}

function buildRegistryServer(
  template: TemplateMeta,
  sites: Record<string, ProductionSite>,
): RegistryServer {
  if (!template.prodUrl) {
    throw new Error(`Public app ${template.name} has no production URL.`);
  }

  const deploymentSiteName =
    DEPLOYMENT_SITE_ALIASES[template.name] ?? template.name;
  const deploymentSite = sites[deploymentSiteName];
  if (!deploymentSite) {
    throw new Error(
      `Public app ${template.name} has no production deployment site (${deploymentSiteName}).`,
    );
  }

  if (
    template.name !== "chat" &&
    new URL(template.prodUrl).host !== deploymentSite.host
  ) {
    throw new Error(
      `Production URL for ${template.name} does not match its deployment host.`,
    );
  }

  const server: RegistryServer = {
    $schema: REGISTRY_SCHEMA,
    name: `${REGISTRY_NAMESPACE}/agent-native-${template.name}`,
    title: `Agent-Native ${template.label}`,
    description:
      REGISTRY_DESCRIPTION_OVERRIDES[template.name] ??
      normalizeDescription(template.hint),
    version: REGISTRY_VERSIONS[template.name],
    websiteUrl:
      REGISTRY_WEBSITE_OVERRIDES[template.name] ??
      `https://www.agent-native.com/apps/${template.name}`,
    repository: {
      url: REPOSITORY_URL,
      source: "github",
    },
    remotes: [
      {
        type: "streamable-http",
        url: `https://${deploymentSite.host}/mcp`,
      },
    ],
  };

  validateRegistryServer(server, template.name);
  return server;
}

function normalizeDescription(description: string): string {
  return description
    .replaceAll(/\s+[—–]\s+/gu, " - ")
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function validateRegistryServer(server: RegistryServer, appName: string): void {
  if (
    server.$schema !== REGISTRY_SCHEMA ||
    server.name !== `${REGISTRY_NAMESPACE}/agent-native-${appName}`
  ) {
    throw new Error(`MCP Registry identity is invalid for ${appName}.`);
  }
  if (
    server.repository.url !== REPOSITORY_URL ||
    server.repository.source !== "github"
  ) {
    throw new Error(`MCP Registry repository is invalid for ${appName}.`);
  }
  if (!server.description || !server.title) {
    throw new Error(
      `MCP Registry title and description are required for ${appName}.`,
    );
  }
  if (server.description.length > 100) {
    throw new Error(
      `MCP Registry description for ${appName} exceeds 100 characters.`,
    );
  }
  if (server.title.length > 100) {
    throw new Error(
      `MCP Registry title for ${appName} exceeds 100 characters.`,
    );
  }
  if (
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      server.version,
    )
  ) {
    throw new Error(
      `MCP Registry version for ${appName} is not SemVer: ${server.version}.`,
    );
  }
  const websiteUrl = new URL(server.websiteUrl);
  if (websiteUrl.protocol !== "https:" || !websiteUrl.hostname) {
    throw new Error(`MCP Registry website for ${appName} must use HTTPS.`);
  }
  const [remote] = server.remotes;
  if (
    server.remotes.length !== 1 ||
    !remote ||
    remote.type !== "streamable-http" ||
    new URL(remote.url).protocol !== "https:"
  ) {
    throw new Error(
      `MCP Registry remote for ${appName} must be one HTTPS Streamable HTTP URL.`,
    );
  }

  const serializedServer = JSON.parse(JSON.stringify(server)) as unknown;
  if (!registrySchemaValidator(serializedServer)) {
    throw new Error(
      `MCP Registry schema validation failed for ${appName}: ${registryAjv.errorsText(registrySchemaValidator.errors)}`,
    );
  }
}

function writeRegistryServers(
  outputDirectory: string,
  registryServers: RegistryServer[],
): void {
  for (const server of registryServers) {
    const appName = server.name
      .slice(server.name.lastIndexOf("/") + 1)
      .replace(/^agent-native-/, "");
    const filePath = path.join(outputDirectory, appName, "server.json");
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(server, null, 2)}\n`);
  }
}
