"use client";

import { useEffect, useState, type RefObject } from "react";

// Drives the SampleReconCard's proximity motion. One rAF-throttled, lerped
// pointermove listener on `panelRef`; writes CSS custom properties onto
// `cardRef` each frame (no React re-render for the motion itself) and exposes
// `expanded` for the breakdown reveal.
//
// CSS vars written to the card:
//   --prox : 0..1 proximity strength (1 at the card, smoothstep to 0 at 280px)
//   --px --py : cursor offset from the card centre, -1..1 (for tilt)
//   --gx --gy : cursor position inside the card, % (for the glare)

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function useProximity(
  panelRef: RefObject<HTMLElement | null>,
  cardRef: RefObject<HTMLElement | null>,
  { radius = 280, expandAt = 0.55 }: { radius?: number; expandAt?: number } = {}
) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const panel = panelRef.current;
    const card = cardRef.current;
    if (!panel || !card) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(hover: none)").matches;

    // Touch / no-hover: no tilt, breakdown open by default.
    if (coarse) {
      card.style.setProperty("--prox", "0");
      setExpanded(true);
      return;
    }

    const target = { s: 0, px: 0, py: 0, gx: 50, gy: 50 };
    const cur = { s: 0, px: 0, py: 0, gx: 50, gy: 50 };
    let raf = 0;
    let running = false;
    let focused = false;

    const onMove = (e: PointerEvent) => {
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
      const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
      target.s = 1 - smoothstep(0, radius, Math.hypot(dx, dy));
      target.px = clamp(((e.clientX - cx) / (r.width / 2)) || 0, -1, 1);
      target.py = clamp(((e.clientY - cy) / (r.height / 2)) || 0, -1, 1);
      target.gx = clamp(((e.clientX - r.left) / r.width) * 100, 0, 100);
      target.gy = clamp(((e.clientY - r.top) / r.height) * 100, 0, 100);
      ensureRunning();
    };
    const onLeave = () => {
      target.s = 0;
      ensureRunning();
    };
    const onFocusIn = () => {
      focused = true;
      setExpanded(true);
    };
    const onFocusOut = () => {
      focused = false;
    };

    const frame = () => {
      cur.s = lerp(cur.s, target.s, 0.14);
      cur.px = lerp(cur.px, target.px, 0.14);
      cur.py = lerp(cur.py, target.py, 0.14);
      cur.gx = lerp(cur.gx, target.gx, 0.2);
      cur.gy = lerp(cur.gy, target.gy, 0.2);

      // Reduced motion: keep the breakdown logic but no tilt/glare.
      card.style.setProperty("--prox", (reduced ? 0 : cur.s).toFixed(4));
      card.style.setProperty("--px", cur.px.toFixed(4));
      card.style.setProperty("--py", cur.py.toFixed(4));
      card.style.setProperty("--gx", cur.gx.toFixed(2));
      card.style.setProperty("--gy", cur.gy.toFixed(2));

      const open = focused || cur.s > expandAt;
      setExpanded((prev) => (prev === open ? prev : open));

      // Stop the loop once everything has settled (resumes on the next event).
      const settled =
        Math.abs(cur.s - target.s) < 0.001 &&
        Math.abs(cur.px - target.px) < 0.001 &&
        Math.abs(cur.py - target.py) < 0.001;
      if (settled) {
        running = false;
        raf = 0;
      } else {
        raf = requestAnimationFrame(frame);
      }
    };

    const ensureRunning = () => {
      if (!running && !document.hidden) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf);
        running = false;
        raf = 0;
      } else {
        ensureRunning();
      }
    };

    panel.addEventListener("pointermove", onMove);
    panel.addEventListener("pointerleave", onLeave);
    card.addEventListener("focusin", onFocusIn);
    card.addEventListener("focusout", onFocusOut);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      panel.removeEventListener("pointermove", onMove);
      panel.removeEventListener("pointerleave", onLeave);
      card.removeEventListener("focusin", onFocusIn);
      card.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("visibilitychange", onVisibility);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [panelRef, cardRef, radius, expandAt]);

  return { expanded };
}

function clamp(x: number, lo: number, hi: number) {
  return x < lo ? lo : x > hi ? hi : x;
}
