# PMA-METAH — Frontend design brief for Google Stitch (v2: graphite + blue)

## How to run this (in Claude Code, with Stitch MCP connected)

> "Read STITCH_PROMPTS.md. Using the Stitch MCP connection, create a Stitch project called **PMA-METAH**. Generate the 7 screens below in order (Screen 0 to Screen 6), each as a desktop web screen (1440 wide), prepending the **Shared style** block to every screen prompt. After all 7 exist, list the screens, save a screenshot of each to `/design/screens/`, and save the design system as `/design/DESIGN.md`. Do not write any app code yet."

Then review the screens in Stitch, iterate there, and only then:

> "Rebuild the screens in /design in Next.js + Tailwind + shadcn/ui following PRD.md. Treat Stitch output as visual reference only; keep the PRD's file structure. Implement light and dark themes with CSS variables, and the match detail as a shadcn Dialog with an expand toggle."

Also works by hand: paste the Shared style block + one screen prompt into stitch.withgoogle.com.

---

## Shared style (prepend to every screen prompt)

```
Desktop web app for Indian freelancers and exporters who get paid in USD, EUR and GBP. Product name "PMA". Feel: calm, precise and premium, in the spirit of Apple's Human Interface Guidelines: clear hierarchy, generous spacing, few colors, nothing decorative. Default theme is DARK; a light theme exists too.

Dark theme: page background graphite #161618; sidebar #1C1C1F; cards #232326 with 1px borders #38383C; inset/secondary fills #2E2E32; primary text #F5F5F7; secondary text #A1A1A6.
Light theme: page #F5F5F7; sidebar #FBFBFD; cards #FFFFFF with borders #E3E3E8; secondary fills #EFEFF3; text #1D1D1F; secondary text #6E6E73.
One accent: blue. Primary buttons #0071E3 with white text; links and selected states #409CFF (dark) / #0066CC (light); selected nav item has a soft blue tint background.
Status colors are the ONLY warm or saturated colors on screen, so they pop against the graphite. Pill chips with a small leading dot, soft tinted background, colored text:
- Fully paid: green #30D158
- Paid with costs: mint #66D4CF
- Partial: orange #FF9F0A
- Needs review: purple #C59BFF (also used for anything the AI agent did)
- Unmatched: red #FF6961

Typography: Inter (or system UI font), tight letter-spacing on large titles; page titles 30px bold; section headings 15–17px semibold; body 15px. Money uses tabular figures in the same font (not monospace). Invoice numbers and tool-call names use JetBrains Mono. Rupee amounts use Indian digit grouping with the ₹ sign (₹1,65,507.50). Foreign amounts show the ISO code first (USD 2,000.00). Sentence case everywhere; no all-caps labels.

Layout: left sidebar 220px: logo (blue rounded square with ₹, "PMA", "Reconciliation"), nav items with outline icons: Upload, Board, Follow-ups (small orange count badge "3"), Settings. Sidebar bottom: a small card "Model API spend $0.84 / $100" with a thin blue progress bar; a "Dark mode" row with an iOS-style switch; a profile row (circle avatar "AM", "Aarav Mehta", "Mehta Design Studio"); tiny note "ECB reference rates · Not tax or accounting advice". Content max width 1160px, 40px top padding. Radii: cards 14px, buttons and inputs 10px, chips fully rounded. Segmented controls (iOS style) for filters and toggles. No gradients, no glows; one soft shadow only on dialogs. Touch targets at least 44px.
```

---

## Screen 0 — Sign in (with Try the demo)

> Already have the other 6 screens in Stitch? Add only this one: "Using the Stitch MCP connection, open the PMA-METAH project and generate Screen 0 from STITCH_PROMPTS.md, prepending the Shared style block. Match the existing screens' colors, type and radii exactly. Save its screenshots to `/design/screens/`."

