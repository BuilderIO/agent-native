// A numeric cell sorts by its exact decimal value. Number() rounds anything
// past 2^53 (9007199254740993 and 9007199254740992.5 read as equal), so the
// text is compared as sign, decimal-point position and significant digits.
interface DecimalMagnitude {
  sign: -1 | 0 | 1;
  // value = 0.<digits> * 10^pointPosition, digits without leading/trailing zeros
  digits: string;
  pointPosition: bigint;
}

const DECIMAL = /^([+-]?)(\d+\.?\d*|\.\d+)(?:e([+-]?\d+))?$/i;

function parseDecimal(text: string): DecimalMagnitude | null {
  const match = DECIMAL.exec(text.trim());
  if (!match) return null;
  const [, sign = "", mantissa = "", exponent] = match;
  const [whole = "", fraction = ""] = mantissa.split(".");
  const all = whole + fraction;
  const significant = all.replace(/^0+/, "").replace(/0+$/, "");
  if (significant === "") return { sign: 0, digits: "", pointPosition: 0n };
  const leadingZeros = all.length - all.replace(/^0+/, "").length;
  return {
    sign: sign === "-" ? -1 : 1,
    digits: significant,
    pointPosition:
      BigInt(whole.length - leadingZeros) + BigInt(exponent ?? "0"),
  };
}

function compareMagnitude(a: DecimalMagnitude, b: DecimalMagnitude): number {
  if (a.pointPosition !== b.pointPosition)
    return a.pointPosition < b.pointPosition ? -1 : 1;
  return a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0;
}

/** Orders two numeric texts exactly, or null when either is not a number. */
export function compareNumericText(a: string, b: string): number | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return null;
  if (left.sign !== right.sign) return left.sign < right.sign ? -1 : 1;
  return left.sign === -1
    ? compareMagnitude(right, left)
    : compareMagnitude(left, right);
}
