import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    copies: { type: "string", default: "6" },
    title: { type: "string" },
  },
});

const baseUrl = values["base-url"]?.replace(/\/$/, "");
if (!baseUrl) {
  throw new Error(
    "--base-url is required, e.g. --base-url http://127.0.0.1:8097 (the server must run with AUTH_DISABLED=1)",
  );
}
const copies = Number(values.copies);
if (!Number.isInteger(copies) || copies < 1) {
  throw new Error(`--copies must be a positive integer, got ${values.copies}`);
}

const SCREEN_WIDTH = 1440;
const COLUMN_GAP = 240;
const ROW_GAP = 480;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Rng {
  private next: () => number;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  float(): number {
    return this.next();
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]!;
  }
  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

const WORDS =
  "atlas beacon canopy delta ember fathom glacier harbor iris juniper kestrel lumen meridian nimbus orchard prism quartz ridge summit tundra umbra vertex willow xenon yarrow zephyr amber basalt cobalt dune echo fjord granite hollow indigo jasper krypton lagoon mesa nectar onyx pebble quill raven sierra timber urchin velvet wren yonder zenith anchor bramble cinder drift estuary flint grove heron inlet jade kelp lichen marsh north oasis pine quarry reef shale thistle upland vale wharf arbor bluff cove dell elm fern gale heath isle jetty knoll ledge moor nook ore pass rill slope tarn vista weir".split(
    " ",
  );
const FIRST_NAMES =
  "Ada Bea Cyrus Dara Eli Fern Gus Hana Ivo Juno Kai Lena Milo Nia Omar Pia Quin Rhea Saul Tess Uma Vik Wes Xia Yara Zed".split(
    " ",
  );
const LAST_NAMES =
  "Abara Brandt Castell Dimitrov Engel Farrow Gallo Haddad Ishida Jansen Kovac Lindqvist Moreau Novak Okafor Petrov Quint Rossi Sato Tanaka Ulrich Varga Weber Xu Young Zamora".split(
    " ",
  );
const HUES = [
  "slate",
  "zinc",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;
const MID_SHADES = [300, 400, 500, 600] as const;
const LIGHT_SHADES = [50, 100, 200] as const;
const DARK_SHADES = [700, 800, 900, 950] as const;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function words(rng: Rng, count: number): string {
  return Array.from({ length: count }, () => rng.pick(WORDS)).join(" ");
}

function title(rng: Rng, count: number): string {
  return Array.from({ length: count }, () => capitalize(rng.pick(WORDS))).join(
    " ",
  );
}

function sentence(rng: Rng): string {
  return `${capitalize(words(rng, rng.int(8, 18)))}.`;
}

function personName(rng: Rng): string {
  return `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("");
}

function hexColor(rng: Rng): string {
  return `#${Math.floor(rng.float() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const VOID_TAGS = new Set(["input", "img", "br", "hr", "meta", "link"]);

type Attrs = Record<string, string | number | undefined>;

function h(tag: string, attrs: Attrs = {}, ...children: string[]): string {
  const attrText = Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${escapeHtml(String(value))}"`)
    .join("");
  if (VOID_TAGS.has(tag)) return `<${tag}${attrText}>`;
  return `<${tag}${attrText}>${children.join("")}</${tag}>`;
}

function text(value: string): string {
  return escapeHtml(value);
}

function icon(rng: Rng, size = 20, className = ""): string {
  const shapes: string[] = [];
  const shapeCount = rng.int(2, 4);
  for (let index = 0; index < shapeCount; index += 1) {
    const kind = rng.int(0, 3);
    if (kind === 0) {
      shapes.push(
        h("circle", {
          cx: rng.int(6, 18),
          cy: rng.int(6, 18),
          r: rng.int(2, 6),
        }),
      );
    } else if (kind === 1) {
      shapes.push(
        h("rect", {
          x: rng.int(3, 10),
          y: rng.int(3, 10),
          width: rng.int(4, 11),
          height: rng.int(4, 11),
          rx: rng.int(0, 3),
        }),
      );
    } else if (kind === 2) {
      shapes.push(
        h("path", {
          d: `M${rng.int(3, 8)} ${rng.int(3, 21)}L${rng.int(9, 15)} ${rng.int(3, 21)}L${rng.int(16, 21)} ${rng.int(3, 21)}`,
        }),
      );
    } else {
      shapes.push(
        h("path", {
          d: `M4 ${rng.int(5, 19)}C${rng.int(6, 10)} ${rng.int(2, 22)} ${rng.int(14, 18)} ${rng.int(2, 22)} 20 ${rng.int(5, 19)}`,
        }),
      );
    }
  }
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": 2,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: className || undefined,
    },
    ...shapes,
  );
}

function sparkline(rng: Rng, width: number, height: number, stroke: string) {
  const points = Array.from({ length: 24 }, (_, index) => {
    const x = Math.round((index / 23) * width);
    const y = Math.round(rng.float() * (height - 4) + 2);
    return `${x},${y}`;
  }).join(" ");
  return h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      fill: "none",
    },
    h("polyline", {
      points,
      stroke,
      "stroke-width": 2,
      "stroke-linejoin": "round",
    }),
  );
}

function avatar(rng: Rng, name: string, size = "size-8"): string {
  const hue = rng.pick(HUES);
  return h(
    "div",
    {
      class: `${size} shrink-0 rounded-full bg-linear-to-br from-${hue}-400 to-${rng.pick(HUES)}-600 flex items-center justify-center text-xs font-semibold text-white ring-2 ring-white`,
    },
    h("span", {}, text(initials(name))),
  );
}