```
Sign-in screen for PMA. This screen has NO sidebar and no app footer; everything else follows the shared style (graphite dark theme by default, one blue accent, Inter, 14px card radius, 10px button and input radius, 44px minimum touch targets, sentence case).

Layout: full-height page split in two at desktop width, stacking to a single column on narrow screens (sign-in card first).

LEFT half (product promise, quiet and editorial, on the page background #161618):
- Top-left: the PMA logo (blue rounded square with ₹, "PMA", "Reconciliation"), same as the sidebar logo.
- Vertically centered: a large bold headline "Know where every rupee went." (40px, tight letter-spacing) and one line of secondary text: "Match foreign payments to invoices, see what fees and FX spreads cost you, and chase only what's actually owed."
- Below it, one small example card (#232326, hairline border) showing a real result from the demo data, read-only:
  "INV-2026-014 · Halcyon Analytics LLC" with a mint "Paid with costs" chip;
  three compact rows with right-aligned tabular figures: "Expected ₹1,69,900.00", "Fees and FX spread −₹4,392.50" (orange), "Received ₹1,65,507.50" (bold);
  a thin 8px waterfall bar under each row like the match pop-up, and a mint check line "All normal costs. Nothing to chase."
- Bottom-left, small gray: "Powered by Meta's Muse models · Not tax or accounting advice".

RIGHT half: a centered sign-in card, 420px wide, on the slightly lighter surface #1C1C1F with a hairline border and 20px radius, generous padding (32px).
- Card title "Sign in" (24px bold) and secondary line "Welcome back. Pick up where you left off."
- A full-width "Continue with Google" button that follows Google's sign-in branding guidelines: white background, the standard multicolor Google "G" logo on the left, dark text "Continue with Google", 44px tall, 10px radius. Do not restyle the Google logo.
- A divider: two hairlines with a small gray "or" between them.
- Labeled fields (labels above inputs, never placeholder-only), input fill #161618 with #38383C border:
  "Email or username" (autocomplete username), and "Password" with an eye icon button on the right to show/hide (accessible name "Show password"). A small blue "Forgot password?" link aligned right above or below the password field.
- Full-width blue primary button "Sign in" (#0071E3, white, 600 weight).
- Centered small text: "New to PMA? Create an account" with "Create an account" as a blue link.

Below the card, visually separate from the form (24px gap), a second, quieter block for judges and first-time visitors:
- A full-width secondary button on the gray fill #2E2E32 with a purple sparkle icon: "Try the demo".
- Caption under it in gray: "Opens a sample workspace with 20 invoices and 21 payments. No sign-up, nothing is emailed."

Top-right corner of the page: a small round 44px icon button that toggles light/dark (moon icon in dark mode, accessible name "Switch to light mode").

Also generate these two states of the same screen:
1. ERROR state: after a failed sign-in, the password field has a red (#FF6961) border and a red message directly under it: "That password doesn't match this account. Try again or reset it." The email value stays filled in. No toast, no shaking.
2. LIGHT theme: same layout with the light tokens (page #F5F5F7, card #FFFFFF, borders #E3E3E8, text #1D1D1F), Google button gets a 1px #DADCE0 border, toggle shows a sun icon.
```

> Note for Claude Code: wire "Continue with Google" and "Sign in" to Neon Auth (Better Auth). Confirm Google is enabled as a social provider in the Neon console before building the button; if it isn't, hide the button and divider rather than showing a dead control. "Try the demo" signs into a pre-seeded demo account server-side (no password shown in the UI) with its own small spending cap.

## Screen 1 — Upload

```
Upload screen. Title "Add invoices and statements", subtitle "PDFs, photos of invoices, and bank or platform statements. Files stay on this machine." Primary blue button top-right: "Reconcile 21 payments →".

Two side-by-side dashed drop cards, each with a blue-tinted icon tile, a title, one line of help and a secondary "Choose files" button:
1. "Invoices" — "Drop PDF, JPG or PNG here".
2. "Statements" — "Drop bank or platform CSV or PDF".

Section "Files 22" with "20 of 22 read" and a thin blue progress bar on the right. One card containing a list (rows separated by hairlines), columns: kind icon tile, Name (mono), Type, Status chip, Fields found (right-aligned):
- INV-2026-014.pdf · Invoice · Done (green) · 7 of 7
- INV-2026-015.pdf · Invoice · Done · 7 of 7
- invoice_photo_juniper.jpg · Invoice photo · Needs attention (orange) · 6 of 7 · note "Due date unclear, check it"
- INV-2026-017.pdf · Invoice · Reading… (blue) · — · note "Muse Spark 1.3"
- INV-2026-018.pdf · Invoice · Queued (gray) · —
- INV-2026-019.png · Invoice photo · Done · 7 of 7
- statement_sep_oct.csv · Bank statement · Done · 14 credits · note "Parsed in code, no AI call"
- platform_statement_oct.pdf · Platform statement · Done · 7 credits
Card footer: blue link "Show all 22 files", gray text button "Remove all".
```

