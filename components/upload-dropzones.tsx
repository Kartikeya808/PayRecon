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

  async function send(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("kind", kind);
    Array.from(files).forEach((f) => fd.append("files", f));
    try {
      await fetch("/api/upload", { method: "POST", body: fd });
      onDone();
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
      <input
        ref={inputRef}
        type="file"
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
        help="Drop PDF, JPG or PNG here"
        kind="invoice"
        icon={<FileIcon />}
        onDone={refresh}
      />
      <Dropzone
        title="Statements"
        help="Drop bank or platform CSV or PDF"
        kind="statement"
        icon={<UploadIcon />}
        onDone={refresh}
      />
    </div>
  );
}
