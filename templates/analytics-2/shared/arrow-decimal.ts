export function decimalText(
  words: Uint32Array,
  scale: number,
  preserveDecimalScale: boolean,
) {
  const coefficient = words.reduceRight(
    (result, word) => (result << 32n) | BigInt(word),
    0n,
  );
  const raw = BigInt.asIntN(words.length * 32, coefficient).toString();
  const sign = raw.startsWith("-") ? "-" : "";
  const unsigned = sign ? raw.slice(1) : raw;
  if (scale <= 0) return `${sign}${unsigned}${"0".repeat(-scale)}`;
  const digits = unsigned.padStart(scale + 1, "0");
  const fraction = preserveDecimalScale
    ? digits.slice(-scale)
    : digits.slice(-scale).replace(/0+$/, "");
  return `${sign}${digits.slice(0, -scale)}${fraction ? `.${fraction}` : ""}`;
}