## Screen 2 — Board with agent activity

```
Board screen. Title "Board", subtitle "21 payments · 20 invoices · reconciled 2 min ago". Secondary button top-right "Re-run" with a refresh icon.

Summary: ONE card split into 4 columns by hairlines (not 4 separate cards). Each: colored dot + label, big bold number, one-line caption. Settled 14 (white number) "Paid in full or with normal costs"; Partial 3 (orange number) "Follow-ups drafted"; Needs review 2 (purple) "Agent suggestions to confirm"; Unmatched 2 (red) "No invoice found".

iOS-style segmented control: All (selected) · Settled · Partial · Needs review · Unmatched.

Two columns. Left (two-thirds): payments table card. Columns: Date, Remitter, Channel, Credited, Invoice, Status, Shortfall. Rows:
- 14 Oct · Halcyon Analytics LLC · SWIFT · ₹1,65,507.50 · INV-2026-014 (blue link) · Paid with costs · ₹4,392.50
- 12 Oct · Juniper Ridge Inc. · SWIFT · ₹2,14,885.00 · INV-2026-011 (blue link) · Partial · ₹39,965.00 (orange, bold)
- 10 Oct · Brightfold GmbH · Wise · ₹1,08,245.20 · INV-2026-009 + 010 + small purple sparkle icon "Matched by agent" · Paid with costs · ₹1,214.80
- 09 Oct · Kestrel Holdings Ltd, purple sub-line "Parent company of client" · SWIFT · ₹96,402.00 · INV-2026-008 + sparkle · Needs review · ₹2,038.00
- 07 Oct · Larkspur Studio · Payoneer · ₹41,870.10 · INV-2026-007 · 1 of 2 · Paid with costs · —
- 05 Oct · Ortolan Media · PayPal · ₹62,118.40 · INV-2026-006 · Fully paid · ₹0.00
- 03 Oct · UPI REFUND 88213 · Other · ₹1,250.00 · — · Unmatched · —
- 02 Oct · Halcyon Analytics LLC · SWIFT · ₹1,66,210.75 · INV-2026-005 · Paid with costs · ₹3,689.25
Footer caption: "Showing 8 of 21 payments. Select a blue invoice number to open its breakdown."

Right (one-third): "Agent activity" card, purple sparkle tile, sub "Muse Wonder 1.0 · finished". A vertical timeline: each step has a colored dot on a hairline, the tool name in a mono pill, a timestamp, and one sentence:
- list_unresolved() 10:42:03 — 5 payments need a closer look (gray dot)
- get_payment(p_17) 10:42:05 — Brightfold GmbH · EUR 1,180.00
- compute_gap(p_17, [009, 010]) 10:42:07 — Fees and spread come to ₹1,214.80
- propose_match(p_17) 10:42:08 — Confidence 0.94. One transfer covers both invoices… (green dot)
- get_invoice(INV-2026-008) 10:42:11 — Client on invoice: Kestrel Analytics
- propose_match(p_09) 10:42:13 — Confidence 0.78, sent for review… (purple dot)
- mark_unmatched(p_03) 10:42:15 — Domestic UPI refund, not a foreign remittance (red dot)
Card footer: "7 tool calls · 12 s" and "$0.21".
```

## Screen 3 — Match pop-up (paid with costs, the hero screen)

