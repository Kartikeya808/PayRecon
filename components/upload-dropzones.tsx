"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadIcon, FileIcon } from "@/components/icons";

function Dropzone({
  title,
  help,
  kind,
  icon,
  onDone,
}: {
  title: string;
  help: string;
  kind: "invoice" | "statement";
  icon: React.ReactNode;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("kind", kind);
    Array.from(files).forEach((f) => fd.append("files", f));
    try {
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError("Upload failed. Please try again.");
      } else {
        // Surface any per-file extraction failures (e.g. an unsupported type).
        const failed = (data?.results ?? []).filter((r: { status?: string }) => r.status === "error");
        if (failed.length) {
          setError(
            `${failed.length} file${failed.length === 1 ? "" : "s"} couldn't be read — invoices must be JPG or PNG images.`
          );
        }
      }
      onDone();
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dashed-card"
      style={over ? { borderColor: "var(--link)", background: "color-mix(in srgb, var(--link) 7%, transparent)" } : undefined}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void send(e.dataTransfer.files);
      }}
    >
      <div className="icon-tile">{icon}</div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 16 }}>{title}</div>
        <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>
          {help}
        </div>
      </div>
      <button
        className="btn btn-secondary"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "Uploading…" : "Choose files"}
      </button>
      {error && (
        <div className="text-orange" style={{ fontSize: 12.5, marginTop: 8, maxWidth: 240 }}>
          {error}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={kind === "invoice" ? "image/*" : ".csv,image/*"}
        multiple
        hidden
        onChange={(e) => void send(e.target.files)}
      />
    </div>
  );
}

export function UploadDropzones() {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <Dropzone
        title="Invoices"
        help="Drop a JPG or PNG invoice"
        kind="invoice"
        icon={<FileIcon />}
        onDone={refresh}
      />
      <Dropzone
        title="Statements"
        help="Drop a bank or platform CSV"
        kind="statement"
        icon={<UploadIcon />}
        onDone={refresh}
      />
    </div>
  );
}
