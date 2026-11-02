import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  real,
  jsonb,
  timestamp,
  boolean,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth tables (user / session / account / verification). Column names
// follow Better Auth's default Drizzle schema so the adapter maps cleanly.
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  isDemo: boolean("is_demo").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Column types for money use numeric() so values are exact; the app converts
// to/from number at the boundary. All money math lives in lib/gap.ts, never here.

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  kind: text("kind").$type<"invoice" | "statement">().notNull(),
  filename: text("filename").notNull(),
  sha256: text("sha256").notNull(),
  blobUrl: text("blob_url"),
  status: text("status")
    .$type<"queued" | "reading" | "done" | "needs_attention" | "error">()
    .notNull()
    .default("queued"),
  extractedJson: jsonb("extracted_json"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id),
  invoiceNumber: text("invoice_number"),
  clientName: text("client_name"),
  clientEmail: text("client_email"),
  issueDate: text("issue_date"),
  dueDate: text("due_date"),
  currency: text("currency"),
  amount: numeric("amount", { precision: 14, scale: 2 }),
  bankChargesTerms: text("bank_charges_terms").$type<
    "OUR" | "SHA" | "BEN" | "unknown"
  >(),
  fieldConfidence: jsonb("field_confidence"),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id),
  valueDate: text("value_date"),
  creditedInr: numeric("credited_inr", { precision: 14, scale: 2 }),
  foreignCurrency: text("foreign_currency"),
  foreignAmount: numeric("foreign_amount", { precision: 14, scale: 2 }),
  appliedRate: numeric("applied_rate", { precision: 12, scale: 4 }),
  remitterName: text("remitter_name"),
  reference: text("reference"),
  channel: text("channel").$type<
    "SWIFT" | "Wise" | "Payoneer" | "PayPal" | "Other"
  >(),
  bankChargesInr: numeric("bank_charges_inr", { precision: 14, scale: 2 }),
  rawText: text("raw_text"),
});

export const matches = pgTable("matches", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").references(() => payments.id),
  score: real("score"),
  method: text("method").$type<"rule" | "agent" | "manual">().notNull(),
  status: text("status")
    .$type<"auto" | "needs_review" | "confirmed" | "rejected">()
    .notNull(),
  rationale: text("rationale"),
  // Cached plain-English explanation (generated once by lib/explain.explain and
  // written back) so the match dialog opens from a DB read, not a live call.
  explanation: text("explanation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const allocations = pgTable("allocations", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").references(() => matches.id),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  amountFc: numeric("amount_fc", { precision: 14, scale: 2 }),
});

export const gapBreakdowns = pgTable("gap_breakdowns", {
  id: serial("id").primaryKey(),
  matchId: integer("match_id").references(() => matches.id),
  expectedInr: numeric("expected_inr", { precision: 14, scale: 2 }),
  receivedInr: numeric("received_inr", { precision: 14, scale: 2 }),
  intermediaryFeeInr: numeric("intermediary_fee_inr", {
    precision: 14,
    scale: 2,
  }),
  fxSpreadInr: numeric("fx_spread_inr", { precision: 14, scale: 2 }),
  bankChargesInr: numeric("bank_charges_inr", { precision: 14, scale: 2 }),
  outstandingFc: numeric("outstanding_fc", { precision: 14, scale: 2 }),
  recoverableFeeFc: numeric("recoverable_fee_fc", { precision: 14, scale: 2 }),
  classification: text("classification").$type<
    "fully_paid" | "paid_with_costs" | "partial" | "needs_review" | "unmatched"
  >(),
  midRate: numeric("mid_rate", { precision: 12, scale: 4 }),
  appliedRate: numeric("applied_rate", { precision: 12, scale: 4 }),
});

export const followups = pgTable("followups", {
  id: serial("id").primaryKey(),
  invoiceId: integer("invoice_id").references(() => invoices.id),
  tone: text("tone").$type<"friendly" | "firm">().default("friendly"),
  subject: text("subject"),
  body: text("body"),
  status: text("status").$type<"draft" | "sent">().default("draft"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const llmCalls = pgTable("llm_calls", {
  id: serial("id").primaryKey(),
  // Account the call is billed to (null = CLI/script, subject only to the
  // global cap). Drives the per-account spend cap in lib/llm.ts.
  userId: text("user_id"),
  model: text("model").notNull(),
  purpose: text("purpose").notNull(),
  inputTokens: integer("input_tokens").default(0).notNull(),
  cachedTokens: integer("cached_tokens").default(0).notNull(),
  outputTokens: integer("output_tokens").default(0).notNull(),
  costUsd: numeric("cost_usd", { precision: 10, scale: 6 })
    .default("0")
    .notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// SHA-256 keyed response cache so identical requests never re-call the model.
export const llmCache = pgTable("llm_cache", {
  key: text("key").primaryKey(),
  response: jsonb("response").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const fxRates = pgTable("fx_rates", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  base: text("base").notNull(),
  quote: text("quote").notNull(),
  rate: numeric("rate", { precision: 14, scale: 6 }).notNull(),
});

// Singleton row (id = 1) holding the user's settings JSON.
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
