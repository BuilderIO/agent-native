import fs from "node:fs";
import path from "node:path";

export type DeployTarget = "node" | "docker";

export const DEPLOY_TARGETS: readonly DeployTarget[] = ["node", "docker"];

export const CREATE_COMMAND =
  "npx --yes @agent-native/core@latest create my-app --standalone --template chat";

interface DocContract {
  /** The guide a reader follows for this target. */
  doc: string;
  /** Commands the harness runs, which the guide must still contain. */
  commands: readonly string[];
}

// The harness runs the guides' commands, so a guide that stops saying one of
// them must fail here rather than leave the check proving a path nobody reads.
export const DEPLOY_DOC_CONTRACTS: Record<DeployTarget, DocContract> = {
  node: {
    doc: "packages/core/docs/content/node-js.mdx",
    commands: [
      CREATE_COMMAND,
      "corepack enable",
      "pnpm install",
      'export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"',
      "pnpm migrate:production",
      "NITRO_PRESET=node pnpm build",
      "NODE_ENV=production",
      "pnpm start",
    ],
  },
  docker: {
    doc: "packages/core/docs/content/docker.mdx",
    commands: [
      CREATE_COMMAND,
      "corepack enable",
      "pnpm install",
      'export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"',
      "pnpm migrate:production",
      "docker build -t my-agent-native-app .",
      "docker run --rm",
      "-p 3000:3000",
      "-e DATABASE_URL",
      "-e BETTER_AUTH_SECRET",
    ],
  },
};

export function missingDocCommands(
  mdx: string,
  commands: readonly string[],
): string[] {
  return commands.filter((command) => !mdx.includes(command));
}

export function assertDocContract(
  repoRoot: string,
  target: DeployTarget,
): void {
  const { doc, commands } = DEPLOY_DOC_CONTRACTS[target];
  const missing = missingDocCommands(
    fs.readFileSync(path.join(repoRoot, doc), "utf8"),
    commands,
  );
  if (missing.length === 0) return;
  throw new Error(
    `${doc} no longer contains the command(s) the ${target} deploy check runs:\n` +
      missing.map((command) => `  ${command}`).join("\n") +
      "\nChange the guide and scripts/qa-deploy-paths-lib.ts together, so the check keeps proving what the guide tells readers to do.",
  );
}

/** Body of the fenced code block whose info string carries `filename="<name>"`. */
export function extractFencedBlock(mdx: string, filename: string): string {
  const lines = mdx.split("\n");
  const marker = `filename="${filename}"`;
  const start = lines.findIndex(
    (line) => line.startsWith("```") && line.includes(marker),
  );
  if (start === -1) {
    throw new Error(`No fenced code block with ${marker} in the guide.`);
  }
  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("```"),
  );
  if (end === -1) {
    throw new Error(`The fenced code block with ${marker} is never closed.`);
  }
  return `${lines.slice(start + 1, end).join("\n")}\n`;
}

export const VENDOR_DIR = ".deploy-vendor";

// The guide's build stage copies the manifests and installs before it copies
// the rest of the app, so unpublished packages vendored into the app must be
// copied in alongside the manifests. Everything else in the Dockerfile stays
// the guide's own text.
const DOCKERFILE_MANIFEST_COPY =
  "COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./";

export function vendorDockerfile(dockerfile: string): string {
  if (!dockerfile.includes(DOCKERFILE_MANIFEST_COPY)) {
    throw new Error(
      `The guide's Dockerfile no longer contains "${DOCKERFILE_MANIFEST_COPY}", so the check cannot place unpublished packages before the install step.`,
    );
  }
  return dockerfile.replace(
    DOCKERFILE_MANIFEST_COPY,
    `COPY ${VENDOR_DIR} ./${VENDOR_DIR}\n${DOCKERFILE_MANIFEST_COPY}`,
  );
}

/** Registry images a Dockerfile starts stages from, without its own stage names. */
export function dockerfileBaseImages(dockerfile: string): string[] {
  const stages = new Set<string>();
  const images = new Set<string>();
  for (const line of dockerfile.split("\n")) {
    const match = /^FROM\s+(?:--\S+\s+)*(\S+)(?:\s+AS\s+(\S+))?\s*$/i.exec(
      line.trim(),
    );
    if (!match) continue;
    if (!stages.has(match[1]!)) images.add(match[1]!);
    if (match[2]) stages.add(match[2]);
  }
  return [...images];
}

const FILE_URL_PATTERN = /file:\/\/\/[^\s"']+/g;

export function findFileUrls(text: string): string[] {
  return [...new Set(text.match(FILE_URL_PATTERN) ?? [])];
}

export function vendorSpecifier(basename: string): string {
  return `file:./${VENDOR_DIR}/${basename}`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The URL as seen from inside a container that reaches the host's database. */
export function containerReachableDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (LOOPBACK_HOSTS.has(url.hostname)) url.hostname = "host.docker.internal";
  return url.toString();
}

export function databaseUrlFor(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

// The epoch lets a reaper age a leaked database from its name alone, and the
// pattern keeps it from ever matching a database this check did not create.
export const DEPLOY_DATABASE_NAME_PATTERN =
  /^an_deploy_ci_(\d{10})_[a-z0-9]{6}_[a-z]+$/;

export function deployDatabaseName(
  target: DeployTarget,
  nowMs: number,
  randomSuffix: string,
): string {
  const name = `an_deploy_ci_${Math.floor(nowMs / 1000)}_${randomSuffix}_${target}`;
  if (!DEPLOY_DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to use "${name}" as a deploy-check database.`);
  }
  return name;
}
