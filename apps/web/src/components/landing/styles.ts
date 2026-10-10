// Class names for the landing stylesheet (landing.css). Plain globals with an "lp-" prefix,
// because this repo's Turbopack CSS rule (next.config.ts) breaks CSS modules.
import "./landing.css";

export const styles = {
  band: "lp-band",
  display: "lp-display",
  heading: "lp-heading",
  inner: "lp-inner",
  lede: "lp-lede",
  ledgerRow: "lp-ledger-row",
  line: "lp-line",
  link: "lp-link",
  muted: "lp-muted",
  page: "lp-page",
  panel: "lp-panel",
  perforation: "lp-perforation",
  primary: "lp-primary",
  rosette: "lp-rosette",
  secondary: "lp-secondary",
  slip: "lp-slip",
  slipStub: "lp-slip-stub",
  stamp: "lp-stamp",
} as const;