function documentShell(args: {
  title: string;
  bodyClass: string;
  body: string;
  rootVars: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(args.title)}</title>
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.11/dist/cdn.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,700&display=swap" rel="stylesheet">
<style>
[x-cloak] { display: none !important; }
:root { ${args.rootVars} }
body { font-family: 'Inter', sans-serif; min-height: 100vh; min-height: 100dvh; }
h1, h2, h3, h4 { text-wrap: balance; }
</style>
</head>
<body class="${args.bodyClass}">
${args.body}
</body>
</html>`;
}

interface Screen {
  kind: string;
  html: string;
  estimatedHeight: number;
}

function dashboardScreen(rng: Rng, copy: number): Screen {
  const navSections = Array.from({ length: 5 }, (_, sectionIndex) =>
    h(
      "div",
      { class: "flex flex-col gap-0.5" },
      h(
        "p",
        {
          class:
            "px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500",
        },
        text(title(rng, 1)),
      ),
      ...Array.from({ length: 8 }, (_, itemIndex) =>
        h(
          "a",
          {
            href: "#",
            class: `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${sectionIndex === 0 && itemIndex === 0 ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"}`,
          },
          icon(rng, 18, "shrink-0"),
          h("span", { class: "flex-1 truncate" }, text(title(rng, 2))),
          rng.chance(0.3)
            ? h(
                "span",
                {
                  class: `rounded-full bg-${rng.pick(HUES)}-500/15 px-2 py-0.5 text-[11px] font-medium text-${rng.pick(HUES)}-300`,
                },
                text(String(rng.int(1, 99))),
              )
            : "",
        ),
      ),
    ),
  );

  const kpis = Array.from({ length: 16 }, () => {
    const hue = rng.pick(HUES);
    const up = rng.chance(0.6);
    return h(
      "div",
      {
        class:
          "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm",
      },
      h(
        "div",
        { class: "flex items-center justify-between" },
        h(
          "p",
          { class: "text-sm font-medium text-slate-500" },
          text(title(rng, 2)),
        ),
        h(
          "div",
          {
            class: `flex size-8 items-center justify-center rounded-lg bg-${hue}-50 text-${hue}-600`,
          },
          icon(rng, 16),
        ),
      ),
      h(
        "div",
        { class: "flex items-end justify-between gap-3" },
        h(
          "div",
          { class: "flex flex-col gap-1" },
          h(
            "p",
            { class: "text-3xl font-semibold tracking-tight text-slate-900" },
            text(`${rng.int(10, 999)}.${rng.int(0, 9)}k`),
          ),
          h(
            "span",
            {
              class: `w-fit rounded-full px-2 py-0.5 text-xs font-medium ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`,
            },
            text(`${up ? "+" : "-"}${rng.int(1, 40)}.${rng.int(0, 9)}%`),
          ),
        ),
        sparkline(rng, 96, 36, up ? "#10b981" : "#f43f5e"),
      ),
    );
  });

  const bars = Array.from({ length: 180 }, (_, index) => {
    const barHeight = rng.int(20, 230);
    return h("rect", {
      x: 40 + index * 6,
      y: 250 - barHeight,
      width: 4,
      height: barHeight,
      rx: 1,
      fill: index % 7 === 0 ? "#6366f1" : "#c7d2fe",
    });
  });
  const gridLines = Array.from({ length: 6 }, (_, index) =>
    h("line", {
      x1: 40,
      x2: 1120,
      y1: 250 - index * 45,
      y2: 250 - index * 45,
      stroke: "#e2e8f0",
    }),
  );
  const axisLabels = Array.from({ length: 12 }, (_, index) =>
    h(
      "text",
      { x: 40 + index * 90, y: 272, fill: "#64748b", "font-size": 11 },
      text(capitalize(rng.pick(WORDS)).slice(0, 3)),
    ),
  );

  const statuses = [
    ["Active", "bg-emerald-50 text-emerald-700 ring-emerald-600/20"],
    ["Paused", "bg-amber-50 text-amber-700 ring-amber-600/20"],
    ["Churned", "bg-rose-50 text-rose-700 ring-rose-600/20"],
    ["Trial", "bg-sky-50 text-sky-700 ring-sky-600/20"],
  ] as const;
  const tableRows = Array.from({ length: 140 }, () => {
    const name = personName(rng);
    const [status, statusClass] = rng.pick(statuses);
    const progress = rng.int(4, 100);
    const hue = rng.pick(HUES);
    return h(
      "tr",
      { class: "border-t border-slate-100 hover:bg-slate-50" },
      h(
        "td",
        { class: "px-4 py-3" },
        h("input", {
          type: "checkbox",
          class: "size-4 rounded border-slate-300",
        }),
      ),
      h(
        "td",
        { class: "px-4 py-3" },
        h(
          "div",
          { class: "flex items-center gap-3" },
          avatar(rng, name),
          h(
            "div",
            { class: "flex flex-col" },
            h(
              "span",
              { class: "text-sm font-medium text-slate-900" },
              text(name),
            ),
            h(
              "span",
              { class: "text-xs text-slate-500" },
              text(
                `${name.split(" ")[0]!.toLowerCase()}@${rng.pick(WORDS)}.io`,
              ),
            ),
          ),
        ),
      ),
      h(
        "td",
        { class: "px-4 py-3" },
        h(
          "span",
          {
            class: `inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset ${statusClass}`,
          },
          text(status),
        ),
      ),
      h(
        "td",
        { class: "px-4 py-3" },
        h(
          "span",
          {
            class: `rounded bg-${hue}-100 px-2 py-0.5 text-xs text-${hue}-800`,
          },
          text(capitalize(rng.pick(WORDS))),
        ),
      ),
      h(
        "td",
        { class: "px-4 py-3" },
        h(
          "div",
          { class: "flex items-center gap-2" },
          h(
            "div",
            { class: "h-1.5 w-24 overflow-hidden rounded-full bg-slate-100" },
            h("div", {
              class: `h-full rounded-full bg-${hue}-500`,
              style: `width: ${progress}%`,
            }),
          ),
          h(
            "span",
            { class: "text-xs tabular-nums text-slate-500" },
            text(`${progress}%`),
          ),
        ),
      ),
      h(
        "td",
        {
          class:
            "px-4 py-3 text-right text-sm font-medium tabular-nums text-slate-900",
        },
        h(
          "span",
          {},
          text(
            `$${rng.int(1, 99)},${String(rng.int(0, 999)).padStart(3, "0")}`,
          ),
        ),
      ),
      h(
        "td",
        { class: "px-4 py-3 text-sm text-slate-500" },
        h(
          "span",
          {},
          text(
            `${rng.int(1, 28)} ${rng.pick(["Jan", "Feb", "Mar", "Apr", "May", "Jun"])}`,
          ),
        ),
      ),
      h(
        "td",
        { class: "px-4 py-3" },
        h(
          "div",
          { class: "flex justify-end gap-1" },
          h(
            "button",
            {
              class:
                "rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700",
            },
            icon(rng, 16),
          ),
          h(
            "button",
            {
              class:
                "rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700",
            },
            icon(rng, 16),
          ),
        ),
      ),
    );
  });

  const feed = Array.from({ length: 50 }, () => {
    const name = personName(rng);
    return h(
      "li",
      { class: "flex gap-3 py-3" },
      avatar(rng, name),
      h(
        "div",
        { class: "flex min-w-0 flex-1 flex-col gap-0.5" },
        h(
          "p",
          { class: "text-sm text-slate-700" },
          h("span", { class: "font-medium text-slate-900" }, text(name)),
          text(` ${words(rng, rng.int(4, 9))} `),
          h(
            "span",
            { class: `font-medium text-${rng.pick(HUES)}-600` },
            text(title(rng, 2)),
          ),
        ),
        h(
          "p",
          { class: "text-xs text-slate-400" },
          text(`${rng.int(1, 59)} min ago`),
        ),
      ),
    );
  });

  const tabs = ["overview", "revenue", "retention", "cohorts", "exports"];
  const body = h(
    "div",
    { class: "flex min-h-screen" },
    h(
      "aside",
      {
        class:
          "flex w-72 shrink-0 flex-col gap-2 bg-slate-950 px-3 py-5 text-slate-300",
      },
      h(
        "div",
        { class: "flex items-center gap-2 px-3 pb-2" },
        h(
          "div",
          {
            class:
              "flex size-8 items-center justify-center rounded-lg bg-indigo-500 text-white",
          },
          icon(rng, 18),
        ),
        h(
          "span",
          { class: "text-base font-semibold text-white" },
          text(`${title(rng, 1)} Analytics ${copy + 1}`),
        ),
      ),
      ...navSections,
    ),
    h(
      "main",
      {
        class: "flex min-w-0 flex-1 flex-col gap-6 p-8",
        "x-data": "{ tab: 'overview' }",
      },
      h(
        "header",
        { class: "flex items-center justify-between gap-4" },
        h(
          "div",
          { class: "flex flex-col gap-1" },
          h(
            "h1",
            { class: "text-2xl font-semibold tracking-tight text-slate-900" },
            text(`${title(rng, 2)} Performance`),
          ),
          h("p", { class: "text-sm text-slate-500" }, text(sentence(rng))),
        ),
        h(
          "div",
          { class: "flex items-center gap-3" },
          h("input", {
            type: "search",
            placeholder: "Search accounts",
            class:
              "h-10 w-72 rounded-lg border border-slate-200 bg-white px-3 text-sm",
          }),
          h(
            "button",
            {
              class:
                "h-10 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700",
            },
            text("Export"),
          ),
          h(
            "button",
            {
              class:
                "h-10 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white",
            },
            text("New report"),
          ),
          h(
            "div",
            { class: "flex -space-x-2" },
            ...Array.from({ length: 6 }, () => avatar(rng, personName(rng))),
          ),
        ),
      ),
      h(
        "nav",
        { class: "flex gap-1 border-b border-slate-200" },
        ...tabs.map((tab) =>
          h(
            "button",
            {
              "@click": `tab = '${tab}'`,
              ":class": `tab === '${tab}' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500'`,
              class: "-mb-px border-b-2 px-4 py-2 text-sm font-medium",
            },
            text(capitalize(tab)),
          ),
        ),
      ),
      h("section", { class: "grid grid-cols-4 gap-4" }, ...kpis),
      h(
        "section",
        {
          class:
            "flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6",
        },
        h(
          "h2",
          { class: "text-base font-semibold text-slate-900" },
          text(`${title(rng, 2)} over time`),
        ),
        h(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            viewBox: "0 0 1140 280",
            class: "h-72 w-full",
          },
          ...gridLines,
          ...bars,
          ...axisLabels,
        ),
      ),
      h(
        "section",
        {
          class: "overflow-hidden rounded-2xl border border-slate-200 bg-white",
        },
        h(
          "table",
          { class: "w-full text-left" },
          h(
            "thead",
            {
              class:
                "bg-slate-50 text-xs uppercase tracking-wide text-slate-500",
            },
            h(
              "tr",
              {},
              ...[
                "",
                "Account",
                "Status",
                "Segment",
                "Adoption",
                "ARR",
                "Renewal",
                "",
              ].map((label) =>
                h("th", { class: "px-4 py-3 font-medium" }, text(label)),
              ),
            ),
          ),
          h("tbody", {}, ...tableRows),
        ),
      ),
      h(
        "section",
        { class: "rounded-2xl border border-slate-200 bg-white p-6" },
        h(
          "h2",
          { class: "text-base font-semibold text-slate-900" },
          text("Activity"),
        ),
        h("ul", { class: "divide-y divide-slate-100" }, ...feed),
      ),
    ),
  );
  return {
    kind: "dashboard",
    estimatedHeight: 13_500,
    html: documentShell({
      title: `Analytics dashboard ${copy + 1}`,
      bodyClass: "bg-slate-100 text-slate-900",
      rootVars: "--color-primary: #4f46e5; --radius: 16px;",
      body,
    }),
  };
}

