import fs from "node:fs";
import path from "node:path";

export type DeployTarget = "node" | "docker" | "netlify" | "vercel" | "presets";

export const DEPLOY_TARGETS: readonly DeployTarget[] = [
  "node",
  "docker",
  "netlify",
  "vercel",
  "presets",
];

// Targets that deploy to a hosting provider's project instead of running here.
export type HostTarget = "netlify" | "vercel";

// Targets that run the app against a database the check creates for the run.
export type DatabaseTarget = Exclude<DeployTarget, "presets">;

export const CREATE_COMMAND =
  "npx --yes @agent-native/core@latest create my-app --standalone --template chat";

interface DocContract {
  /** The guide a reader follows for this target. */
  doc: string;
  /** Commands the harness runs, which the guide must still contain. */
  commands: readonly string[];
}

const GUIDES = {
  node: "packages/core/docs/content/node-js.mdx",
  docker: "packages/core/docs/content/docker.mdx",
  netlify: "packages/core/docs/content/netlify.mdx",
  vercel: "packages/core/docs/content/vercel.mdx",
} as const;

const AUTH_SECRET_COMMAND =
  'export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"';

// The harness runs the guides' commands, so a guide that stops saying one of
// them must fail here rather than leave the check proving a path nobody reads.
export const DEPLOY_DOC_CONTRACTS: Record<
  DeployTarget,
  readonly DocContract[]
> = {
  node: [
    {
      doc: GUIDES.node,
      commands: [
        CREATE_COMMAND,
        "corepack enable",
        "pnpm install",
        AUTH_SECRET_COMMAND,
        "pnpm migrate:production",
        "NITRO_PRESET=node pnpm build",
        "NODE_ENV=production",
        "pnpm start",
      ],
    },
  ],
  docker: [
    {
      doc: GUIDES.docker,
      commands: [
        CREATE_COMMAND,
        "corepack enable",
        "pnpm install",
        AUTH_SECRET_COMMAND,
        "pnpm migrate:production",
        "docker build -t my-agent-native-app .",
        "docker run --rm",
        "-p 3000:3000",
        "-e DATABASE_URL",
        "-e BETTER_AUTH_SECRET",
      ],
    },
  ],
  netlify: [
    {
      doc: GUIDES.netlify,
      commands: [
        CREATE_COMMAND,
        "corepack enable",
        "pnpm install",
        AUTH_SECRET_COMMAND,
        "npx netlify sites:create --name my-app",
        'npx netlify env:set DATABASE_URL "$DATABASE_URL"',
        'npx netlify env:set BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"',
        "pnpm migrate:production",
        "NITRO_PRESET=netlify pnpm build",
        "npx netlify deploy --prod --dir=dist --functions=.netlify/functions-internal",
      ],
    },
  ],
  vercel: [
    {
      doc: GUIDES.vercel,
      commands: [
        CREATE_COMMAND,
        "corepack enable",
        "pnpm install",
        AUTH_SECRET_COMMAND,
        "npx vercel link",
        "npx vercel env add DATABASE_URL production",
        "npx vercel env add BETTER_AUTH_SECRET production",
        "pnpm migrate:production",
        "NITRO_PRESET=vercel pnpm build",
        "npx vercel deploy --prebuilt --prod",
      ],
    },
  ],
  presets: [
    {
      doc: GUIDES.netlify,
      commands: [CREATE_COMMAND, "NITRO_PRESET=netlify pnpm build"],
    },
    { doc: GUIDES.vercel, commands: ["NITRO_PRESET=vercel pnpm build"] },
  ],
};

/** The guides every target runs, for scoping CI to an edit of one of them. */
export const DEPLOY_GUIDE_PATHS: readonly string[] = [
  ...new Set(
    Object.values(DEPLOY_DOC_CONTRACTS).flatMap((contracts) =>
      contracts.map((contract) => contract.doc),
    ),
  ),
];

// What each hosting preset's build must leave behind for the host's own deploy
// command to find. A build that exits 0 without these deploys nothing.
export const PRESET_SHAPES: Record<
  "netlify" | "vercel",
  { files: readonly string[] }
> = {
  netlify: { files: ["dist", ".netlify/functions-internal/server/main.mjs"] },
  vercel: {
    files: [
      ".vercel/output/config.json",
      ".vercel/output/functions/__server.func/index.mjs",
      ".vercel/output/static",
    ],
  },
};

