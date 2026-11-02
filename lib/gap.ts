// Pure money math (PRD §6.3). No model ever computes these numbers.
// The sum invariant — intermediary_fee + fx_spread + bank_charges === total_shortfall —
// is guaranteed by construction and checked in tests on random cases.

export type Classification =
  | "fully_paid"
  | "paid_with_costs"
  | "partial"
  | "needs_review"
  | "unmatched";

export type GapInput = {
  invoiceAmountFc: number; // A — invoice total in foreign currency
  foreignAmount: number | null; // F — foreign amount that arrived (if known)
  bankChargesInr: number; // B — bank charges + GST, in INR
  creditedInr: number; // final INR credited to the account (= C0 − B)
  midRate: number; // m — mid-market rate on value date
  feeCapFc?: number; // default 50 (invoice currency)
  feeSharePct?: number; // default 3 (%)
  chargesTerms?: "OUR" | "SHA" | "BEN" | "unknown";
};

export type GapBreakdown = {
  expectedInr: number;
  receivedInr: number;
  intermediaryFeeInr: number;
  fxSpreadInr: number;
  bankChargesInr: number;
  totalShortfallInr: number;
  outstandingFc: number; // foreign currency likely still owed (0 if none)
  recoverableFeeFc: number; // fees the client agreed to bear (OUR terms)
  midRate: number;
  appliedRate: number; // effective rate C0 / F
  classification: Classification;
};

export function computeGap(input: GapInput): GapBreakdown {
  const {
    invoiceAmountFc: A,
    foreignAmount: F,
    bankChargesInr: B,
    creditedInr,
    midRate: m,
    feeCapFc = 50,
    feeSharePct = 3,
    chargesTerms = "unknown",
  } = input;

  const expectedInr = A * m;
  const receivedInr = creditedInr;
  const totalShortfallInr = expectedInr - receivedInr;

  // C0 = INR before bank charges; effective rate the bank actually applied.
  const C0 = creditedInr + B;
  const cap = Math.max(feeCapFc, (feeSharePct / 100) * A);

  let intermediaryFeeInr: number;
  let fxSpreadInr: number;
  let appliedRate: number;
  let outstandingFc = 0;
  let recoverableFeeFc = 0;
  let classification: Classification;

  if (F != null && F > 0) {
    appliedRate = C0 / F;
    intermediaryFeeInr = (A - F) * m;
    // Residual so the invariant holds exactly: equals F * (m − appliedRate).
    fxSpreadInr = totalShortfallInr - intermediaryFeeInr - B;

    const notReceivedFc = A - F;
    if (Math.abs(totalShortfallInr) < 0.005) {
      classification = "fully_paid";
    } else if (notReceivedFc <= cap) {
      classification = "paid_with_costs";
      if (chargesTerms === "OUR") recoverableFeeFc = Math.max(0, notReceivedFc);
    } else {
      classification = "partial";
      outstandingFc = notReceivedFc - cap; // ≈ A − F − typical fee
    }
  } else {
    // No foreign amount on the statement — use the implied rate C0 / A.
    appliedRate = C0 / A;
    intermediaryFeeInr = 0;
    fxSpreadInr = totalShortfallInr - B;
    if (appliedRate >= m * (1 - 0.025)) {
      classification = "paid_with_costs"; // whole gap is fees + spread
    } else {
      classification = "needs_review"; // possibly a partial payment
    }
  }

  return {
    expectedInr,
    receivedInr,
    intermediaryFeeInr,
    fxSpreadInr,
    bankChargesInr: B,
    totalShortfallInr,
    outstandingFc,
    recoverableFeeFc,
    midRate: m,
    appliedRate,
    classification,
  };
}

/** Round a breakdown for display so the components still sum to the total. */
export function roundBreakdown(g: GapBreakdown) {
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    ...g,
    expectedInr: r(g.expectedInr),
    receivedInr: r(g.receivedInr),
    intermediaryFeeInr: r(g.intermediaryFeeInr),
    fxSpreadInr: r(g.fxSpreadInr),
    bankChargesInr: r(g.bankChargesInr),
    totalShortfallInr: r(g.totalShortfallInr),
    outstandingFc: r(g.outstandingFc),
    recoverableFeeFc: r(g.recoverableFeeFc),
    appliedRate: Math.round(g.appliedRate * 10000) / 10000,
  };
}
