import { describe, it, expect } from "vitest";
import {
  parseDate, parseInvoiceNumber, parseMoney, parseName,
  groundTruthFromAnnotation, fieldMatch, emptyReport, tally, finalize,
} from "@/lib/eval/fatura";

describe("FATURA ground-truth normalizers", () => {
  it("parses DD-Mon-YYYY dates with labels", () => {
    expect(parseDate("Date: 01-Oct-2003")).toBe("2003-10-01");
    expect(parseDate("Due Date : 06-Jul-2012")).toBe("2012-07-06");
    expect(parseDate("Invoice Date: 04-May-2007")).toBe("2007-05-04");
    expect(parseDate(null)).toBeNull();
    expect(parseDate("no date here")).toBeNull();
  });

  it("pulls the invoice id out of labeled text", () => {
    expect(parseInvoiceNumber("INVOICE ID 7199-209")).toBe("7199-209");
    expect(parseInvoiceNumber("Invoice number 1962-389")).toBe("1962-389");
    expect(parseInvoiceNumber(null)).toBeNull();
  });

  it("parses amount + currency from totals", () => {
    expect(parseMoney("TOTAL : 663.70 USD")).toEqual({ amount: 663.7, currency: "USD" });
    expect(parseMoney("DUE_AMOUNT : 567.96 EUR")).toEqual({ amount: 567.96, currency: "EUR" });
    expect(parseMoney("TAX:VAT (5.90%):  20.25 $")).toEqual({ amount: 20.25, currency: "USD" });
    expect(parseMoney("TOTAL : 1,234.50 USD")).toEqual({ amount: 1234.5, currency: "USD" });
  });

  it("extracts the buyer name, skipping address lines", () => {
    expect(parseName("Buyer :Timothy Rodriguez | 35532 Baker Square")).toBe("Timothy Rodriguez");
    expect(parseName("BILL_TO: | Patricia Robertson | 68128 Michelle Courts")).toBe("Patricia Robertson");
  });
});

describe("mapping + scoring", () => {
  const ann = {
    NUMBER: { text: "INVOICE ID 7199-209" },
    DATE: { text: "Date: 01-Oct-2003" },
    DUE_DATE: { text: "Due Date : 06-Jul-2012" },
    TOTAL: { text: "TOTAL : 663.70 USD" },
    BUYER: { text: "Buyer :Timothy Rodriguez | 35 Baker St" },
  };

  it("builds canonical ground truth from an annotation", () => {
    const gt = groundTruthFromAnnotation(ann);
    expect(gt).toEqual({
      invoice_number: "7199-209",
      client_name: "Timothy Rodriguez",
      issue_date: "2003-10-01",
      due_date: "2012-07-06",
      currency: "USD",
      total_amount: 663.7,
    });
  });

  it("returns null for fields with no ground truth (out of scope)", () => {
    const gt = groundTruthFromAnnotation({ DATE: { text: "Date: 01-Oct-2003" } });
    expect(fieldMatch("due_date", gt, { due_date: "2020-01-01" })).toBeNull();
  });

  it("matches amounts within tolerance and rejects wrong ones", () => {
    const gt = groundTruthFromAnnotation(ann);
    expect(fieldMatch("total_amount", gt, { total_amount: 663.7 })).toBe(true);
    expect(fieldMatch("total_amount", gt, { total_amount: 663.701 })).toBe(true);
    expect(fieldMatch("total_amount", gt, { total_amount: 664.2 })).toBe(false);
  });

  it("tallies a perfect extraction to 100% and skips out-of-scope fields", () => {
    const gt = groundTruthFromAnnotation(ann);
    const report = emptyReport();
    tally(report, gt, {
      invoice_number: "7199-209",
      client_name: "Timothy Rodriguez",
      issue_date: "2003-10-01",
      due_date: "2012-07-06",
      currency: "USD",
      total_amount: 663.7,
    });
    finalize(report);
    expect(report.overall.support).toBe(6); // NUMBER, DATE, DUE_DATE, TOTAL→(amount+currency), BUYER
    expect(report.overall.accuracy).toBe(1);
  });
});
