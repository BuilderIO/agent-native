// guard:allow-raw-color — the fixed authored preview has its own theme-independent palette.
const [WHITE, SKY, MINT] = ["#ffffff", "#00B5FF", "#48FFE4"] as const;
// guard:allow-raw-color — the fixed authored preview has its own theme-independent palette.
const [INK, SLATE, DUSK] = ["#172b34", "#40565b", "#667679"] as const;
// guard:allow-raw-color — the fixed authored preview has its own theme-independent palette.
const HALO = "#bdc7c2";
// guard:allow-raw-color — the preview frame is authored scene paint, not a theme token.
const FRAME = "#101a25";

function logoPaths(index: number): string {
  return `<path d="M24.5537 65.7695H0L15.0859 39.4619L37.708 0L60.4912 39.4619H39.6396L24.5537 65.7695Z" fill="${WHITE}"/>
  <path d="M89.446 0H114L76.2921 65.7704H51.7383L89.446 0Z" fill="url(#catalog-logo-${index})"/>`;
}

function logoGradient(index: number): string {
  return `<linearGradient id="catalog-logo-${index}" x1="101.702" y1="67.4791" x2="113.672" y2="-37.4275" gradientUnits="userSpaceOnUse"><stop stop-color="${SKY}"/><stop offset="1" stop-color="${MINT}"/></linearGradient>`;
}

export function nativeShaderCatalogLogo(index: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 114 66" width="102" height="59" data-agent-native-node-id="catalog-target-${index}"><defs>${logoGradient(index)}</defs>${logoPaths(index)}</svg>`;
}

export function nativeShaderCatalogFillFrame(index: number): string {
  return `<div data-agent-native-node-id="catalog-target-${index}" style="position:absolute;left:17px;top:16px;width:126px;height:88px;border-radius:24px;background:${FRAME}"></div>`;
}

export function nativeShaderCatalogFixture(
  index: number,
  includeLogo: boolean,
): string {
  const id = (name: string) => `catalog-art-${index}-${name}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" width="160" height="120" preserveAspectRatio="xMidYMid slice" data-catalog-art="">
  <defs>
    <linearGradient id="${id("ground")}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${INK}"/><stop offset="0.56" stop-color="${SLATE}"/><stop offset="1" stop-color="${DUSK}"/></linearGradient>
    <radialGradient id="${id("light")}" cx="0.54" cy="0.53" r="0.7"><stop offset="0" stop-color="${HALO}" stop-opacity="0.27"/><stop offset="1" stop-color="${HALO}" stop-opacity="0"/></radialGradient>
    ${includeLogo ? logoGradient(index) : ""}
  </defs>
  <path d="M0 0H160V120H0Z" fill="url(#${id("ground")})"/>
  <path d="M0 0H160V120H0Z" fill="url(#${id("light")})"/>
  ${includeLogo ? `<g transform="translate(25 28) scale(0.965)">${logoPaths(index)}</g>` : ""}
</svg>`;
}
