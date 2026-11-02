import { describe, it, expect } from "vitest";
import { computeGap } from "@/lib/gap";

describe("computeGap", () => {
  it("reproduces the PRD §6.3 worked example exactly", () => {
    // USD 2,000 invoice; USD 1,975 arrives; rate 84.10 vs mid 84.95; ₹590 charges.
    const F = 1975;
    const r = 84.1;
    const B = 590;
    const credited = F * r - B; // 165,507.50
    const g = computeGap({
      invoiceAmountFc: 2000,
      foreignAmount: F,
      bankChargesInr: B,
      creditedInr: credited,
      midRate: 84.95,
    });
    expect(g.expectedInr).toBeCloseTo(169900, 2);
    expect(g.receivedInr).toBeCloseTo(165507.5, 2);
    expect(g.intermediaryFeeInr).toBeCloseTo(2123.75, 2);
    expect(g.fxSpreadInr).toBeCloseTo(1678.75, 2);
    expect(g.bankChargesInr).toBeCloseTo(590, 2);
    expect(g.totalShortfallInr).toBeCloseTo(4392.5, 2);
    expect(g.classification).toBe("paid_with_costs");
  });

  it("holds the sum invariant on 1,000 random consistent cases", () => {
    let maxErr = 0;
    for (let n = 0; n < 1000; n++) {
      const A = 100 + Math.random() * 5000;
      const F = A * (0.6 + Math.random() * 0.4); // 60–100% arrives
      const m = 70 + Math.random() * 50;
      const r = m * (0.95 + Math.random() * 0.06); // bank rate near/below mid
      const B = Math.random() * 1500;
      const credited = F * r - B;
      const g = computeGap({
        invoiceAmountFc: A,
        foreignAmount: F,
        bankChargesInr: B,
        creditedInr: credited,
        midRate: m,
      });
      const sum = g.intermediaryFeeInr + g.fxSpreadInr + g.bankChargesInr;
      maxErr = Math.max(maxErr, Math.abs(sum - g.totalShortfallInr));
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("classifies a clear partial payment", () => {
    // USD 3,000 invoice; only USD 2,550 arrived (USD 450 short, > USD 50 cap).
    const F = 2550;
    const m = 84.95;
    const r = 84.5;
    const B = 590;
    const g = computeGap({
      invoiceAmountFc: 3000,
      foreignAmount: F,
      bankChargesInr: B,
      creditedInr: F * r - B,
      midRate: m,
    });
    expect(g.classification).toBe("partial");
    // typical fee = cap = max(50, 3% × 3000) = 90, so outstanding = 450 − 90.
    expect(g.outstandingFc).toBeCloseTo(360, 2);
  });

  it("flags recoverable fees when the client bears charges (OUR)", () => {
    const F = 1975;
    const g = computeGap({
      invoiceAmountFc: 2000,
      foreignAmount: F,
      bankChargesInr: 590,
      creditedInr: F * 84.1 - 590,
      midRate: 84.95,
      chargesTerms: "OUR",
    });
    expect(g.classification).toBe("paid_with_costs");
    expect(g.recoverableFeeFc).toBeCloseTo(25, 2);
  });
});
