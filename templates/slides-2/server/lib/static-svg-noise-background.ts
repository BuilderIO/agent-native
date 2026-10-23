export type SvgNoiseBackgroundOptions = {
  baseFrequency: number;
  numOctaves: number;
  seed: number;
  opacity: number;
  fill: string;
  dataSlideLoc?: string;
};

export const SVG_NOISE_COLOR_MATRIX_VALUES =
  "0 0 0 0 0.85 0 0 0 0 0.93 0 0 0 0 1 1 0 0 0 0";

export function normalizeSvgNoiseBackgroundProps(
  value: unknown,
): SvgNoiseBackgroundOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const props = value as Record<string, unknown>;
  const allowed = new Set([
    "baseFrequency",
    "numOctaves",
    "seed",
    "opacity",
    "fill",
    "data-slide-loc",
  ]);
  if (Object.keys(props).some((key) => !allowed.has(key))) return null;

  const baseFrequency = props.baseFrequency ?? 0.012;
  const numOctaves = props.numOctaves ?? 3;
  const seed = props.seed ?? 4;
  const opacity = props.opacity ?? 0.2;
  const fill = props.fill ?? "white";
  const dataSlideLoc = props["data-slide-loc"];

  if (
    typeof baseFrequency !== "number" ||
    !Number.isFinite(baseFrequency) ||
    baseFrequency < 0.0001 ||
    baseFrequency > 1 ||
    typeof numOctaves !== "number" ||
    !Number.isInteger(numOctaves) ||
    numOctaves < 1 ||
    numOctaves > 4 ||
    typeof seed !== "number" ||
    !Number.isFinite(seed) ||
    Math.abs(seed) > 10_000 ||
    typeof opacity !== "number" ||
    !Number.isFinite(opacity) ||
    opacity < 0 ||
    opacity > 1 ||
    typeof fill !== "string" ||
    !/^(?:white|#[0-9a-f]{3}(?:[0-9a-f]{3})?)$/i.test(fill) ||
    (dataSlideLoc !== undefined &&
      (typeof dataSlideLoc !== "string" ||
        !/^\d{1,6}:\d{1,6}$/.test(dataSlideLoc)))
  ) {
    return null;
  }

  return {
    baseFrequency,
    numOctaves,
    seed,
    opacity,
    fill,
    ...(typeof dataSlideLoc === "string" ? { dataSlideLoc } : {}),
  };
}

