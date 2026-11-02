import { headers } from "next/headers";
import { ArrowRightIcon, SheetIcon, FileIcon, ImageIcon } from "@/components/icons";
import type { FileRow } from "@/lib/demo-data";
import { Greeting } from "@/components/greeting";
import { UploadDropzones } from "@/components/upload-dropzones";
import { getFileRows, getCounts } from "@/lib/queries";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

function kindIcon(kind: FileRow["kind"]) {
  if (kind === "invoice-photo") return <ImageIcon />;
  if (kind === "bank" || kind === "platform") return <SheetIcon />;
  return <FileIcon />;
}

export default async function UploadPage() {
  const [rows, counts, session] = await Promise.all([
    getFileRows(),
    getCounts(),
    auth.api.getSession({ headers: await headers() }),
  ]);
  const readPct = counts.total ? Math.round((counts.read / counts.total) * 100) : 0;

  return (
    <>
      <div className="page-head">
        <Greeting name={session?.user?.name} />
        <a href="/board?run=1" className="btn btn-primary">
          Reconcile {counts.read || 0} payments <ArrowRightIcon />
        </a>
      </div>

      <div style={{ marginTop: 36 }}>
        <h2 className="section-heading" style={{ marginBottom: 2 }}>
          Add invoices and statements
        </h2>
        <p className="page-subtitle" style={{ marginBottom: 20 }}>
          PDFs, photos of invoices, and bank or platform statements. Files stay
          on this machine.
        </p>
      </div>

      <UploadDropzones />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "32px 0 12px",
        }}
      >
        <h2 className="section-heading" style={{ margin: 0 }}>
          Files <span className="muted">{counts.total}</span>
        </h2>
        {counts.total > 0 && (
          <div
            style={{ display: "flex", alignItems: "center", gap: 12, width: 260 }}
          >
            <span className="muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              {counts.read} of {counts.total} read
            </span>
            <div className="progress" style={{ flex: 1 }}>
              <span style={{ width: `${readPct}%` }} />
            </div>
          </div>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card card-pad">
          <p className="muted" style={{ margin: 0, textAlign: "center", padding: "24px 0" }}>
            No files yet. Drop invoices and statements above to get started.
          </p>
        </div>
      ) : (
        <div className="card">
          {rows.map((f, i) => (
            <div
              key={f.name + i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 20px",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
              }}
            >
              <div className="icon-tile" style={{ width: 34, height: 34 }}>
                {kindIcon(f.kind)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="mono" style={{ fontSize: 13.5 }}>
                  {f.name}
                </div>
                {f.note && (
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    {f.note}
                  </div>
                )}
              </div>
              <div className="muted" style={{ width: 130, fontSize: 13.5 }}>
                {f.type}
              </div>
              <div style={{ width: 150 }}>
                <span className={`chip ${f.status.cls}`}>{f.status.label}</span>
              </div>
              <div
                className="muted tnum"
                style={{ width: 90, textAlign: "right", fontSize: 13.5 }}
              >
                {f.fields}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
