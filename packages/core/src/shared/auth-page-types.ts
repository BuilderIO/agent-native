export type AuthView =
  | "signup"
  | "login"
  | "forgot"
  | "twoFactor"
  | "verification"
  | "magicLink"
  | "magicLinkSent"
  | "googleOnly";

export interface AuthMarketingProps {
  appName: string;
  tagline?: string;
  description?: string;
  features?: string[];
  authHeadline?: string;
  authDescription?: string;
  learnMoreUrl?: string;
}

export interface AuthLocaleOption {
  value: string;
  label: string;
}

export interface AuthLegalNotice {
  termsUrl: string;
  privacyUrl: string;
  termsLabel?: string;
  privacyLabel?: string;
  prefix?: string;
  connector?: string;
  suffix?: string;
}

export interface AuthPageProps {
  authMode: "magic-link" | "password";
  googleOnly: boolean;
  initialPrompt: boolean;
  initialView: AuthView;
  appBasePath: string;
  homePath: string;
  initialResumeHref?: string;
  workspaceRuntime: boolean;
  trackingApp: string;
  defaultLocale: string;
  localeStorageKey: string;
  locales: Record<string, Record<string, string>>;
  localeMetadata: Record<string, { dir?: string }>;
  localeOptions: AuthLocaleOption[];
  marketing?: AuthMarketingProps;
  marketingLocales: Record<string, AuthMarketingProps>;
  brandMarkSrc: string;
  brandMarkLightSrc?: string;
  githubUrl: string;
  appName?: string;
  showGoogle: boolean;
  organizationSsoEnabled?: boolean;
  identitySsoEnabled?: boolean;
  googleViaIdentitySso?: boolean;
  identitySsoAuto?: boolean;
  signupLegalNotice?: AuthLegalNotice;
  signupLocalModeNote?: { text: string; command: string };
  docsAuthUrl: string;
  publicOAuthOrigin: string;
  workspaceGatewayReturnOrigin: string;
  googleAuthMode: "popup" | "redirect" | "auto";
  builderPreviewLocalDevEnabled: boolean;
  environmentBetaHosts: Record<string, string>;
  betaForceQueryParam: string;
  betaForceSessionStorageKey: string;
  betaOptOutQueryParam: string;
  betaOptOutStorageKey: string;
  betaOptOutDurationMs: number;
  passwordMinLength: number;
  passwordMaxLength: number;
  passwordMaxCopy: string;
}

export interface ResetPasswordPageProps {
  pageType: "reset-password";
  appBasePath: string;
  passwordMinLength: number;
  passwordMaxLength: number;
}