function nestedScreen(rng: Rng, copy: number): Screen {
  const depth = 44;
  function level(tower: number, index: number): string {
    const hue = HUES[(tower * 3 + index) % HUES.length]!;
    const shade = index % 2 === 0 ? LIGHT_SHADES[index % 3] : 50;
    const inner = index + 1 < depth ? level(tower, index + 1) : "";
    const sideCard =
      index % 6 === 5
        ? h(
            "div",
            {
              class: `flex flex-col gap-1 rounded-md bg-${hue}-${rng.pick(MID_SHADES)} p-2 text-white`,
            },
            h(
              "span",
              { class: "text-[11px] font-semibold" },
              text(title(rng, 2)),
            ),
            h("span", { class: "text-[10px] opacity-80" }, text(words(rng, 4))),
          )
        : "";
    return h(
      "div",
      {
        class: `flex flex-col gap-1.5 rounded-lg border border-${hue}-${rng.pick(MID_SHADES)} bg-${hue}-${shade} py-1.5 pl-1.5 pr-0`,
      },
      h(
        "div",
        { class: "flex items-center gap-1.5 pr-1.5" },
        h(
          "span",
          {
            class: `rounded bg-${hue}-${rng.pick(DARK_SHADES)} px-1.5 py-0.5 font-mono text-[10px] text-white`,
          },
          text(`L${index + 1}`),
        ),
        h(
          "span",
          { class: `truncate text-xs font-medium text-${hue}-900` },
          text(title(rng, 2)),
        ),
        h(
          "span",
          { class: `ml-auto text-[10px] text-${hue}-700` },
          text(`${rng.int(1, 99)}`),
        ),
      ),
      sideCard ? h("div", { class: "pr-1.5" }, sideCard) : "",
      inner,
      h(
        "p",
        { class: `pr-1.5 text-[10px] text-${hue}-800` },
        text(words(rng, 5)),
      ),
    );
  }
  const towers = Array.from({ length: 8 }, (_, tower) =>
    h(
      "div",
      { class: "flex flex-col gap-2 rounded-2xl bg-white p-3 shadow-sm" },
      h(
        "h2",
        { class: "text-sm font-semibold text-slate-900" },
        text(`Tower ${tower + 1} - ${title(rng, 2)}`),
      ),
      level(tower, 0),
    ),
  );
  const body = h(
    "div",
    { class: "flex min-h-screen flex-col gap-6 p-10" },
    h(
      "header",
      { class: "flex flex-col gap-1" },
      h(
        "h1",
        { class: "font-['Fraunces'] text-4xl font-semibold text-stone-900" },
        text(`Deep nesting ${copy + 1}: ${depth} levels`),
      ),
      h("p", { class: "text-sm text-stone-500" }, text(sentence(rng))),
    ),
    h("div", { class: "grid grid-cols-2 gap-6" }, ...towers),
  );
  return {
    kind: "nested",
    estimatedHeight: 13_000,
    html: documentShell({
      title: `Deep nesting ${copy + 1}`,
      bodyClass: "bg-stone-100 text-stone-900",
      rootVars: "--color-primary: #1c1917; --radius: 8px;",
      body,
    }),
  };
}

