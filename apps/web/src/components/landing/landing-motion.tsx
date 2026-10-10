"use client";

import { useEffect } from "react";

// Client half of the landing's motion (the choreography itself lives in landing.css):
// 1. Measures each of María's pieces' flight, from her payslip's net pay to its ledger slot, into
//    CSS variables, so the same keyframes fit any layout.
// 2. Plays each moment once when it arrives, where CSS scroll timelines are missing (and for the
//    hero's load moment everywhere, when it starts below the fold): [data-play] goes "armed"
//    (held at its first frame) → "on". Elements marked [data-scrub] are scroll-driven in CSS when
//    the browser supports it, so they're left alone there.
// 3. Without scroll timelines, drives the parallax: one passive, rAF-throttled scroll listener
//    writes --p (0 → 1) on each [data-par] element from positions measured up front, so scrolling
//    never reads layout.
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

/** Play-once: hold every moment that hasn't been seen yet, and let it go when it arrives. */
function playOnArrival(targets: HTMLElement[]) {
  const play = (el: HTMLElement) => {
    el.dataset.play = "on";
    arrive.unobserve(el);
  };
  const arrive = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        // Mostly on screen, or (for anything taller than the screen) filling a good part of it.
        if (
          entry.intersectionRatio >= 0.55 ||
          entry.intersectionRect.height >= window.innerHeight * 0.45
        ) {
          play(entry.target as HTMLElement);
        }
      }
    },
    { threshold: [0.15, 0.3, 0.55] },
  );
  for (const el of targets) {
    // Only what hasn't been seen yet: anything already 30% on screen (or above) is left alone.
    const box = layoutBox(el, null);
    if (box.y - window.scrollY < window.innerHeight - box.h * 0.3) continue;
    el.dataset.play = "armed";
    arrive.observe(el);
  }
  return () => {
    arrive.disconnect();
    // Never leave anything hidden behind: unplayed moments fall back to their final state.
    for (const el of targets) if (el.dataset.play === "armed") el.dataset.play = "";
  };
}

/** Parallax without scroll timelines. [data-par="page"] follows the first screen of scrolling;
 *  any other [data-par] follows its own trip across the screen. */
function parallax(page: HTMLElement) {
  const layers = [...page.querySelectorAll<HTMLElement>("[data-par]")];
  if (!layers.length) return () => {};
  page.dataset.motion = "js";
  let boxes = layers.map((el) => layoutBox(el, null));
  let viewport = window.innerHeight;
  let frame = 0;

  const update = () => {
    frame = 0;
    const y = window.scrollY;
    layers.forEach((el, i) => {
      const box = boxes[i];
      const p =
        el.dataset.par === "page" ? y / viewport : (y + viewport - box.y) / (viewport + box.h);
      el.style.setProperty("--p", Math.min(1, Math.max(0, p)).toFixed(4));
    });
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const measure = () => {
    viewport = window.innerHeight;
    boxes = layers.map((el) => layoutBox(el, null));
    schedule();
  };

  measure();
  const resize = new ResizeObserver(measure);
  resize.observe(page);
  window.addEventListener("scroll", schedule, { passive: true });
  return () => {
    resize.disconnect();
    window.removeEventListener("scroll", schedule);
    cancelAnimationFrame(frame);
    delete page.dataset.motion;
  };
}

export function LandingMotion() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cleanups: Array<() => void> = [];
    const scrollDriven = CSS.supports("animation-timeline: view()");

    const split = document.querySelector<HTMLElement>("[data-split]");
    if (split) {
      const measure = () => measureSplit(split);
      measure();
      const resize = new ResizeObserver(measure);
      resize.observe(split);
      document.fonts?.ready.then(measure);
      cleanups.push(() => resize.disconnect());
    }

    const targets = [...document.querySelectorAll<HTMLElement>("[data-play]")].filter(
      (el) => !(scrollDriven && el.hasAttribute("data-scrub")),
    );
    cleanups.push(playOnArrival(targets));

    const page = document.querySelector<HTMLElement>(".lp-page");
    if (page && !scrollDriven) cleanups.push(parallax(page));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  return null;
}
