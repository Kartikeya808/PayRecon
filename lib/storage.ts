import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

// File storage abstraction. Local filesystem in dev; Neon Object Storage (S3)
// in production (wired in Phase 9 when bucket credentials are provided).
// Same interface either way so callers never change.

const UPLOADS = join(process.cwd(), "data", "uploads");

function useS3(): boolean {
  return !!process.env.BLOB_ENDPOINT && !!process.env.BLOB_ACCESS_KEY_ID;
}

export async function putFile(
  sha: string,
  filename: string,
  bytes: Buffer
): Promise<string> {
  if (useS3()) {
    throw new Error(
      "S3/Neon Object Storage not wired yet — provide BLOB_* creds (Phase 9)."
    );
  }
  mkdirSync(UPLOADS, { recursive: true });
  const name = `${sha.slice(0, 12)}-${filename}`;
  writeFileSync(join(UPLOADS, name), bytes);
  return `local://${name}`;
}

export async function getFile(url: string): Promise<Buffer> {
  if (url.startsWith("local://")) {
    return readFileSync(join(UPLOADS, url.slice("local://".length)));
  }
  throw new Error(`Unsupported storage url: ${url}`);
}