function catalogScreen(rng: Rng, copy: number): Screen {
  const filters = Array.from({ length: 6 }, () =>
    h(
      "fieldset",
      { class: "flex flex-col gap-2 border-b border-neutral-200 pb-4" },
      h(
        "legend",
        { class: "pb-2 text-sm font-semibold text-neutral-900" },
        text(title(rng, 1)),
      ),
      ...Array.from({ length: 8 }, () =>
        h(
          "label",
          { class: "flex items-center gap-2 text-sm text-neutral-600" },
          h("input", {
            type: "checkbox",
            class: "size-4 rounded border-neutral-300",
          }),
          h("span", { class: "flex-1" }, text(title(rng, 2))),
          h(
            "span",
            { class: "text-xs text-neutral-400" },
            text(String(rng.int(1, 400))),
          ),
        ),
      ),
    ),
  );
  const cards = Array.from({ length: 240 }, () => {
    const from = rng.pick(HUES);
    const to = rng.pick(HUES);
    const rating = rng.int(2, 5);
    const price = rng.int(12, 480);
    return h(
      "article",
      {
        class:
          "flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm",
      },
      h(
        "div",
        {
          class: `relative h-44 bg-linear-to-br from-${from}-200 via-${rng.pick(HUES)}-100 to-${to}-400`,
        },
        rng.chance(0.4)
          ? h(
              "span",
              {
                class: `absolute left-3 top-3 rounded-full bg-${rng.pick(HUES)}-600 px-2 py-0.5 text-[11px] font-semibold text-white`,
              },
              text(rng.pick(["New", "Sale", "Limited", "Restock"])),
            )
          : "",
        h(
          "button",
          {
            class:
              "absolute right-3 top-3 flex size-8 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow",
          },
          icon(rng, 16),
        ),
      ),
      h(
        "div",
        { class: "flex flex-1 flex-col gap-2 p-4" },
        h(
          "p",
          {
            class:
              "text-[11px] font-semibold uppercase tracking-wider text-neutral-400",
          },
          text(title(rng, 1)),
        ),
        h(
          "h3",
          { class: "text-base font-semibold leading-snug text-neutral-900" },
          text(title(rng, 3)),
        ),
        h(
          "p",
          { class: "line-clamp-2 text-sm text-neutral-500" },
          text(sentence(rng)),
        ),
        h(
          "div",
          { class: "flex items-center gap-0.5" },
          ...Array.from({ length: 5 }, (_, star) =>
            h(
              "svg",
              {
                xmlns: "http://www.w3.org/2000/svg",
                width: 14,
                height: 14,
                viewBox: "0 0 24 24",
                fill: star < rating ? "#f59e0b" : "#e5e5e5",
              },
              h("path", {
                d: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z",
              }),
            ),
          ),
          h(
            "span",
            { class: "ml-1 text-xs text-neutral-400" },
            text(`(${rng.int(3, 900)})`),
          ),
        ),
        h(
          "div",
          { class: "flex gap-1.5" },
          ...Array.from({ length: 5 }, () =>
            h("span", {
              class: "size-4 rounded-full ring-1 ring-neutral-200",
              style: `background: ${hexColor(rng)}`,
            }),
          ),
        ),
        h(
          "div",
          { class: "mt-auto flex items-center justify-between pt-2" },
          h(
            "div",
            { class: "flex items-baseline gap-2" },
            h(
              "span",
              { class: "text-lg font-semibold text-neutral-900" },
              text(`$${price}`),
            ),
            h(
              "span",
              { class: "text-sm text-neutral-400 line-through" },
              text(`$${price + rng.int(5, 90)}`),
            ),
          ),
          h(
            "button",
            {
              class: `rounded-lg bg-${to}-600 px-3 py-1.5 text-sm font-medium text-white`,
            },
            text("Add"),
          ),
        ),
      ),
    );
  });
  const body = h(
    "div",
    { class: "flex min-h-screen flex-col" },
    h(
      "header",
      {
        class:
          "flex items-center justify-between border-b border-neutral-200 bg-white px-10 py-4",
      },
      h(
        "span",
        { class: "font-['Fraunces'] text-2xl font-semibold" },
        text(`${title(rng, 1)} Supply ${copy + 1}`),
      ),
      h(
        "nav",
        { class: "flex gap-6 text-sm text-neutral-600" },
        ...Array.from({ length: 7 }, () =>
          h("a", { href: "#" }, text(title(rng, 1))),
        ),
      ),
      h(
        "div",
        { class: "flex gap-2" },
        icon(rng, 20),
        icon(rng, 20),
        icon(rng, 20),
      ),
    ),
    h(
      "div",
      { class: "flex gap-8 px-10 py-8" },
      h("aside", { class: "flex w-60 shrink-0 flex-col gap-4" }, ...filters),
      h("section", { class: "grid flex-1 grid-cols-4 gap-5" }, ...cards),
    ),
  );
  return {
    kind: "catalog",
    estimatedHeight: 26_000,
    html: documentShell({
      title: `Product catalog ${copy + 1}`,
      bodyClass: "bg-neutral-50 text-neutral-900",
      rootVars: "--color-primary: #171717; --radius: 16px;",
      body,
    }),
  };
}