```
A centered modal DIALOG, 760px wide, 20px corner radius, soft large shadow, floating over the Board screen which is dimmed by a dark scrim. Top-right of the dialog: two round 44px icon buttons on a gray fill: "Expand" (diagonal arrows) and "Close" (X).

Dialog header: mint "Paid with costs" chip, gray "Rule match · score 0.93 · SWIFT"; title "Halcyon Analytics LLC" bold with "INV-2026-014" in gray mono beside it.

Body:
- Small gray "Received on 14 Oct", then a big bold "₹1,65,507.50" with gray "of ₹1,69,900.00 expected". Under it a mint check line: "The ₹4,392.50 gap is all normal costs. Nothing to chase."
- "Where the money went" with a small gray "Scale starts at ₹1,60,000" on the right. Five rows, each: label + gray sub-label on the left, amount on the right, and a thin 8px rounded bar on a dark track below (waterfall stepping down):
  - Expected at ECB reference rate · USD 2,000 × 84.95 · ₹1,69,900.00 (gray bar, full width)
  - Intermediary bank fee · USD 25 deducted in transit · −₹2,123.75 (orange amount, orange bar)
  - FX spread · Bank rate 84.10 vs 84.95 · −₹1,678.75 (orange)
  - Bank charges + GST · ₹500 + ₹90 GST · −₹590.00 (orange)
  - Received · Credited 14 Oct · ₹1,65,507.50 (bold, blue bar)
- "In plain words": 3 sentences — "Halcyon paid the full USD 2,000. USD 25 was deducted by an intermediary bank before it reached you, and your bank converted the remaining USD 1,975 at 84.10, below the ECB reference rate of 84.95. After ₹590 in bank charges and GST, ₹1,65,507.50 was credited, so nothing is owed by the client." Under it a small purple sparkle + gray "Written by Muse Wonder 1.0 · every number checked against the computed breakdown".
- "Evidence": one inset gray-filled group: statement line in mono ("14 OCT · INWARD REMIT · HALCYON ANALYTICS LLC · USD 1,975.00 @ 84.10 · REF INV2026014"), then label/value rows: Invoice INV-2026-014, Issued 18 Sep 2026, Amount USD 2,000.00, Charges terms SHA, shared.
- Blue text link "Show rate details ›".

Dialog footer (hairline above): left red text button "Reject match"; right a gray "Reassign" and a blue primary "✓ Confirm match".

Also generate the EXPANDED state: the same dialog grown to nearly full width (1240px), body in two columns (left: amount + waterfall; right: explanation, evidence, and a "Rate details" group: Value date 14 Oct 2026, ECB reference rate 84.95, Your bank's rate 84.10, Markup on the rate 1.00% in orange, Arrived in USD USD 1,975.00). The expand icon becomes a collapse icon.
```

## Screen 4 — Match pop-up (partial payment)

```
Same dialog design as Screen 3, for "Juniper Ridge Inc." / INV-2026-011, orange "Partial" chip, "Rule match · score 0.91 · SWIFT".

At the top of the body, an orange-tinted rounded callout with an orange alert icon: big orange "USD 400 likely still owed", sub-text "Only USD 2,550 arrived for a USD 3,000 invoice. Normal fees explain about USD 50 of the gap."

Then "Received on 12 Oct", big "₹2,14,885.00", gray "of ₹2,54,850.00 expected".

Waterfall (scale starts at ₹2,10,000):
- Expected at ECB reference rate · USD 3,000 × 84.95 · ₹2,54,850.00 (gray)
- Not received · USD 450: about USD 400 owed + USD 50 typical fees · −₹38,227.50 (RED bold amount, red bar — the longest bar)
- FX spread · Bank rate 84.50 vs 84.95 · −₹1,147.50 (orange)
- Bank charges + GST · ₹500 + ₹90 GST · −₹590.00 (orange)
- Received · Credited 12 Oct · ₹2,14,885.00 (bold, blue bar)
Caption "Total gap ₹39,965.00".

"In plain words": "Juniper Ridge's transfer reached you as USD 2,550, which is USD 450 short of the USD 3,000 invoice. Typical intermediary fees are around USD 50, so about USD 400 looks unpaid rather than lost in transit. Your bank converted at 84.50 against the ECB reference rate of 84.95 and charged ₹590, leaving ₹2,14,885.00 credited."

Evidence: "12 OCT · INWARD REMIT · JUNIPER RIDGE INC · USD 2,550.00 @ 84.50 · REF INV-2026-011"; Invoice INV-2026-011, Issued 2 Sep 2026, Amount USD 3,000.00, Charges terms SHA, shared.

Footer: red "Reject match" left; gray "Mark as settled" and blue primary "✉ Draft follow-up" right.
```

