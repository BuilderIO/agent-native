import type { CanvasFrameGeometry } from "./canvas-frames.js";

export interface StarterTemplateSeedScreen {
  filename: string;
  html: string;
  canvasFrame: CanvasFrameGeometry;
}

export interface StarterTemplate {
  id: `starter:${string}`;
  titleKey: string;
  icon: "layout" | "chart" | "device-mobile" | "receipt" | "frame";
  placeholderPromptKey: string;
  generationBrief: string;
  /** Static browser-only card preview. Never copied into a new design. */
  previewHtml?: string;
  seedScreens?: StarterTemplateSeedScreen[];
}

export interface StarterTemplateSummary extends Omit<
  StarterTemplate,
  "seedScreens" | "previewHtml"
> {
  hasSeedScreens: boolean;
  screenCount: number;
  previewHtml?: string | null;
}

const LANDING_PREVIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
*{box-sizing:border-box}body{margin:0;background:#f7f3ec;color:#171717;font-family:Arial,sans-serif}.page{min-height:720px;padding:42px 58px}.nav{display:flex;align-items:center;justify-content:space-between}.mark{width:122px;height:20px;background:#171717;border-radius:4px}.links{display:flex;gap:22px}.links i{display:block;width:62px;height:8px;background:#aaa39a;border-radius:4px}.hero{display:grid;grid-template-columns:1.05fr .95fr;gap:58px;align-items:center;margin-top:92px}.eyebrow{width:122px;height:24px;background:#ec6a47;border-radius:99px}.headline{margin-top:24px;width:92%;height:66px;background:#171717;border-radius:8px;box-shadow:0 82px 0 -22px #171717}.copy{margin-top:98px;width:76%;height:12px;background:#b7afa5;border-radius:6px;box-shadow:0 24px 0 #d1cbc3}.actions{display:flex;gap:14px;margin-top:46px}.actions b{width:142px;height:42px;background:#171717;border-radius:7px}.actions i{width:116px;height:42px;border:2px solid #aaa39a;border-radius:7px}.visual{position:relative;height:405px;background:#0f6b59;border-radius:18px;overflow:hidden}.visual:before{content:"";position:absolute;inset:42px 42px 110px;background:#f6c84c;border-radius:12px}.visual:after{content:"";position:absolute;left:76px;right:76px;bottom:42px;height:46px;background:#f7f3ec;border-radius:9px;box-shadow:0 -64px 0 -14px #ec6a47}
</style></head><body><main class="page"><nav class="nav"><span class="mark"></span><span class="links"><i></i><i></i><i></i></span></nav><section class="hero"><div><div class="eyebrow"></div><div class="headline"></div><div class="copy"></div><div class="actions"><b></b><i></i></div></div><div class="visual"></div></section></main></body></html>`;

const DASHBOARD_PREVIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
*{box-sizing:border-box}body{margin:0;background:#eef1f4;font-family:Arial,sans-serif}.shell{display:grid;grid-template-columns:224px 1fr;min-height:720px}.side{background:#17212b;padding:34px 26px}.logo{width:108px;height:21px;background:#f4f6f8;border-radius:4px;margin-bottom:62px}.side i{display:block;width:148px;height:13px;background:#51606d;border-radius:5px;margin:24px 0}.side i:nth-child(2){background:#49b69d;height:34px;margin-left:-10px;padding:0 10px}.main{padding:38px 44px}.top{display:flex;justify-content:space-between}.title{width:210px;height:30px;background:#17212b;border-radius:6px}.avatar{width:42px;height:42px;border-radius:50%;background:#e99063}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-top:42px}.metric{height:108px;background:white;border:1px solid #d7dde2;border-radius:10px;padding:20px}.metric:before{content:"";display:block;width:60px;height:9px;background:#97a3ad;border-radius:4px;box-shadow:0 38px 0 8px #273641}.workspace{display:grid;grid-template-columns:1.7fr 1fr;gap:18px;margin-top:20px}.chart,.table{height:350px;background:white;border:1px solid #d7dde2;border-radius:10px;padding:24px}.chart:before{content:"";display:block;height:240px;margin-top:42px;background:linear-gradient(160deg,transparent 48%,#49b69d 49%,#49b69d 52%,transparent 53%),repeating-linear-gradient(#fff,#fff 55px,#e8ecef 56px)}.table:before{content:"";display:block;height:11px;background:#263640;border-radius:5px;box-shadow:0 54px 0 #dfe4e8,0 108px 0 #dfe4e8,0 162px 0 #dfe4e8,0 216px 0 #dfe4e8}
</style></head><body><main class="shell"><aside class="side"><div class="logo"></div><i></i><i></i><i></i><i></i><i></i></aside><section class="main"><div class="top"><span class="title"></span><span class="avatar"></span></div><div class="metrics"><div class="metric"></div><div class="metric"></div><div class="metric"></div><div class="metric"></div></div><div class="workspace"><div class="chart"></div><div class="table"></div></div></section></main></body></html>`;

const MOBILE_APP_PREVIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
*{box-sizing:border-box}body{margin:0;background:#dfe6df;font-family:Arial,sans-serif}.scene{min-height:720px;display:grid;place-items:center;position:relative;overflow:hidden}.scene:before,.scene:after{content:"";position:absolute;width:340px;height:340px;border-radius:50%}.scene:before{background:#f2c14e;left:110px;top:190px}.scene:after{background:#d95d48;right:90px;bottom:-110px}.phone{position:relative;z-index:1;width:326px;height:650px;background:#fafaf7;border:12px solid #1c2520;border-radius:48px;padding:44px 24px 24px;box-shadow:0 24px 60px #26372c4d}.phone:before{content:"";position:absolute;top:15px;left:50%;transform:translateX(-50%);width:82px;height:19px;background:#1c2520;border-radius:99px}.header{height:26px;width:154px;background:#1c2520;border-radius:6px}.hero{height:155px;margin-top:26px;background:#2c7a60;border-radius:22px;position:relative}.hero:after{content:"";position:absolute;width:88px;height:88px;border-radius:50%;background:#f2c14e;right:24px;top:28px}.list{margin-top:20px}.row{height:74px;background:white;border:1px solid #d8ddd8;border-radius:14px;margin:12px 0;position:relative}.row:before{content:"";position:absolute;width:42px;height:42px;background:#e7ebe7;border-radius:11px;left:14px;top:15px}.row:after{content:"";position:absolute;width:116px;height:10px;background:#a5ada7;border-radius:5px;left:70px;top:24px;box-shadow:0 20px 0 -2px #d5dad6}.tabs{position:absolute;left:24px;right:24px;bottom:20px;height:52px;background:#1c2520;border-radius:18px;display:flex;justify-content:space-around;align-items:center}.tabs i{width:20px;height:20px;background:#728077;border-radius:6px}.tabs i:first-child{background:#f2c14e}
</style></head><body><main class="scene"><section class="phone"><div class="header"></div><div class="hero"></div><div class="list"><div class="row"></div><div class="row"></div><div class="row"></div></div><div class="tabs"><i></i><i></i><i></i><i></i></div></section></main></body></html>`;

const PRICING_PREVIEW_HTML = `<!doctype html>
<html><head><meta charset="utf-8" /><style>
*{box-sizing:border-box}body{margin:0;background:#fbfaf6;color:#16263a;font-family:Arial,sans-serif}.page{min-height:720px;padding:42px 58px}.nav{display:flex;justify-content:space-between}.logo{width:118px;height:20px;background:#16263a;border-radius:4px}.nav i{width:94px;height:36px;border:2px solid #16263a;border-radius:8px}.head{text-align:center;margin:64px auto 38px}.head:before{content:"";display:block;width:370px;height:42px;background:#16263a;border-radius:8px;margin:auto}.head:after{content:"";display:block;width:260px;height:11px;background:#9aa3aa;border-radius:6px;margin:25px auto}.toggle{width:154px;height:38px;background:#e8e6df;border-radius:99px;margin:0 auto 32px;box-shadow:inset 72px 0 #f0b429}.plans{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;max-width:1030px;margin:auto}.plan{height:370px;border:1px solid #d8d8d2;background:white;border-radius:14px;padding:26px;position:relative}.plan:nth-child(2){background:#16263a;border-color:#16263a;transform:translateY(-12px)}.plan:before{content:"";display:block;width:94px;height:15px;background:#79838b;border-radius:5px;box-shadow:0 54px 0 13px #16263a}.plan:nth-child(2):before{background:#f0b429;box-shadow:0 54px 0 13px white}.plan:after{content:"";position:absolute;left:26px;right:26px;bottom:28px;height:42px;background:#16263a;border-radius:8px;box-shadow:0 -68px 0 -15px #d9ddd9,0 -112px 0 -15px #d9ddd9,0 -156px 0 -15px #d9ddd9}.plan:nth-child(2):after{background:#f0b429;box-shadow:0 -68px 0 -15px #607083,0 -112px 0 -15px #607083,0 -156px 0 -15px #607083}
</style></head><body><main class="page"><nav class="nav"><span class="logo"></span><i></i></nav><div class="head"></div><div class="toggle"></div><section class="plans"><div class="plan"></div><div class="plan"></div><div class="plan"></div></section></main></body></html>`;

const WIREFRAME_KIT_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://cdn.tailwindcss.com"></script>
  </head>
  <body class="min-h-screen bg-[#f7f7f4] text-[#181818]">
    <main class="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-8 py-10">
      <header class="flex items-center justify-between border-b border-neutral-300 pb-4">
        <div class="h-7 w-36 rounded bg-neutral-300"></div>
        <nav class="flex gap-3">
          <div class="h-3 w-16 rounded bg-neutral-300"></div>
          <div class="h-3 w-16 rounded bg-neutral-300"></div>
          <div class="h-3 w-16 rounded bg-neutral-300"></div>
        </nav>
      </header>
      <section class="grid flex-1 grid-cols-[1.1fr_0.9fr] items-center gap-10">
        <div class="space-y-5">
          <div class="h-5 w-32 rounded-full bg-neutral-300"></div>
          <div class="space-y-3">
            <div class="h-12 w-full rounded bg-neutral-800"></div>
            <div class="h-12 w-5/6 rounded bg-neutral-800"></div>
          </div>
          <div class="space-y-2">
            <div class="h-4 w-full rounded bg-neutral-300"></div>
            <div class="h-4 w-4/5 rounded bg-neutral-300"></div>
          </div>
          <div class="flex gap-3 pt-2">
            <div class="h-11 w-36 rounded bg-neutral-900"></div>
            <div class="h-11 w-32 rounded border border-neutral-400"></div>
          </div>
        </div>
        <div class="grid gap-4 rounded-2xl border border-neutral-300 bg-white p-5 shadow-sm">
          <div class="aspect-[4/3] rounded-xl bg-neutral-200"></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="h-16 rounded bg-neutral-100"></div>
            <div class="h-16 rounded bg-neutral-100"></div>
            <div class="h-16 rounded bg-neutral-100"></div>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "starter:landing",
    titleKey: "starter.landing.title",
    icon: "layout",
    placeholderPromptKey: "starter.landing.placeholderPrompt",
    generationBrief:
      "Create a polished landing page with a strong first viewport, clear value proposition, feature proof, social credibility, and a focused final call to action. Use the user's prompt for domain, audience, and tone.",
    previewHtml: LANDING_PREVIEW_HTML,
  },
  {
    id: "starter:dashboard",
    titleKey: "starter.dashboard.title",
    icon: "chart",
    placeholderPromptKey: "starter.dashboard.placeholderPrompt",
    generationBrief:
      "Create a dense but calm dashboard with navigation, KPI summaries, primary charting, secondary tables, and scan-friendly operational states. Prioritize repeated-use ergonomics over marketing composition.",
    previewHtml: DASHBOARD_PREVIEW_HTML,
  },
  {
    id: "starter:mobile-app",
    titleKey: "starter.mobileApp.title",
    icon: "device-mobile",
    placeholderPromptKey: "starter.mobileApp.placeholderPrompt",
    generationBrief:
      "Create a mobile app prototype with a realistic phone-sized layout, primary tab/navigation structure, one high-value workflow, and polished empty/loading/error states where relevant.",
    previewHtml: MOBILE_APP_PREVIEW_HTML,
  },
  {
    id: "starter:pricing",
    titleKey: "starter.pricing.title",
    icon: "receipt",
    placeholderPromptKey: "starter.pricing.placeholderPrompt",
    generationBrief:
      "Create a pricing page with clear plan comparison, a highlighted recommended tier, credible feature grouping, objections handled nearby, and a conversion-focused but restrained layout.",
    previewHtml: PRICING_PREVIEW_HTML,
  },
  {
    id: "starter:wireframe-kit",
    titleKey: "starter.wireframeKit.title",
    icon: "frame",
    placeholderPromptKey: "starter.wireframeKit.placeholderPrompt",
    generationBrief:
      "Use the copied wireframe screen as the structural base. Preserve its hierarchy and spacing language, then adapt labels, sections, and visual emphasis to the user's request.",
    previewHtml: WIREFRAME_KIT_HTML,
    seedScreens: [
      {
        filename: "index.html",
        html: WIREFRAME_KIT_HTML,
        canvasFrame: { x: 0, y: 0, width: 1280, height: 720 },
      },
    ],
  },
];

export function getStarterTemplate(
  id: string | undefined | null,
): StarterTemplate | null {
  if (!id?.startsWith("starter:")) return null;
  return STARTER_TEMPLATES.find((starter) => starter.id === id) ?? null;
}

export function starterTemplateSummaries(): StarterTemplateSummary[] {
  return STARTER_TEMPLATES.map(({ seedScreens, previewHtml, ...starter }) => ({
    ...starter,
    hasSeedScreens: Boolean(seedScreens?.length),
    screenCount: seedScreens?.length ?? 0,
    previewHtml: previewHtml ?? seedScreens?.[0]?.html ?? null,
  }));
}