function articleScreen(rng: Rng, copy: number): Screen {
  function richParagraph(): string {
    const parts: string[] = [];
    const sentences = rng.int(3, 6);
    for (let index = 0; index < sentences; index += 1) {
      const roll = rng.int(0, 7);
      if (roll === 0) {
        parts.push(
          h(
            "strong",
            { class: "font-semibold text-stone-900" },
            text(words(rng, 4)),
          ),
        );
      } else if (roll === 1) {
        parts.push(h("em", {}, text(words(rng, 3))));
      } else if (roll === 2) {
        parts.push(
          h(
            "a",
            {
              href: "#",
              class: `text-${rng.pick(HUES)}-700 underline decoration-2 underline-offset-2`,
            },
            text(words(rng, 3)),
          ),
        );
      } else if (roll === 3) {
        parts.push(
          h(
            "code",
            { class: "rounded bg-stone-200 px-1 font-mono text-[0.9em]" },
            text(rng.pick(WORDS)),
          ),
        );
      } else if (roll === 4) {
        parts.push(
          h(
            "span",
            {
              class: `bg-${rng.pick(HUES)}-100 text-${rng.pick(HUES)}-900`,
            },
            text(words(rng, 5)),
          ),
        );
      }
      parts.push(text(` ${sentence(rng)} `));
    }
    return h("p", { class: "text-lg leading-8 text-stone-700" }, ...parts);
  }
  const blocks: string[] = [];
  for (let index = 0; index < 110; index += 1) {
    if (index % 10 === 0) {
      blocks.push(
        h(
          "h2",
          {
            id: `section-${index}`,
            class:
              "pt-6 font-['Fraunces'] text-3xl font-semibold text-stone-900",
          },
          text(title(rng, rng.int(3, 6))),
        ),
      );
    }
    if (index % 13 === 6) {
      blocks.push(
        h(
          "blockquote",
          {
            class: `border-l-4 border-${rng.pick(HUES)}-500 pl-6 font-['Fraunces'] text-2xl italic text-stone-800`,
          },
          text(sentence(rng)),
        ),
      );
    }
    if (index % 17 === 9) {
      blocks.push(
        h(
          "ul",
          {
            class: "flex list-disc flex-col gap-2 pl-6 text-lg text-stone-700",
          },
          ...Array.from({ length: 4 }, () => h("li", {}, text(sentence(rng)))),
        ),
      );
    }
    if (index % 23 === 12) {
      blocks.push(
        h(
          "figure",
          { class: "flex flex-col gap-2" },
          h("div", {
            class: `h-80 rounded-xl bg-linear-to-tr from-${rng.pick(HUES)}-300 to-${rng.pick(HUES)}-700`,
          }),
          h(
            "figcaption",
            { class: "text-sm text-stone-500" },
            text(sentence(rng)),
          ),
        ),
      );
    }
    blocks.push(richParagraph());
  }
  const toc = Array.from({ length: 11 }, (_, index) =>
    h(
      "a",
      {
        href: `#section-${index * 10}`,
        class: "text-sm text-stone-500 hover:text-stone-900",
      },
      text(title(rng, 3)),
    ),
  );
  const body = h(
    "div",
    { class: "min-h-screen" },
    h(
      "header",
      {
        class:
          "flex items-center justify-between border-b border-stone-200 px-12 py-5",
      },
      h(
        "span",
        { class: "font-['Fraunces'] text-xl font-semibold" },
        text(`The ${title(rng, 1)} Review`),
      ),
      h(
        "nav",
        { class: "flex gap-6 text-sm text-stone-600" },
        ...Array.from({ length: 6 }, () =>
          h("a", { href: "#" }, text(title(rng, 1))),
        ),
      ),
    ),
    h(
      "div",
      { class: "mx-auto flex max-w-6xl gap-16 px-12 py-16" },
      h(
        "article",
        { class: "flex max-w-3xl flex-col gap-6" },
        h(
          "p",
          {
            class:
              "text-sm font-semibold uppercase tracking-widest text-amber-700",
          },
          text(title(rng, 2)),
        ),
        h(
          "h1",
          {
            class:
              "font-['Fraunces'] text-6xl font-semibold leading-tight text-stone-950",
          },
          text(`${title(rng, 5)} (${copy + 1})`),
        ),
        h("p", { class: "text-xl text-stone-600" }, text(sentence(rng))),
        h(
          "div",
          { class: "flex items-center gap-3 border-y border-stone-200 py-4" },
          avatar(rng, personName(rng), "size-10"),
          h(
            "div",
            { class: "flex flex-col" },
            h(
              "span",
              { class: "text-sm font-semibold" },
              text(personName(rng)),
            ),
            h(
              "span",
              { class: "text-xs text-stone-500" },
              text(`${rng.int(8, 40)} min read`),
            ),
          ),
        ),
        ...blocks,
      ),
      h(
        "aside",
        { class: "sticky top-8 flex h-fit w-56 flex-col gap-2" },
        h(
          "p",
          { class: "text-xs font-semibold uppercase text-stone-400" },
          text("Contents"),
        ),
        ...toc,
      ),
    ),
  );
  return {
    kind: "article",
    estimatedHeight: 27_500,
    html: documentShell({
      title: `Long-form article ${copy + 1}`,
      bodyClass: "bg-stone-50 text-stone-900",
      rootVars: "--color-primary: #1c1917; --radius: 12px;",
      body,
    }),
  };
}

