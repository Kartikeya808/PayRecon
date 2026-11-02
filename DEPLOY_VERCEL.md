# Deploying PayRecon to Vercel

The repo is Vercel-ready (Next.js App Router, Node runtime). The deploy itself is
done from the Vercel dashboard — follow these steps in order.

## 0. Before you start — rotate the DB credential

The Neon connection string used during the build was pasted in chat history.
**Generate a fresh Neon credential for production** (Neon console → Roles →
reset password, or a new role) and use that below. Don't reuse the old one.

## 1. Provision the production database

1. In Neon, use the **`main`** branch for prod. Get its **pooled** connection
   string (host contains `-pooler`).
2. Push the schema to it from your machine (includes the `llm_calls.user_id`
   column the per-account cap needs):
   ```bash
   DATABASE_URL="<prod-pooled-url>" npm run db:push
   ```
3. *(Optional)* seed a demo into prod so "Try the demo" has data (demo files are
   gitignored, so generate them first, locally):
   ```bash
   npm run generate-demo-data
   DATABASE_URL="<prod-pooled-url>" LLM_MODE=stub npm run seed
   ```

## 2. Import the repo into Vercel

1. vercel.com → **Add New → Project** → import `Kartikeya808/PayRecon`.
2. Framework preset auto-detects **Next.js**. Leave build/install commands default
   (`next build` / `npm install`). Root directory: repo root.
3. **Don't deploy yet** — add env vars first (next step).

## 3. Environment variables (Project → Settings → Environment Variables)

Set these for **Production** (and Preview if you want preview deploys to work):

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the fresh pooled Neon URL | from step 0–1 |
| `BETTER_AUTH_SECRET` | a long random string | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://<your-project>.vercel.app` | **must** be the live URL, or auth cookies/redirects break |
| `MODEL_API_KEY` | your Meta Model API key | the live key |
| `MODEL_BASE_URL` | `https://api.meta.ai/v1` | |
| `MODEL_TIER` | `standard` | Contributor tier is refused in code |
| `LLM_MODE` | `live` | omit/`stub` keeps it free |
| `MODEL_BUDGET_USD` | `100` | global spend backstop |
| `FX_MODE` | `live` | real ECB rates; omit for fixed stub rates |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | *(optional)* | enables the Google button; register the Vercel redirect URI in Google console |

> `BETTER_AUTH_URL` is a chicken-and-egg: you need the deployed domain to set it.
> Deploy once to learn the domain, set `BETTER_AUTH_URL` to it, then redeploy. If
> you add a custom domain later, update this to match.

## 4. Deploy

Click **Deploy**. Vercel builds and gives you a URL. Set `BETTER_AUTH_URL` to that
URL (step 3 note) and **redeploy** so auth works.

## 5. Smoke-test the live deployment

1. Open the URL → sign up a new account → you should land on the empty Upload page.
2. Upload a **JPG/PNG** invoice → it extracts live (spend shows in the sidebar meter).
3. Upload a CSV statement → **Reconcile** → board populates.

## Known constraints on serverless

- **Uploaded raw files are not durably stored.** On Vercel they're written to
  `/tmp` (ephemeral) — fine today because the bytes are only used in-request for
  extraction and never read back. If you later need to re-open the original file,
  wire real object storage: implement the S3 branch in `lib/storage.ts` and set
  `BLOB_ENDPOINT` / `BLOB_ACCESS_KEY_ID` / `BLOB_SECRET_ACCESS_KEY` / region.
- **PDF invoices/statements fail live** — the vision model is image-only
  (JPEG/PNG/GIF/WebP/ICO). CSV statements are parsed in code and are fine.
- **Function timeout:** reconcile + upload are capped at `maxDuration = 60s`
  (Vercel Hobby max). Large batches or many follow-up drafts can approach it; on
  Pro you can raise `maxDuration`.
- **"Forgot password"** on the login screen is a styled placeholder — no email is
  sent. Wire a real reset flow before a public launch if needed.

## Alternative: Vercel CLI

If you prefer the CLI (not installed on this machine):
```bash
npm i -g vercel
vercel login
vercel link          # link to the GitHub project
vercel env add       # add each variable above
vercel --prod        # deploy
```
