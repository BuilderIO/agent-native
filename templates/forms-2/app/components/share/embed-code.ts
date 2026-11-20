export const EMBED_KINDS = ["standard", "popup", "fullPage"] as const;
export type EmbedKind = (typeof EMBED_KINDS)[number];

export const POPUP_TRIGGERS = ["click", "load", "delay"] as const;
export type PopupTrigger = (typeof POPUP_TRIGGERS)[number];

export const POPUP_POSITIONS = ["center", "bottomRight", "bottomLeft"] as const;
export type PopupPosition = (typeof POPUP_POSITIONS)[number];

export type EmbedOptions = {
  height: number;
  dynamicHeight: boolean;
  hideTitle: boolean;
  alignLeft: boolean;
  transparentBackground: boolean;
  trackEvents: boolean;
  trigger: PopupTrigger;
  position: PopupPosition;
  width: number;
  overlay: boolean;
};

export const DEFAULT_EMBED_OPTIONS: EmbedOptions = {
  height: 200,
  dynamicHeight: true,
  hideTitle: true,
  alignLeft: true,
  transparentBackground: true,
  trackEvents: false,
  trigger: "click",
  position: "center",
  width: 376,
  overlay: true,
};

/** Which on/off options each kind carries into the URL, in URL order. */
const FLAGS: Record<EmbedKind, readonly (keyof EmbedOptions)[]> = {
  standard: [
    "alignLeft",
    "hideTitle",
    "transparentBackground",
    "dynamicHeight",
    "trackEvents",
  ],
  popup: ["alignLeft", "hideTitle", "dynamicHeight", "trackEvents"],
  fullPage: ["transparentBackground", "trackEvents"],
};

/** Options that are off are left out of the query, not written as 0. */
export function embedQuery(
  kind: EmbedKind,
  options: EmbedOptions,
  { withoutTracking = false } = {},
): string {
  const effective =
    kind === "popup" ? { ...options, dynamicHeight: true } : options;
  const params = FLAGS[kind]
    .filter((flag) => effective[flag] === true)
    .filter((flag) => !(withoutTracking && flag === "trackEvents"))
    .map((flag) => `${flag}=1`);
  return params.join("&");
}

export function embedUrl(
  origin: string,
  formId: string,
  kind: EmbedKind,
  options: EmbedOptions,
  flags: { withoutTracking?: boolean } = {},
): string {
  const query = embedQuery(kind, options, flags);
  return `${origin}/embed/${formId}${query ? `?${query}` : ""}`;
}

export const EMBED_SCRIPT_PATH = "/forms-embed.js";

export function embedCode(
  origin: string,
  formId: string,
  kind: EmbedKind,
  options: EmbedOptions,
): string {
  const url = embedUrl(origin, formId, kind, options);
  const script = `<script async src="${origin}${EMBED_SCRIPT_PATH}"></script>`;
  if (kind === "standard") {
    const frame = `<iframe data-forms-embed="${formId}" src="${url}" width="100%" height="${options.height}" frameborder="0" marginheight="0" marginwidth="0" title="Form"></iframe>`;
    return options.dynamicHeight ? `${frame}\n${script}` : frame;
  }
  if (kind === "popup") {
    const query = embedQuery("popup", options);
    const attributes = [
      `data-forms-popup="${formId}"`,
      `data-forms-open="${options.trigger}"`,
      `data-forms-position="${options.position}"`,
      `data-forms-width="${options.width}"`,
      ...(options.overlay ? ['data-forms-overlay="1"'] : []),
      ...(query ? [`data-forms-query="${query}"`] : []),
    ].join(" ");
    const element =
      options.trigger === "click"
        ? `<button type="button" ${attributes}>Open form</button>`
        : `<div ${attributes}></div>`;
    return `${element}\n${script}`;
  }
  return [
    "<html>",
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    "    <title>Form</title>",
    "    <style>",
    "      html, body { margin: 0; height: 100%; }",
    "      iframe { position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 0; }",
    "    </style>",
    "  </head>",
    "  <body>",
    `    <iframe src="${url}" title="Form"></iframe>`,
    "  </body>",
    "</html>",
  ].join("\n");
}