function kanbanScreen(rng: Rng, copy: number): Screen {
  const columns = Array.from({ length: 6 }, () => {
    const hue = rng.pick(HUES);
    const cards = Array.from({ length: 40 }, () => {
      const done = rng.int(0, 8);
      const total = done + rng.int(0, 6);
      return h(
        "div",
        {
          class:
            "flex flex-col gap-2.5 rounded-xl border border-zinc-200 bg-white p-3 shadow-sm",
        },
        h(
          "div",
          { class: "flex flex-wrap gap-1" },
          ...Array.from({ length: rng.int(1, 3) }, () => {
            const tagHue = rng.pick(HUES);
            return h(
              "span",
              {
                class: `rounded bg-${tagHue}-100 px-1.5 py-0.5 text-[11px] font-medium text-${tagHue}-700`,
              },
              text(capitalize(rng.pick(WORDS))),
            );
          }),
        ),
        h(
          "p",
          { class: "text-sm font-medium text-zinc-900" },
          text(capitalize(words(rng, rng.int(4, 9)))),
        ),
        rng.chance(0.5)
          ? h("p", { class: "text-xs text-zinc-500" }, text(sentence(rng)))
          : "",
        total > 0
          ? h(
              "div",
              { class: "flex items-center gap-2" },
              h(
                "div",
                { class: "h-1 flex-1 rounded-full bg-zinc-100" },
                h("div", {
                  class: `h-full rounded-full bg-${hue}-500`,
                  style: `width: ${Math.round((done / Math.max(total, 1)) * 100)}%`,
                }),
              ),
              h(
                "span",
                { class: "text-[11px] tabular-nums text-zinc-500" },
                text(`${done}/${total}`),
              ),
            )
          : "",
        h(
          "div",
          { class: "flex items-center justify-between" },
          h(
            "div",
            { class: "flex -space-x-1.5" },
            ...Array.from({ length: rng.int(1, 3) }, () =>
              avatar(rng, personName(rng), "size-6"),
            ),
          ),
          h(
            "div",
            { class: "flex items-center gap-3 text-zinc-400" },
            h(
              "span",
              { class: "flex items-center gap-1 text-xs" },
              icon(rng, 14),
              h("span", {}, text(String(rng.int(0, 24)))),
            ),
            h(
              "span",
              { class: "flex items-center gap-1 text-xs" },
              icon(rng, 14),
              h("span", {}, text(String(rng.int(0, 9)))),
            ),
          ),
        ),
      );
    });
    return h(
      "section",
      {
        class: "flex min-w-0 flex-1 flex-col gap-3 rounded-2xl bg-zinc-100 p-3",
      },
      h(
        "div",
        { class: "flex items-center gap-2 px-1" },
        h("span", { class: `size-2 rounded-full bg-${hue}-500` }),
        h(
          "h2",
          { class: "text-sm font-semibold text-zinc-800" },
          text(title(rng, 2)),
        ),
        h(
          "span",
          { class: "ml-auto text-xs text-zinc-500" },
          text(String(cards.length)),
        ),
      ),
      ...cards,
    );
  });
  const body = h(
    "div",
    { class: "flex min-h-screen flex-col gap-6 p-8" },
    h(
      "header",
      { class: "flex items-center justify-between" },
      h(
        "h1",
        { class: "text-2xl font-semibold text-zinc-900" },
        text(`Sprint ${copy + 1}: ${title(rng, 2)}`),
      ),
      h(
        "div",
        { class: "flex gap-2" },
        h(
          "button",
          {
            class:
              "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium",
          },
          text("Filter"),
        ),
        h(
          "button",
          {
            class:
              "rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white",
          },
          text("New issue"),
        ),
      ),
    ),
    h("div", { class: "flex items-start gap-4" }, ...columns),
  );
  return {
    kind: "kanban",
    estimatedHeight: 9_000,
    html: documentShell({
      title: `Kanban board ${copy + 1}`,
      bodyClass: "bg-white text-zinc-900",
      rootVars: "--color-primary: #18181b; --radius: 12px;",
      body,
    }),
  };
}

