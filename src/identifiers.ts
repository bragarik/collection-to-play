export function normalizeProductCode(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/[\s-]/g, "");
  if (!/^\d{12,13}$/.test(digits) || /^0+$/.test(digits)) return undefined;
  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index--, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[index]) * weight;
  }
  return (10 - sum % 10) % 10 === Number(digits.at(-1)) ? digits : undefined;
}

export function productCodesMatch(first: string | undefined, second: string | undefined): boolean {
  const a = normalizeProductCode(first);
  const b = normalizeProductCode(second);
  return Boolean(a && b && a.padStart(13, "0") === b.padStart(13, "0"));
}

export function productCodeVariants(...values: (string | undefined)[]): readonly string[] {
  const variants = new Set<string>();
  for (const value of values) {
    const code = normalizeProductCode(value);
    if (!code) continue;
    variants.add(code);
    if (code.length === 12) variants.add(`0${code}`);
    else if (code.startsWith("0")) variants.add(code.slice(1));
  }
  return [...variants];
}
