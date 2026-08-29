import {
  ALL_SITES,
  isGoogleOnly,
  originFor,
  productionHostFor,
  siteById,
} from "../../beta/lib/fleet";

export type SignupEnvironment = "beta" | "production";

export interface SignupTarget {
  app: string;
  environment: SignupEnvironment;
  origin: string;
}

const DEFAULT_APPS = "all";
const EMAIL_SIGNUP_UNSUPPORTED_APPS = new Set(["factory", "macros"]);

function supportsEmailSignup(app: string): boolean {
  return !isGoogleOnly(app) && !EMAIL_SIGNUP_UNSUPPORTED_APPS.has(app);
}

function requestedValues(name: string, fallback: string): string[] {
  const raw = process.env[name]?.trim() || fallback;
  if (raw.toLowerCase() === "all") return ["all"];
  const values = [
    ...new Set(
      raw
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (values.length === 0) {
    throw new Error(`${name} resolved to no targets.`);
  }
  return values;
}

function selectedApps() {
  const requested = requestedValues("SIGNUP_E2E_APPS", DEFAULT_APPS);
  if (requested[0] === "all")
    return ALL_SITES.filter((site) => supportsEmailSignup(site.id));
  const known = new Set(ALL_SITES.map((site) => site.id));
  const unknown = requested.filter((app) => !known.has(app));
  if (unknown.length > 0) {
    throw new Error(
      `SIGNUP_E2E_APPS names unknown app(s): ${unknown.join(", ")}.`,
    );
  }
  const unsupported = requested.filter((app) => !supportsEmailSignup(app));
  if (unsupported.length > 0) {
    throw new Error(
      `SIGNUP_E2E_APPS includes app(s) without email signup: ${unsupported.join(", ")}.`,
    );
  }
  return requested.map(siteById);
}

function selectedEnvironments(): SignupEnvironment[] {
  return requestedValues("SIGNUP_E2E_ENVIRONMENTS", "beta").map((value) => {
    if (value === "beta") return "beta";
    if (value === "prod" || value === "production") return "production";
    throw new Error(
      `SIGNUP_E2E_ENVIRONMENTS contains ${value}; use beta or production.`,
    );
  });
}

export function selectedSignupTargets(): SignupTarget[] {
  return selectedEnvironments().flatMap((environment) =>
    selectedApps().map((site) => ({
      app: site.id,
      environment,
      origin:
        environment === "beta"
          ? originFor(site)
          : `https://${productionHostFor(site)}`,
    })),
  );
}
