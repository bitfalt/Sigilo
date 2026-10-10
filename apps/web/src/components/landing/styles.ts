// Class names for the landing stylesheet (landing.css). Plain globals with an "lp-" prefix,
// because this repo's Turbopack CSS rule (next.config.ts) breaks CSS modules. The first block is
// shared with the app surfaces (worker, employer, lender, og-card); keep those stable.
import "./landing.css";

export const styles = {
  // Shared with the app.
  band: "lp-band",
  display: "lp-display",
  heading: "lp-heading",
  inner: "lp-inner",
  lede: "lp-lede",
  line: "lp-line",
  link: "lp-link",
  muted: "lp-muted",
  page: "lp-page",
  perforation: "lp-perforation",
  primary: "lp-primary",
  rosette: "lp-rosette",
  secondary: "lp-secondary",
  slip: "lp-slip",
  slipStub: "lp-slip-stub",
  stamp: "lp-stamp",

  // Type and layout.
  body: "lp-body",
  brand: "lp-brand",
  fine: "lp-fine",
  h2: "lp-h2",
  h3: "lp-h3",
  navLink: "lp-nav-link",
  section: "lp-section",
  small: "lp-small",

  // Text reveals.
  ink: "lp-ink",
  reveal: "lp-reveal",
  statement: "lp-statement",
  word: "lp-w",
  wordInner: "lp-wi",
  wipe: "lp-wipe",

  // Hero.
  hero: "lp-hero",
  heroArt: "lp-hero-art",
  heroSub: "lp-hero-sub",
  heroTitle: "lp-hero-title",
  layer: "lp-layer",
  layerAug: "lp-layer-aug",
  layerOct: "lp-layer-oct",
  layerRosette: "lp-layer-rosette",
  layerSep: "lp-layer-sep",
  layerStamp: "lp-layer-stamp",
  press: "lp-press",
  print: "lp-print",
  sealedBar: "lp-sealed-bar",

  // The split.
  ledgerRow: "lp-ledger-row",
  panel: "lp-panel",
  piece: "lp-piece",
  pieceDest: "lp-piece-dest",
  piecePaper: "lp-piece-paper",
  split: "lp-split",
  splitSource: "lp-split-source",

  // Income Passport.
  doc: "lp-doc",
  docFoot: "lp-doc-foot",
  docQuestion: "lp-doc-question",
  docRow: "lp-doc-row",
  docStamp: "lp-doc-stamp",
  facts: "lp-facts",
  passport: "lp-passport",
  redact: "lp-redact",
  redactBar: "lp-redact-bar",

  // Advance.
  advance: "lp-advance",
  advanceSlip: "lp-advance-slip",
  deduction: "lp-deduction",
  installment: "lp-installment",
  net: "lp-net",
  netAfter: "lp-net-after",
  netBefore: "lp-net-before",

  // Send home.
  border: "lp-border",
  deliveredStamp: "lp-delivered",
  phone: "lp-phone",
  received: "lp-received",
  route: "lp-route",
  routeLine: "lp-route-line",
  routeTime: "lp-route-time",
  send: "lp-send",
  traveller: "lp-traveller",

  // Audiences.
  audience: "lp-audience",
  steps: "lp-steps",

  // Sealed (dark band).
  dark: "lp-dark",
  darkRosette: "lp-dark-rosette",
  passkeys: "lp-passkeys",
  seal: "lp-seal",
  sealAbsent: "lp-seal-absent",
  vault: "lp-vault",
  vaultCell: "lp-vault-cell",
  vaultPlain: "lp-vault-plain",
  vaultRow: "lp-vault-row",

  // Close.
  closing: "lp-closing",
  closingRosette: "lp-closing-rosette",
  closingTitle: "lp-closing-title",
  faq: "lp-faq",
  faqIcon: "lp-faq-icon",
  imprint: "lp-imprint",
} as const;