> Note for Claude Code: when building screens 3 and 4 for real, every amount comes from `gap.ts` — the numbers above are placeholders for layout only.

## Screen 5 — Follow-ups

```
Follow-ups screen. Title "Follow-ups", subtitle "Drafted for partial payments and fees the client agreed to cover. Nothing is sent from this app."

Left (one-third): ONE card with 3 selectable rows separated by hairlines; the selected row has a soft blue tint. Each row: client name bold with the amount right-aligned and colored, then the invoice number in gray mono with a status chip:
- Juniper Ridge Inc. · USD 400.00 (orange) · INV-2026-011 · Partial (orange chip) — selected
- Marlowe & Finch LLP · GBP 180.00 (orange) · INV-2026-003 · Partial
- Tessellate Labs · USD 35.00 (mint) · INV-2026-012 · Recoverable fee (mint chip)

Right (two-thirds): editor card. Header "Email to Juniper Ridge Inc." with an iOS segmented control Friendly | Firm (Friendly selected). Labeled fields: To "accounts@juniperridge.example", Subject "INV-2026-011: remaining balance of USD 400", Message (large text area):
"Hi Dana,

Thanks for your payment against invoice INV-2026-011 dated 2 Sep 2026. The invoice was for USD 3,000.00 and we received USD 2,550.00, which leaves USD 400.00 outstanding after typical bank fees.

Could you arrange the remaining balance to the account details below?
[Payment details]

Thanks again,
Aarav"
Under it: purple sparkle + gray "Drafted by Muse Wonder 1.0 · amounts come from the reconciliation, not the model".
Footer: blue text button "Mark as sent" on the left; gray "Regenerate" and blue primary "Copy email" on the right.
```

## Screen 6 — Settings and profile

```
Settings screen with "Settings" selected in the sidebar. Title "Settings", subtitle "Your profile, how PMA looks, and how it decides what counts as a normal cost." Content column 760px wide, in iOS-style grouped sections: small gray section heading above a rounded card whose rows are separated by hairlines; label on the left, control on the right.

Profile: top row with a 56px blue-tinted circle avatar "AM", "Aarav Mehta" and "aarav@mehtadesign.example". Then rows with text inputs: Full name, Business name ("Mehta Design Studio"), Reply-to email, Sign follow-ups as ("Aarav").

Appearance: row "Theme" with a segmented control Light | Dark (selected) | System. Caption below: "System follows your device setting. The choice applies on every screen."

Reconciliation rules: "Typical fee allowance" (sub "Per payment, in the invoice currency. Gaps beyond this are flagged as owed.") with a small number input "50"; "Or up to this share of the invoice" (sub "Whichever is larger is treated as normal cost.") with "3 %"; "Reference rate" select "ECB reference rate (Frankfurter)"; "Home currency" — "INR · Indian rupee".

AI models and budget: "Reading documents — Muse Spark 1.3"; "Matching agent and writing — Muse Wonder 1.0"; "Spending cap" (sub "$0.84 used so far. Calls stop when the cap is reached.") with "$ 100"; "Auto-confirm confident agent matches" (sub "Matches at 0.9 confidence or higher skip review. Off means you check every one.") with an iOS switch, off. Caption: "PMA uses Meta Model API's standard tier, which does not use your documents to train models."

Data: "Uploaded files — 22 files, stored only on this machine" with a red-tinted "Delete all files…" button.

Bottom right: gray status text and a blue "Save changes" button (dimmed until something changes).
```

---

## Notes

- All client names, the "Aarav Mehta" profile and all amounts are fictional demo data, matching the synthetic set in PRD.md §10.
- Labels "Muse Spark 1.3" and "Muse Wonder 1.0" are shown on purpose: judges should see where Meta's models do the work. Purple is reserved for the AI agent so its work is easy to spot.
- The theme choice is a real setting: build both themes from one set of CSS variables, default to dark.
- Credit Stitch in the README's "Built during the hackathon" section ("UI designed with Google Stitch during the event").