// `vercel env rm` of a variable that is not there fails with this message (in
// plain text, and in the JSON the CLI prints when it thinks an agent is
// driving). It is the one failure a cleanup may treat as "already gone": the
// removal runs before the write it undoes is known to have landed.
export function isVercelEnvVarAbsent(output: string): boolean {
  return /Environment Variable\b.*\bwas not found/i.test(output);
}

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
  for (const { doc, commands } of DEPLOY_DOC_CONTRACTS[target]) {
    const missing = missingDocCommands(
      fs.readFileSync(path.join(repoRoot, doc), "utf8"),
      commands,
    );
    if (missing.length === 0) continue;
    throw new Error(
      `${doc} no longer contains the command(s) the ${target} deploy check runs:\n` +
        missing.map((command) => `  ${command}`).join("\n") +
        "\nChange the guide and scripts/qa-deploy-paths-lib.ts together, so the check keeps proving what the guide tells readers to do.",
    );
  }
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
// pattern keeps it from ever matching one this check did not create.
export const DEPLOY_DATABASE_NAME_PATTERN =
  /^an_deploy_ci_(\d{10})_[a-z0-9]{6}_[a-z]+$/;

// A host project is created once and reused by every later run, because the
// credential that runs the check is not guaranteed to be allowed to delete
// one. Runs that could overlap get a project of their own, one per npm
// dist-tag and one for this checkout's packages, so one run never overwrites
// the deploy another is still using.
export const DEPLOY_PROJECT_SLOTS = ["local", "latest", "nightly"] as const;

export type DeployProjectSlot = (typeof DEPLOY_PROJECT_SLOTS)[number];

export const DEPLOY_PROJECT_NAME_PATTERN =
  /^an-deploy-ci-(netlify|vercel)-(local|latest|nightly)$/;

export function deployProjectSlot(
  source: string,
  npmTag: string,
): DeployProjectSlot {
  const slot = source === "npm" ? npmTag : "local";
  const allowed = DEPLOY_PROJECT_SLOTS.filter((candidate) =>
    source === "npm" ? candidate !== "local" : candidate === "local",
  );
  if (!(allowed as readonly string[]).includes(slot)) {
    throw new Error(
      `A hosted deploy check has a project for ${allowed.join(" and ")}, not "${slot}".`,
    );
  }
  return slot as DeployProjectSlot;
}

export function deployProjectName(
  host: HostTarget,
  slot: DeployProjectSlot,
): string {
  const name = `an-deploy-ci-${host}-${slot}`;
  if (!DEPLOY_PROJECT_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to use "${name}" as a deploy-check project.`);
  }
  return name;
}

export function deployDatabaseName(
  target: DatabaseTarget,
  nowMs: number,
  randomSuffix: string,
): string {
  const name = `an_deploy_ci_${Math.floor(nowMs / 1000)}_${randomSuffix}_${target}`;
  if (!DEPLOY_DATABASE_NAME_PATTERN.test(name)) {
    throw new Error(`Refusing to use "${name}" as a deploy-check database.`);
  }
  return name;
}

/**
 * Seconds since a deploy-check database was created, read from its name. Null
 * for any name this check did not create, so a reaper cannot touch it.
 */
export function deployResourceAgeSeconds(
  name: string,
  nowMs: number,
): number | null {
  const match = DEPLOY_DATABASE_NAME_PATTERN.exec(name);
  if (!match) return null;
  return Math.floor(nowMs / 1000) - Number(match[1]);
}

/**
 * The databases old enough to be leaked: created by this check, and at least
 * `minAgeSeconds` ago. A run still in progress is younger than any sensible
 * minimum, so a reaper never deletes under a live run.
 */
export function selectReapable(
  names: readonly string[],
  nowMs: number,
  minAgeSeconds: number,
): string[] {
  return names.filter((name) => {
    const age = deployResourceAgeSeconds(name, nowMs);
    return age !== null && age >= minAgeSeconds;
  });
}

/**
 * The text with every secret value replaced, whole and in the pieces a tool
 * might print on its own (a URL's password).
 */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret.length < 8) continue;
    redacted = redacted.split(secret).join("***");
  }
  return redacted;
}

/** Values to redact for a URL that carries a password. */
export function secretsInUrl(value: string): string[] {
  try {
    const url = new URL(value);
    return [value, url.toString(), decodeURIComponent(url.password)].filter(
      (part) => part.length > 0,
    );
  } catch {
    return [value];
  }
}
