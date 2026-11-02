"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshIcon, SparkleIcon } from "@/components/icons";
import { MatchDialog } from "@/components/match-dialog";
import { statusChip, type BoardRow, type Status, type MatchDetail } from "@/lib/demo-data";
import { inr } from "@/lib/format";

const filters: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "settled", label: "Settled" },
  { key: "partial", label: "Partial" },
  { key: "needs-review", label: "Needs review" },
  { key: "unmatched", label: "Unmatched" },
];

type Summary = { label: string; count: number; color: string; caption: string }[];

type Step = { tool: string; text: string; dot: string; time: string };

export function BoardView({
  rows,
  summary,
  reconciled,
  autoStart = false,
}: {
  rows: BoardRow[];
  summary: Summary;
  reconciled: boolean;
  autoStart?: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [steps, setSteps] = useState<Step[]>([]);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const didAuto = useRef(false);

  const run = () => {
    if (running) return;
    setSteps([]);
    setRunning(true);
    setStatusText("Starting…");
    const es = new EventSource("/api/reconcile");
    esRef.current = es;
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      if (ev.type === "step") {
        setSteps((s) => [...s, { tool: ev.tool, text: ev.text, dot: ev.dot, time: ev.time }]);
      } else if (ev.type === "status") {
        setStatusText(ev.text);
      } else if (ev.type === "done") {
        es.close();
        esRef.current = null;
        setRunning(false);
        router.refresh();
      }
    };
    es.onerror = () => {
      es.close();
      esRef.current = null;
      setRunning(false);
    };
  };

  useEffect(() => {
    if (autoStart && !didAuto.current) {
      didAuto.current = true;
      run();
    }
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const openMatch = async (matchId: number) => {
    setLoadingId(matchId);
    try {
      const res = await fetch(`/api/matches/${matchId}`);
      if (res.ok) setDetail(await res.json());
    } finally {
      setLoadingId(null);
    }
  };

  const shown = rows.filter((r) => {
    if (filter === "all") return true;
    if (filter === "settled") return r.status === "fully-paid" || r.status === "paid-with-costs";
    return r.status === filter;
  });

  const matched = rows.filter((r) => r.status !== "unmatched").length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Board</h1>
          <p className="page-subtitle">
            {rows.length} payments ·{" "}
            {reconciled ? `${matched} matched` : "not reconciled yet"}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={run} disabled={running}>
          <RefreshIcon />
          {running ? "Running…" : reconciled ? "Re-run" : "Reconcile"}
        </button>
      </div>

      {/* summary */}
      <div className="card" style={{ display: "flex", marginBottom: 24 }}>
        {summary.map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              padding: "18px 22px",
              borderLeft: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: s.color }} />
              <span className="muted" style={{ fontSize: 13 }}>
                {s.label}
              </span>
            </div>
            <div className="tnum" style={{ fontSize: 28, fontWeight: 700, color: s.color }}>
              {s.count}
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
              {s.caption}
            </div>
          </div>
        ))}
      </div>

      {/* filter */}
      <div className="segmented" style={{ marginBottom: 20 }}>
        {filters.map((f) => (
          <button
            key={f.key}
            className={filter === f.key ? "active" : ""}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24 }}>
        {/* payments table */}
        <div className="card">
          {rows.length === 0 ? (
            <div className="card-pad">
              <p className="muted" style={{ margin: 0, textAlign: "center", padding: "32px 0" }}>
                No payments yet. Upload bank or platform statements, then run
                reconciliation to match them to invoices.
              </p>
            </div>
          ) : (
          <>
          <div style={{ padding: "16px 0 0" }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Date</th>
                  <th>Remitter</th>
                  <th>Channel</th>
                  <th className="num">Credited</th>
                  <th>Invoice</th>
                  <th>Status</th>
                  <th className="num" style={{ paddingRight: 20 }}>
                    Shortfall
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const clickable = r.matchId != null;
                  return (
                    <tr
                      key={r.id}
                      onClick={clickable ? () => openMatch(r.matchId!) : undefined}
                      style={{
                        cursor: clickable ? "pointer" : "default",
                        opacity: loadingId === r.matchId ? 0.5 : 1,
                      }}
                    >
                      <td className="muted" style={{ paddingLeft: 20, whiteSpace: "nowrap" }}>
                        {r.date}
                      </td>
                      <td>
                        <div style={{ fontWeight: 500 }}>{r.remitter}</div>
                        {r.remitterSub && (
                          <div className="text-purple" style={{ fontSize: 12.5 }}>
                            {r.remitterSub}
                          </div>
                        )}
                      </td>
                      <td className="muted">{r.channel}</td>
                      <td className="num tnum">{inr(r.creditedInr)}</td>
                      <td>
                        {r.invoice ? (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span className="mono" style={{ fontSize: 13 }}>
                              {r.invoice}
                            </span>
                            {r.byAgent && (
                              <span className="text-purple" title="Matched by agent" style={{ display: "inline-flex" }}>
                                <SparkleIcon style={{ width: 14, height: 14 }} />
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span className={`chip ${statusChip[r.status].cls}`}>
                          {statusChip[r.status].label}
                        </span>
                      </td>
                      <td
                        className="num tnum"
                        style={{ paddingRight: 20, fontWeight: r.status === "partial" ? 700 : 400 }}
                      >
                        {r.shortfallInr === null ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className={r.status === "partial" ? "text-orange" : ""}>
                            {inr(r.shortfallInr)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="hairline" style={{ padding: "14px 20px" }}>
            <span className="muted" style={{ fontSize: 13 }}>
              Showing {shown.length} of {rows.length} payments.
            </span>
          </div>
          </>
          )}
        </div>

        <AgentPanel
          reconciled={reconciled}
          running={running}
          statusText={statusText}
          steps={steps}
          unmatched={rows.filter((r) => r.status === "unmatched").length}
        />
      </div>

      {detail && <MatchDialog match={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function AgentPanel({
  reconciled,
  running,
  statusText,
  steps,
  unmatched,
}: {
  reconciled: boolean;
  running: boolean;
  statusText: string | null;
  steps: Step[];
  unmatched: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [steps.length]);

  return (
    <div className="card card-pad" style={{ alignSelf: "start" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span className="sparkle">
          <SparkleIcon />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600 }}>Agent activity</div>
          <div className="muted" style={{ fontSize: 12.5 }}>
            Muse Wonder 1.0
          </div>
        </div>
        {running && <span className="pulse-dot" aria-label="running" />}
      </div>

      {steps.length === 0 ? (
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
          {running
            ? statusText ?? "Working…"
            : reconciled
            ? `${unmatched} payment${unmatched === 1 ? "" : "s"} unmatched. Re-run to replay the agent — split transfers, parent-company remitters and instalments resolved live.`
            : "Run reconciliation to match payments to invoices. The agent then resolves anything the rules can't."}
        </p>
      ) : (
        <>
          <div
            ref={scrollRef}
            style={{ display: "flex", flexDirection: "column", gap: 0, maxHeight: 420, overflowY: "auto" }}
          >
            {steps.map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "9px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    background: s.dot,
                    marginTop: 6,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="mono" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    {s.tool}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.45 }}>{s.text}</div>
                </div>
                <span className="muted tnum" style={{ fontSize: 11, flexShrink: 0 }}>
                  {s.time}
                </span>
              </div>
            ))}
          </div>
          {statusText && (
            <div className="hairline" style={{ paddingTop: 12, marginTop: 12 }}>
              <span className="muted" style={{ fontSize: 12.5 }}>
                {statusText}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