function settingsScreen(rng: Rng, copy: number): Screen {
  function field(): string {
    const kind = rng.int(0, 3);
    const label = h(
      "label",
      { class: "text-sm font-medium text-gray-900" },
      text(title(rng, 2)),
    );
    const helper = h(
      "p",
      { class: "text-xs text-gray-500" },
      text(sentence(rng)),
    );
    let control: string;
    if (kind === 0) {
      control = h("input", {
        type: "text",
        value: words(rng, 2),
        class:
          "h-9 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900",
      });
    } else if (kind === 1) {
      control = h(
        "select",
        {
          class:
            "h-9 rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900",
        },
        ...Array.from({ length: 6 }, () =>
          h("option", {}, text(title(rng, 2))),
        ),
      );
    } else if (kind === 2) {
      control = h(
        "textarea",
        {
          rows: 3,
          class:
            "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900",
        },
        text(sentence(rng)),
      );
    } else {
      const on = rng.chance(0.5);
      control = h(
        "button",
        {
          role: "switch",
          "aria-checked": String(on),
          class: `relative h-6 w-11 rounded-full ${on ? "bg-blue-600" : "bg-gray-200"}`,
        },
        h("span", {
          class: `absolute top-0.5 size-5 rounded-full bg-white shadow ${on ? "left-5" : "left-0.5"}`,
        }),
      );
    }
    return h("div", { class: "flex flex-col gap-1.5" }, label, control, helper);
  }
  const sections = Array.from({ length: 30 }, (_, index) =>
    h(
      "section",
      {
        id: `settings-${index}`,
        class:
          "grid grid-cols-3 gap-8 rounded-xl border border-gray-200 bg-white p-6",
      },
      h(
        "div",
        { class: "flex flex-col gap-1" },
        h(
          "h3",
          { class: "text-base font-semibold text-gray-900" },
          text(title(rng, 2)),
        ),
        h("p", { class: "text-sm text-gray-500" }, text(sentence(rng))),
      ),
      h(
        "div",
        { class: "col-span-2 grid grid-cols-2 gap-5" },
        ...Array.from({ length: 6 }, () => field()),
      ),
    ),
  );
  const subnav = Array.from({ length: 24 }, (_, index) =>
    h(
      "a",
      {
        href: `#settings-${index}`,
        class: `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${index === 0 ? "bg-gray-100 font-medium text-gray-900" : "text-gray-600"}`,
      },
      icon(rng, 16),
      h("span", {}, text(title(rng, 2))),
    ),
  );
  const body = h(
    "div",
    { class: "flex min-h-screen gap-10 px-12 py-10" },
    h(
      "nav",
      { class: "flex w-60 shrink-0 flex-col gap-0.5" },
      h(
        "h1",
        { class: "px-3 pb-4 text-xl font-semibold text-gray-900" },
        text(`Settings ${copy + 1}`),
      ),
      ...subnav,
    ),
    h("div", { class: "flex flex-1 flex-col gap-6" }, ...sections),
  );
  return {
    kind: "settings",
    estimatedHeight: 14_000,
    html: documentShell({
      title: `Settings ${copy + 1}`,
      bodyClass: "bg-gray-50 text-gray-900",
      rootVars: "--color-primary: #2563eb; --radius: 8px;",
      body,
    }),
  };
}

function iconWallScreen(rng: Rng, copy: number): Screen {
  const tiles = Array.from({ length: 1400 }, () => {
    const hue = rng.pick(HUES);
    return h(
      "div",
      {
        class: `flex flex-col items-center gap-1.5 rounded-lg border border-${hue}-200 bg-${hue}-50 p-2 text-${hue}-700`,
      },
      icon(rng, 24),
      h(
        "span",
        { class: "w-full truncate text-center text-[10px]" },
        text(rng.pick(WORDS)),
      ),
    );
  });
  const body = h(
    "div",
    { class: "flex min-h-screen flex-col gap-6 p-10" },
    h(
      "h1",
      { class: "text-3xl font-semibold text-slate-900" },
      text(`Icon library ${copy + 1}: ${tiles.length} glyphs`),
    ),
    h("div", { class: "grid grid-cols-16 gap-2" }, ...tiles),
  );
  return {
    kind: "icons",
    estimatedHeight: 6_600,
    html: documentShell({
      title: `Icon library ${copy + 1}`,
      bodyClass: "bg-white text-slate-900",
      rootVars: "--color-primary: #0f172a; --radius: 8px;",
      body,
    }),
  };
}

