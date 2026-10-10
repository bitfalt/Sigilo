"use client";

import { useEffect } from "react";

// Client half of the landing's motion (the choreography itself lives in landing.css):
// 1. Measures each of María's pieces' flight, from her payslip's net pay to its ledger slot, into
//    CSS variables, so the same keyframes fit any layout.
// 2. Where CSS scroll timelines are missing (and for the stamp everywhere), plays each moment once
//    when it arrives: [data-play] goes "armed" (hidden at its first frame) → "on".
// Renders nothing; without it (or with reduced motion) the page simply shows its final layout.

const SPIN = [-9, 7, -5, 10];
const START_SCALE = 1.5; // lp-fly's 0% scale

/** Layout position relative to `root` (or the page), ignoring transforms: an animation may be
 *  mid-flight or holding its enlarged first frame. */
function layoutBox(el: HTMLElement, root: HTMLElement | null) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function measureSplit(split: HTMLElement) {
  const from = split.querySelector<HTMLElement>("[data-split-from]");
  const payslip = from?.closest<HTMLElement>("figure");
  if (!from || !payslip) return;
  const src = layoutBox(from, split);
  const card = layoutBox(payslip, split);
  for (const piece of split.querySelectorAll<HTMLElement>("[data-piece]")) {
    const k = Number(piece.dataset.piece);
    const slot = layoutBox(piece, split);
    // Each piece starts hidden under the payslip (at the keyframes' 1.5× scale), just inside the
    // bottom edge that the tilt lifts, below the net pay, fanned so they come out one by one.
    const w = slot.w * START_SCALE;
    const h = slot.h * START_SCALE;
    const cx = src.x + w / 2 + k * 8;
    const cy = card.y + card.h - 6 - h / 2 - k * 5;
    const dx = cx - (slot.x + slot.w / 2);
    const dy = cy - (slot.y + slot.h / 2);
    // Bow the path: side by side, a swoop through the empty space under the payslip; stacked,
    // out to the right (the ledger's empty side) as it drops.
    const beside = slot.x >= card.x + card.w - 1;
    const bow = Math.min(90, 30 + Math.hypot(dx, dy) * 0.3);
    const ax = beside ? 0 : bow;
    const ay = beside ? bow * 0.6 : -bow * 0.25;
    piece.style.setProperty("--dx", `${dx.toFixed(1)}px`);
    piece.style.setProperty("--dy", `${dy.toFixed(1)}px`);
    piece.style.setProperty("--ax", `${ax.toFixed(1)}px`);
    piece.style.setProperty("--ay", `${ay.toFixed(1)}px`);
    piece.style.setProperty("--rz", `${SPIN[k % SPIN.length]}deg`);
  }
}

export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cleanups: Array<() => void> = [];

    const split = document.querySelector<HTMLElement>("[data-split]");
    if (split) {
      const measure = () => measureSplit(split);
      measure();
      const resize = new ResizeObserver(measure);
      resize.observe(split);
      document.fonts?.ready.then(measure);
      cleanups.push(() => resize.disconnect());
    }

    // Play-once fallback. With scroll timelines the split is scrubbed by scroll instead.
    const scrollDriven = CSS.supports("animation-timeline: view()");
    const targets = [...document.querySelectorAll<HTMLElement>("[data-play]")].filter(
      (el) => !(scrollDriven && el.hasAttribute("data-split")),
    );
    const arrive = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.play = "on";
          arrive.unobserve(entry.target);
        }
      },
      { threshold: 0.55 },
    );
    for (const el of targets) {
      // Only what hasn't been seen yet: anything already 30% on screen (or above) is left alone.
      const box = layoutBox(el, null);
      if (box.y - window.scrollY < window.innerHeight - box.h * 0.3) continue;
      el.dataset.play = "armed";
      arrive.observe(el);
    }
    cleanups.push(() => {
      arrive.disconnect();
      // Never leave anything hidden behind: unplayed moments fall back to their final state.
      for (const el of targets) if (el.dataset.play === "armed") el.dataset.play = "";
    });

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
