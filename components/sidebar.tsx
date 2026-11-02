"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  UploadIcon,
  BoardIcon,
  MailIcon,
  SettingsIcon,
} from "./icons";
import { useSession, signOut } from "@/lib/auth-client";

function initials(name?: string | null, email?: string | null): string {
  const base = name?.trim() || email?.split("@")[0] || "U";
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "U";
}

export function Sidebar({
  spendUsd = 0,
  capUsd = 100,
  followupCount = 0,
}: {
  spendUsd?: number;
  capUsd?: number;
  followupCount?: number;
}) {
  const nav = [
    { href: "/", label: "Upload", icon: UploadIcon, badge: undefined as string | undefined },
    { href: "/board", label: "Board", icon: BoardIcon, badge: undefined },
    {
      href: "/followups",
      label: "Follow-ups",
      icon: MailIcon,
      badge: followupCount > 0 ? String(followupCount) : undefined,
    },
    { href: "/settings", label: "Settings", icon: SettingsIcon, badge: undefined },
  ];
  const pathname = usePathname();
  const { data: session } = useSession();
  const [dark, setDark] = useState(true);
  const u = session?.user;

  useEffect(() => {
    const stored = localStorage.getItem("pma-theme");
    setDark(stored !== "light");
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    const theme = next ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pma-theme", theme);
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">$</div>
        <div>
          <div className="brand-name">PayRecon</div>
          <div className="brand-sub">Reconciliation</div>
        </div>
      </div>

      <nav className="nav">
        {nav.map(({ href, label, icon: Icon, badge }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`nav-item${active ? " active" : ""}`}
            >
              <Icon />
              <span>{label}</span>
              {badge && <span className="nav-badge">{badge}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="sidebar-bottom">
        <div className="spend-card">
          <div className="spend-label">
            Model API spend{" "}
            <span className="spend-value tnum">
              ${spendUsd.toFixed(2)} / ${capUsd.toFixed(0)}
            </span>
          </div>
          <div className="progress">
            <span
              style={{
                width: `${Math.min(100, capUsd > 0 ? (spendUsd / capUsd) * 100 : 0)}%`,
              }}
            />
          </div>
        </div>

        <div className="switch-row">
          <span>Dark mode</span>
          <button
            className="switch"
            data-on={dark}
            onClick={toggle}
            aria-label="Toggle dark mode"
          />
        </div>

        <div className="profile-row">
          <div className="avatar" style={{ width: 36, height: 36, fontSize: 13 }}>
            {initials(u?.name, u?.email)}
          </div>
          <div style={{ lineHeight: 1.2, flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {u?.name || "Your account"}
            </div>
            <div
              style={{
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              className="muted"
            >
              {u?.email || ""}
            </div>
          </div>
          <button
            className="btn-ghost"
            onClick={() =>
              signOut({
                fetchOptions: {
                  onSuccess: () => {
                    window.location.href = "/login";
                  },
                },
              })
            }
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              padding: 4,
            }}
          >
            Sign out
          </button>
        </div>

        <div className="disclaimer">
          ECB reference rates · Not tax or accounting advice
        </div>
      </div>
    </aside>
  );
}