export function isSafeStaticSvgNoiseBackgroundCssValue(
  value: unknown,
): boolean {
  const MAX_URL_LENGTH = 24_576;
  const MAX_XML_LENGTH = 8_192;
  const MAX_DIMENSION = 512;
  const MAX_PIXEL_AREA = 262_144;
  const MAX_BASE_FREQUENCY = 1;
  const MIN_BASE_FREQUENCY = 0.0001;
  const MAX_OCTAVES = 4;
  const MAX_MATRIX_VALUE = 100;
  const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
  const ID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;

  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return false;

  const url =
    /^url\(\s*(["'])(data:image\/svg\+xml(?:;charset=utf-8)?(?:;base64)?),((?:(?!\1)[^\\\s])*)\1\s*\)$/i.exec(
      value,
    );
  if (!url) return false;

  const prefix = url[2]!.toLowerCase();
  const payload = url[3]!;
  if (!payload || /[<>#\\\u0000-\u001f\u007f]/.test(payload)) return false;

  let xml: string;
  if (prefix.endsWith(";base64")) {
    if (
      payload.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        payload,
      )
    ) {
      return false;
    }

    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const bytes: number[] = [];
    for (let index = 0; index < payload.length; index += 4) {
      const a = alphabet.indexOf(payload[index]!);
      const b = alphabet.indexOf(payload[index + 1]!);
      const c =
        payload[index + 2] === "=" ? 0 : alphabet.indexOf(payload[index + 2]!);
      const d =
        payload[index + 3] === "=" ? 0 : alphabet.indexOf(payload[index + 3]!);
      if (a < 0 || b < 0 || c < 0 || d < 0) return false;
      bytes.push((a << 2) | (b >> 4));
      if (payload[index + 2] !== "=") bytes.push(((b & 15) << 4) | (c >> 2));
      if (payload[index + 3] !== "=") bytes.push(((c & 3) << 6) | d);
    }
    if (bytes.length > MAX_XML_LENGTH) return false;

    let canonicalBase64 = "";
    for (let index = 0; index < bytes.length; index += 3) {
      const a = bytes[index]!;
      const hasB = index + 1 < bytes.length;
      const hasC = index + 2 < bytes.length;
      const b = hasB ? bytes[index + 1]! : 0;
      const c = hasC ? bytes[index + 2]! : 0;
      canonicalBase64 +=
        alphabet[a >> 2]! +
        alphabet[((a & 3) << 4) | (b >> 4)]! +
        (hasB ? alphabet[((b & 15) << 2) | (c >> 6)]! : "=") +
        (hasC ? alphabet[c & 63]! : "=");
    }
    if (canonicalBase64 !== payload) return false;

    const escapedBytes = bytes
      .map((byte) => "%" + byte.toString(16).padStart(2, "0"))
      .join("");
    try {
      xml = decodeURIComponent(escapedBytes);
    } catch {
      // coercion-ok: invalid UTF-8 means the SVG data URL is unsafe.
      return false;
    }
  } else {
    try {
      xml = decodeURIComponent(payload);
    } catch {
      // coercion-ok: malformed percent escapes mean the SVG data URL is unsafe.
      return false;
    }
    const normalizeEscapes = (text: string) =>
      text.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
    let canonicalPayload: string;
    try {
      canonicalPayload = encodeURIComponent(xml);
    } catch {
      // coercion-ok: non-canonical XML encoding is rejected as unsafe SVG.
      return false;
    }
    if (normalizeEscapes(canonicalPayload) !== normalizeEscapes(payload))
      return false;
  }

  if (
    !xml ||
    xml.length > MAX_XML_LENGTH ||
    /[^\t\n\r\x20-\x7e]/.test(xml) ||
    xml.includes("&") ||
    xml.includes("<!") ||
    xml.includes("<?")
  ) {
    return false;
  }

  function parseTag(source: string) {
    const body = source.slice(1, -1);
    const closing = body.startsWith("/");
    const content = closing ? body.slice(1) : body;
    const nameMatch = /^([A-Za-z][A-Za-z0-9]*)/.exec(content);
    if (!nameMatch) return null;
    const name = nameMatch[1]!;
    let position = nameMatch[0].length;
    const attributes: Record<string, string> = Object.create(null);
    let selfClosing = false;

    while (position < content.length) {
      const separatorStart = position;
      while (/\s/.test(content[position] ?? "")) position++;
      const hasSeparator = position > separatorStart;
      if (position >= content.length) break;
      if (content[position] === "/") {
        if (closing || content.slice(position + 1).trim()) return null;
        selfClosing = true;
        position = content.length;
        break;
      }
      if (closing) return null;
      if (!hasSeparator) return null;

      const attributeMatch = /^[A-Za-z][A-Za-z0-9]*/.exec(
        content.slice(position),
      );
      if (!attributeMatch) return null;
      const attributeName = attributeMatch[0];
      if (Object.hasOwn(attributes, attributeName)) return null;
      position += attributeName.length;
      while (/\s/.test(content[position] ?? "")) position++;
      if (content[position] !== "=") return null;
      position++;
      while (/\s/.test(content[position] ?? "")) position++;
      const quote = content[position];
      if (quote !== "'" && quote !== '"') return null;
      position++;
      const valueStart = position;
      while (position < content.length && content[position] !== quote) {
        if (/[<>&]/.test(content[position]!)) return null;
        position++;
      }
      if (position >= content.length) return null;
      attributes[attributeName] = content.slice(valueStart, position);
      position++;
    }

    if (closing && content.slice(name.length).trim()) return null;
    return { name, closing, selfClosing, attributes };
  }

  function onlyAttributes(
    attributes: Record<string, string>,
    allowed: string[],
    required: string[],
  ) {
    const keys = Object.keys(attributes);
    return (
      keys.every((key) => allowed.includes(key)) &&
      required.every((key) => Object.hasOwn(attributes, key))
    );
  }

  function parseNumbers(source: string, minCount: number, maxCount: number) {
    const trimmed = source.trim();
    if (!trimmed || /^[,]|[,]$|,\s*,/.test(trimmed)) return null;
    const parts = trimmed.split(/\s*,\s*|\s+/);
    if (parts.length < minCount || parts.length > maxCount) return null;
    const numbers: number[] = [];
    for (const part of parts) {
      if (!NUMERIC.test(part)) return null;
      const number = Number(part);
      if (!Number.isFinite(number)) return null;
      numbers.push(number);
    }
    return numbers;
  }

  let cursor = 0;
  const tags: ReturnType<typeof parseTag>[] = [];
  while (cursor < xml.length) {
    const opening = xml.indexOf("<", cursor);
    if (opening === -1) {
      if (xml.slice(cursor).trim()) return false;
      break;
    }
    if (xml.slice(cursor, opening).trim()) return false;
    const closing = xml.indexOf(">", opening + 1);
    if (
      closing === -1 ||
      (xml.indexOf("<", opening + 1) !== -1 &&
        xml.indexOf("<", opening + 1) < closing)
    ) {
      return false;
    }
    const tag = parseTag(xml.slice(opening, closing + 1));
    if (!tag) return false;
    tags.push(tag);
    if (tags.length > 7) return false;
    cursor = closing + 1;
  }

  const expected = [
    ["svg", false, false],
    ["filter", false, false],
    ["feTurbulence", false, true],
    ["feColorMatrix", false, true],
    ["filter", true, false],
    ["rect", false, true],
    ["svg", true, false],
  ];
  if (
    tags.length !== expected.length ||
    tags.some((tag, index) => {
      const specification = expected[index]!;
      return (
        !tag ||
        tag.name !== specification[0] ||
        tag.closing !== specification[1] ||
        tag.selfClosing !== specification[2]
      );
    })
  ) {
    return false;
  }

  const root = tags[0]!.attributes;
  if (
    !onlyAttributes(
      root,
      ["xmlns", "width", "height", "viewBox"],
      ["xmlns", "width", "height"],
    ) ||
    root.xmlns !== "http://www.w3.org/2000/svg"
  ) {
    return false;
  }
  const dimensions = [root.width, root.height];
  const parsedDimensions: number[] = [];
  for (const dimension of dimensions) {
    if (!dimension || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(dimension))
      return false;
    const number = Number(dimension);
    if (!Number.isFinite(number) || number < 1 || number > MAX_DIMENSION)
      return false;
    parsedDimensions.push(number);
  }
  if (parsedDimensions[0]! * parsedDimensions[1]! > MAX_PIXEL_AREA)
    return false;
  if (root.viewBox !== undefined) {
    const viewBox = parseNumbers(root.viewBox, 4, 4);
    if (
      !viewBox ||
      viewBox[0]! < -MAX_DIMENSION ||
      viewBox[0]! > MAX_DIMENSION ||
      viewBox[1]! < -MAX_DIMENSION ||
      viewBox[1]! > MAX_DIMENSION ||
      viewBox[2]! < 1 ||
      viewBox[2]! > MAX_DIMENSION ||
      viewBox[3]! < 1 ||
      viewBox[3]! > MAX_DIMENSION ||
      viewBox[2]! * viewBox[3]! > MAX_PIXEL_AREA
    ) {
      return false;
    }
  }

  const filter = tags[1]!.attributes;
  if (
    !onlyAttributes(
      filter,
      ["id", "x", "y", "width", "height"],
      ["id", "x", "y", "width", "height"],
    ) ||
    !ID.test(filter.id!) ||
    filter.x !== "0" ||
    filter.y !== "0" ||
    filter.width !== "100%" ||
    filter.height !== "100%"
  ) {
    return false;
  }

  const turbulence = tags[2]!.attributes;
  if (
    !onlyAttributes(
      turbulence,
      ["type", "baseFrequency", "numOctaves", "seed", "stitchTiles", "result"],
      ["type", "baseFrequency", "numOctaves", "stitchTiles"],
    ) ||
    turbulence.type !== "fractalNoise" ||
    turbulence.stitchTiles !== "stitch"
  ) {
    return false;
  }
  const frequencies = parseNumbers(turbulence.baseFrequency!, 1, 2);
  if (
    !frequencies ||
    frequencies.some(
      (frequency) =>
        frequency < MIN_BASE_FREQUENCY || frequency > MAX_BASE_FREQUENCY,
    ) ||
    !/^\d+$/.test(turbulence.numOctaves!) ||
    Number(turbulence.numOctaves) < 1 ||
    Number(turbulence.numOctaves) > MAX_OCTAVES
  ) {
    return false;
  }
  if (
    turbulence.seed !== undefined &&
    (!NUMERIC.test(turbulence.seed) ||
      !Number.isFinite(Number(turbulence.seed)) ||
      Math.abs(Number(turbulence.seed)) > 10_000)
  ) {
    return false;
  }
  if (turbulence.result !== undefined && !ID.test(turbulence.result))
    return false;

  const colorMatrix = tags[3]!.attributes;
  if (
    !onlyAttributes(
      colorMatrix,
      ["type", "values", "in", "result"],
      ["type", "values"],
    ) ||
    colorMatrix.type !== "matrix"
  ) {
    return false;
  }
  const matrix = parseNumbers(colorMatrix.values!, 20, 20);
  if (
    !matrix ||
    matrix.some((number) => Math.abs(number) > MAX_MATRIX_VALUE) ||
    (colorMatrix.in !== undefined &&
      (!turbulence.result || colorMatrix.in !== turbulence.result)) ||
    (colorMatrix.result !== undefined && !ID.test(colorMatrix.result))
  ) {
    return false;
  }

  const rect = tags[5]!.attributes;
  if (
    !onlyAttributes(
      rect,
      ["width", "height", "x", "y", "filter", "opacity", "fill"],
      ["width", "height", "filter"],
    ) ||
    rect.width !== root.width ||
    rect.height !== root.height ||
    (rect.x !== undefined && (!NUMERIC.test(rect.x) || Number(rect.x) !== 0)) ||
    (rect.y !== undefined && (!NUMERIC.test(rect.y) || Number(rect.y) !== 0)) ||
    rect.filter !== `url(#${filter.id})`
  ) {
    return false;
  }
  if (
    rect.opacity !== undefined &&
    (!NUMERIC.test(rect.opacity) ||
      !Number.isFinite(Number(rect.opacity)) ||
      Number(rect.opacity) < 0 ||
      Number(rect.opacity) > 1)
  ) {
    return false;
  }
  if (
    rect.fill !== undefined &&
    !/^(?:black|white|#[0-9a-f]{3}(?:[0-9a-f])?|#[0-9a-f]{6}(?:[0-9a-f]{2})?)$/i.test(
      rect.fill,
    )
  ) {
    return false;
  }

  return true;
}
