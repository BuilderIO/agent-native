import type { RowIcon } from "@agent-native/design-system/model";
import {
  IconApps,
  IconArrowUpRight,
  IconBolt,
  IconBox,
  IconBrain,
  IconBrandAws,
  IconBrandCloudflare,
  IconBrandGoogle,
  IconBrandSupabase,
  IconBrowser,
  IconCloud,
  IconCode,
  IconCoin,
  IconCpu,
  IconCube,
  IconDatabase,
  IconEyeOff,
  IconGauge,
  IconGitBranch,
  IconKey,
  IconMail,
  IconMicrophone,
  IconPalette,
  IconPhoto,
  IconPlugConnected,
  IconSearch,
  IconServer,
  IconShield,
  IconShieldCheck,
  IconTopologyRing2,
  IconUpload,
  IconUsersGroup,
} from "@tabler/icons-react";
import type { ComponentType } from "react";

const SYMBOLS: Readonly<
  Partial<
    Record<string, ComponentType<{ "aria-hidden"?: "true"; size?: number }>>
  >
> = {
  apps: IconApps,
  bolt: IconBolt,
  box: IconBox,
  brain: IconBrain,
  "brand-aws": IconBrandAws,
  "brand-cloudflare": IconBrandCloudflare,
  "brand-supabase": IconBrandSupabase,
  browser: IconBrowser,
  cloud: IconCloud,
  code: IconCode,
  coin: IconCoin,
  cpu: IconCpu,
  cube: IconCube,
  database: IconDatabase,
  "external-link": IconArrowUpRight,
  "eye-off": IconEyeOff,
  gauge: IconGauge,
  "git-branch": IconGitBranch,
  google: IconBrandGoogle,
  key: IconKey,
  mail: IconMail,
  microphone: IconMicrophone,
  palette: IconPalette,
  photo: IconPhoto,
  "plug-connected": IconPlugConnected,
  search: IconSearch,
  server: IconServer,
  shield: IconShield,
  "shield-check": IconShieldCheck,
  "topology-ring-2": IconTopologyRing2,
  upload: IconUpload,
  "users-group": IconUsersGroup,
};

/**
 * A row's icon: a decorative glyph, or an image sized like one. `size` sets a
 * glyph's own width and height where no container sizes it.
 */
export function Glyph({ icon, size }: { icon: RowIcon; size?: number }) {
  if (icon.kind === "image") {
    return (
      <img
        src={icon.src}
        alt={icon.alt ?? ""}
        aria-hidden={icon.alt ? undefined : true}
        className="size-[18px] shrink-0 object-contain"
      />
    );
  }
  const Symbol = SYMBOLS[icon.key];
  if (!Symbol) {
    throw new Error(`No glyph for icon symbol "${icon.key}"`);
  }
  return size === undefined ? (
    <Symbol aria-hidden="true" />
  ) : (
    <Symbol aria-hidden="true" size={size} />
  );
}
