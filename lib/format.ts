// Display formatters. In the real app these numbers come from gap.ts (PRD §6.3);
// here they are layout placeholders per STITCH_PROMPTS.md.

/** Indian digit grouping with ₹ sign, e.g. ₹1,65,507.50 */
export function inr(amount: number): string {
  const neg = amount < 0;
  const n = Math.abs(amount).toFixed(2);
  const [whole, frac] = n.split(".");
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped =
    (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : "") + last3;
  return `${neg ? "−" : ""}₹${grouped}.${frac}`;
}

/** ISO code first, e.g. USD 2,000.00 */
export function fc(code: string, amount: number): string {
  const neg = amount < 0;
  const grouped = Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${code} ${neg ? "−" : ""}${grouped}`;
}