function absoluteScreen(rng: Rng, copy: number): Screen {
  const groupWidth = 320;
  const groupHeight = 260;
  const columns = 4;
  const groupCount = 56;
  function node(depth: number, width: number, height: number): string {
    const children: string[] = [];
    const childCount = depth < 4 ? rng.int(3, 5) : rng.int(2, 3);
    for (let index = 0; index < childCount; index += 1) {
      const childWidth = Math.max(
        24,
        Math.round(width * (0.3 + rng.float() * 0.4)),
      );
      const childHeight = Math.max(
        16,
        Math.round(height * (0.2 + rng.float() * 0.3)),
      );
      const left = rng.int(4, Math.max(4, width - childWidth - 4));
      const top = rng.int(4, Math.max(4, height - childHeight - 4));
      if (depth >= 5 || rng.chance(0.35)) {
        children.push(
          h(
            "div",
            {
              style: `position:absolute;left:${left}px;top:${top}px;width:${childWidth}px;font-family:Inter,sans-serif;font-size:${rng.int(10, 16)}px;font-weight:${rng.pick([400, 500, 600, 700])};line-height:1.3;color:${hexColor(rng)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
            },
            text(title(rng, 2)),
          ),
        );
      } else {
        children.push(
          h(
            "div",
            {
              style: `position:absolute;left:${left}px;top:${top}px;width:${childWidth}px;height:${childHeight}px;background:${hexColor(rng)};border-radius:${rng.int(0, 12)}px;${rng.chance(0.3) ? `box-shadow:0 ${rng.int(1, 8)}px ${rng.int(4, 24)}px rgba(0,0,0,0.${rng.int(1, 3)});` : ""}${rng.chance(0.3) ? `border:1px solid ${hexColor(rng)};` : ""}overflow:hidden`,
            },
            depth < 5 ? node(depth + 1, childWidth, childHeight) : "",
          ),
        );
      }
    }
    return children.join("");
  }
  const groups = Array.from({ length: groupCount }, (_, index) => {
    const left = 40 + (index % columns) * (groupWidth + 30);
    const top = 120 + Math.floor(index / columns) * (groupHeight + 30);
    return h(
      "div",
      {
        style: `position:absolute;left:${left}px;top:${top}px;width:${groupWidth}px;height:${groupHeight}px;background:${hexColor(rng)};border-radius:16px;overflow:hidden`,
      },
      node(1, groupWidth, groupHeight),
    );
  });
  const rows = Math.ceil(groupCount / columns);
  const height = 120 + rows * (groupHeight + 30) + 40;
  const body = h(
    "div",
    {
      style: `position:relative;width:1440px;height:${height}px;background:#f4f1ea;overflow:hidden`,
    },
    h(
      "div",
      {
        style:
          "position:absolute;left:40px;top:40px;width:900px;font-family:Inter,sans-serif;font-size:32px;font-weight:700;color:#1f2937",
      },
      text(`Figma-style absolute layout ${copy + 1}`),
    ),
    ...groups,
  );
  return {
    kind: "absolute",
    estimatedHeight: height,
    html: documentShell({
      title: `Absolute layout ${copy + 1}`,
      bodyClass: "m-0",
      rootVars: "--color-primary: #1f2937;",
      body,
    }),
  };
}

const ARCHETYPES = [
  dashboardScreen,
  nestedScreen,
  catalogScreen,
  articleScreen,
  kanbanScreen,
  settingsScreen,
  iconWallScreen,
  absoluteScreen,
];

async function postAction<T>(name: string, input: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${name} failed: ${response.status} ${body.slice(0, 600)}`);
  }
  return JSON.parse(body) as T;
}

function countElements(html: string): number {
  return html.match(/<[a-zA-Z][^>]*>/g)?.length ?? 0;
}

const designTitle =
  values.title ?? `Perf stress - ${copies * ARCHETYPES.length} screens`;
const created = await postAction<{ id: string }>("create-design", {
  title: designTitle,
  projectType: "prototype",
});
const designId = created.id;
console.log(`design ${designId} "${designTitle}"`);

const placements: { fileId: string; x: number; y: number; height: number }[] =
  [];
let totalBytes = 0;
let totalElements = 0;
for (const [column, archetype] of ARCHETYPES.entries()) {
  let columnY = 0;
  for (let copy = 0; copy < copies; copy += 1) {
    const screen = archetype(new Rng(column * 1000 + copy + 1), copy);
    const filename = `${screen.kind}-${copy + 1}.html`;
    const startedAt = performance.now();
    const file = await postAction<{ id: string; warnings?: string[] }>(
      "create-file",
      { designId, filename, content: screen.html, fileType: "html" },
    );
    const elements = countElements(screen.html);
    totalBytes += screen.html.length;
    totalElements += elements;
    placements.push({
      fileId: file.id,
      x: column * (SCREEN_WIDTH + COLUMN_GAP),
      y: columnY,
      height: screen.estimatedHeight,
    });
    columnY += screen.estimatedHeight + ROW_GAP;
    console.log(
      `  ${filename.padEnd(18)} ${String(elements).padStart(6)} elements ${(screen.html.length / 1024).toFixed(0).padStart(5)} KB  ${Math.round(performance.now() - startedAt)} ms${file.warnings?.length ? `  warnings: ${file.warnings.join("; ")}` : ""}`,
    );
  }
}

await postAction("update-design", {
  id: designId,
  dataOperations: placements.flatMap((placement) => [
    {
      op: "set",
      path: ["canvasFrames", placement.fileId, "x"],
      value: placement.x,
    },
    {
      op: "set",
      path: ["canvasFrames", placement.fileId, "y"],
      value: placement.y,
    },
    {
      op: "set",
      path: ["canvasFrames", placement.fileId, "height"],
      value: placement.height,
    },
  ]),
});

console.log(
  `\n${placements.length} screens, ${totalElements.toLocaleString()} authored elements, ${(totalBytes / 1024 / 1024).toFixed(1)} MB of HTML`,
);
console.log(`${baseUrl}/design/${encodeURIComponent(designId)}`);
