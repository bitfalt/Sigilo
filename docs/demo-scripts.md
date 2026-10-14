# Sigilo: recording scripts

Seven videos, all reusing the same setup. Read the narration at a calm pace; it's timed at about 150 words a minute. Lines in _italics_ are what you do on screen.

Upload each video to YouTube as **Unlisted** and paste the links into the form.

---

## 0. Set up once (about 25 minutes, before recording anything)

**Devices**
- **Mac**, Safari or Chrome with Apple Passwords (iCloud Keychain): employer and lender.
- **iPhone**, Safari: Daniel.
- **A second browser** for Mom: Chrome on the Mac with Google Password Manager, or a friend's phone.
- To show the iPhone on the Mac: plug it in → QuickTime Player → File → New Movie Recording → click the ▾ next to the record button → choose your iPhone as camera. Record the Mac screen with ⌘⇧5 ("Record Entire Screen", microphone on).
- Browser zoom at 110–125%. Hide the bookmarks bar. Turn on Do Not Disturb.

**Data**
1. Mac → sigilo.work/employer → **Create company account**, name it **Acme Labs**. It's verified automatically.
2. Tap **Add test funds** twice. It gives $6,000 each time, with a 3-minute wait between clicks.
3. Add **yourself (Daniel)** at $2,000, plus 2 testers or friends at small salaries (about $300 each), so the testnet faucet covers four months. Copy each invite link and send it to them.
4. iPhone → open Daniel's invite → **Create my account** → **Activate Income Passport**.
5. Once everyone has joined, run payroll for **July** and **August** only. Save **September** for the camera.
6. Second browser → sigilo.work/app → create an account named **Mamá** → **Get money from family** → send the link to your iPhone (AirDrop or WhatsApp). Open it once on the iPhone so Mamá is saved as a contact.
7. Open sigilo.work/lender in a second Mac window.
8. Tell Claude when September has run. It runs the Chainlink payday check on production, so the lender sees "checked by Chainlink".

---

## 1. Technical demo (≤ 3:00)

| Time | Screen | Narration |
|---|---|---|
| 0:00 | _sigilo.work landing. Scroll slowly through the hero and "the split"._ | "If your company pays you in stablecoins, your salary is on a public ledger. Anyone who learns your account knows what you earn, who pays you, and when. Sigilo is payroll that doesn't do that." |
| 0:15 | _Mac, /employer, Acme Labs. Point at the team list._ | "This is Acme Labs. Names and salaries are encrypted right here in the browser. Our server only ever sees ciphertext." |
| 0:25 | _Pick September → **Run payroll**. Let the steps finish until the "Payroll sent" stamp._ | "One click runs payroll. Every salary is split into standard-size pieces and each piece goes to a brand-new account, all shuffled into a single payment on Monad." |
| 0:45 | _Click **What the internet sees** on that run._ | "This is all the public can see: a company paid some identical-looking pieces to new accounts. Which ones are Daniel's? There's no way to tell." |
| 0:58 | _iPhone: Daniel's app. Balance envelope, then open the September payslip._ | "Daniel just sees one balance and his payslip, decrypted on his phone. No seed phrase, no gas. His passkey is his account." |
| 1:10 | _Mac lender: **New income check**, $1,500 → **Create**. QR on screen._ | "Now he wants a loan. Fondo Quincena asks: does he earn at least fifteen hundred a month?" |
| 1:18 | _iPhone: scan the QR. Show "They will see / They won't see". **Share my Income Passport** → Face ID → "Sealing your Income Passport" → "Sent to Fondo Quincena"._ | "He answers with his Income Passport. His phone builds a zero-knowledge proof in a few seconds. The lender learns one sentence: at least fifteen hundred, three months in a row, verified employer. Not his salary, not his employer." |
| 1:40 | _Mac: **Verify for $0.10** → the "Income verified" stamp. Point at the payment box (From Fondo Quincena's account, Payment on Monad), "checked by Chainlink" and the Applicant ID._ | "The lender's back office pays ten cents through MPP to check it: our API answers 402, their server pays from its own account, no checkout, and here's the payment on Monad. The payroll records behind it are re-checked independently by Chainlink. And this applicant ID only exists for this lender." |
| 1:55 | _Mac: **Offer a salary advance**, $450, 2 paychecks. iPhone: the offer card appears on his account → **See the offer** → **Take $450** → Face ID → "The money is yours"._ | "Now the lender can offer an advance. Daniel takes it, the money lands instantly, and his employer's next two payrolls repay it automatically. That's how payroll loans work in Latin America, and it's why they're cheap." |
| 2:15 | _iPhone: **Send home** → Mamá → $200 → "Delivered in 0.7 s". Cut to Mom's screen: "Money from Daniel"._ | "And he can send money home. Agora converts it to local money on the way, and it lands in under a second." |
| 2:30 | _iPhone: **Lock**, then **Sign in with passkey**. Everything is back._ | "Nothing secret is stored on his phone or our servers. Lose the phone, sign in with the passkey, and everything comes back." |
| 2:42 | _sigilo.work/network, scroll "What the internet can learn"._ | "We even measure our own privacy from the public record. Sigilo: get paid in private, prove it in seconds." |

**If you're over 3:00, cut** the Lock beat (2:30) first, then shorten the advance.

---

## 2. Pitch (≤ 2:00), with the deck at sigilo.work/pitch

Use → to advance. One slide per paragraph. 

1. **(Title)** "Hi, I'm Daniel, and this is Sigilo, the original proof of work."
2. **(Problem)** "Paying remote teams in stablecoins is fast and cheap. But it turns payroll into a public record. Anyone who learns my account sees what I earn, who pays me and when, and in Latin America that makes you a target. Then I try to rent an apartment, and they ask for my payslips and bank statements anyway."
3. **(Insight)** "Here's what we noticed. The cheapest consumer credit in Latin America is deducted straight from payroll. Crédito consignado in Brazil, deducción de planilla here in Costa Rica. Whoever runs payroll can offer it. So we built a private payroll rail."
4. **(Product)** "Three layers. Private payroll: salaries split into same-size pieces, paid to fresh accounts, with names and salaries encrypted on the device. An Income Passport: I prove I earn at least fifteen hundred a month without showing my salary or my employer. And revenue: lenders pay ten cents per check, and advances are repaid straight from the next payroll."
5. **(What the internet sees)** "On-chain you see that a company paid. You can't see who got what."
6. **(Built)** "It's live today on Monad testnet. Passkeys from Mera instead of wallets, Noir proofs on the phone, Agora for sending money home, MPP for paid checks, Chainlink re-checking our payroll records, and Envio measuring how private we really are. Four people are testing it right now, all family, which is honestly the toughest crowd."
7. **(Business)** "We charge employers per worker, lenders per check, and take a share of advance origination. We start with LatAm teams already paid in stablecoins, Costa Rica first. Then, with a banking partner like Bridge, any business in the region, with nobody touching a stablecoin."
8. **(Team)** "I'm Daniel, a builder and engineer learning zero-knowledge by shipping it. I built Sigilo solo in four days. Get paid in private, prove it in seconds. Thank you."

Record yourself on camera in the corner (QuickTime webcam, or Loom), with the deck full screen (press **f**).

---

## 3. Agora: send home (≤ 2:00)

Must show: passkey onboarding, an AUSD balance, and a completed send and receive.

| Screen | Narration |
|---|---|
| _Second browser: sigilo.work/app → type "Mamá" → **Create my account** → passkey prompt → dashboard._ | "This is Daniel's mom in Costa Rica. She creates her Sigilo account with a passkey. No app, no seed phrase, done in a second." |
| _Mamá: **Get money from family** → the QR and link._ | "She shares this link with her son." |
| _iPhone (Daniel): dashboard. Zoom on "Digital dollars (AUSD)" under the balance._ | "Daniel is paid in AUSD. His salary is spread across several private accounts, but he sees one balance." |
| _iPhone: **Send home** → Mamá → $200 → **Send $200 to Mamá**._ | "He sends two hundred dollars home. Behind this button, each piece of his balance signs an authorization tied to this exact payment, and our relayer submits it. He never needs gas." |
| _"Delivered in 0.7 s"._ | "Our SigiloPay contract swaps the AUSD on Agora's Instant Settlement pair at a fixed price and delivers it to a brand-new account that only his mom controls." |
| _Mamá's screen: balance updates, "Money from Daniel"._ | "Settled in under a second. His mom sees the money arrive, and Sigilo never learned who sent it." |
| _Optional: the transaction on the explorer._ | "Payroll, income checks and advances all run on AUSD too." |

---

## 4. Chainlink CRE (≤ 2:00)

Must show a successful simulation with the CRE CLI. We also broadcast for real.

**Terminal setup:** large font. `cd ~/Developer/Sigilo/packages/cre`, then clear the screen.

| Screen | Narration |
|---|---|
| _Editor: `packages/cre/payday/workflow.yaml`, then `main.ts` (the two handlers)._ | "Every Income Passport is proven against payroll records that Sigilo publishes on Monad. Our CRE workflow, payday, makes sure we don't have to be trusted for that. It runs every payday and every time a new payroll record is published." |
| _Run the local simulation (command A below). Let the log lines print._ | "It calls Sigilo's backend for the public payroll data, with consensus across nodes. No employer or salary ever leaves our side. Then every node rebuilds the Poseidon2 payroll tree itself, and checks it against the root on Monad." |
| _Point at the `[check] ... (OK)` and the `[advance]` lines._ | "It also reads every salary advance from the lender's vault and flags installments that payroll didn't repay on time." |
| _Run the broadcast (command B below). Point at `[write] SigiloOracle updated in 0x...`._ | "Now for real: the signed report goes through Chainlink's Monad forwarder to our SigiloOracle contract." |
| _Open the transaction on testnet.monadvision.com._ | "There it is on Monad testnet." |
| _sigilo.work/lender, a verified check: "Payroll records checked independently by Chainlink"._ | "And this is where it matters: lenders see that the payroll records behind an Income Passport were checked independently by Chainlink." |

Command A, local simulation (no key needed):
```bash
~/.cre/bin/cre workflow simulate payday --target local-simulation --non-interactive --trigger-index 0
```

Command B, broadcast to Monad testnet. The key is read from `.env` and never printed.
```bash
( set -a; . ../../.env; set +a; export CRE_ETH_PRIVATE_KEY="$DEPLOYER_PRIVATE_KEY"; ~/.cre/bin/cre workflow simulate payday --target production-settings --non-interactive --trigger-index 0 --broadcast )
```
`production-settings` checks sigilo.work's own payroll records (tested: it confirmed production's record in tx 0x0bc72ab747515cdf4d97340f2a5c50f8d6bcf1962754246bb83ebe9a8f06f2e9). Run it right after the September payroll so the lender's verified check shows "checked by Chainlink".

---

## 5. Envio (≤ 2:00)

Must show data flowing end to end through HyperIndex.

| Screen | Narration |
|---|---|
| _Mac: run payroll somewhere (or reuse the September run). Then the Envio dashboard: the `sigilo` indexer, synced, events._ | "Every payroll, payment and advance in Sigilo is indexed by our Envio HyperIndex indexer, reading Monad testnet through HyperSync." |
| _Editor: `packages/indexer/config.yaml` and `schema.graphql`. Scroll the entities._ | "Payroll pieces aren't in any event, so the handler decodes them from the payout's calldata. On top of that we build aggregates: network totals, a portfolio per lender, and clusters." |
| _Envio GraphQL playground: paste the query below and run it._ | "The interesting part: the indexer plays the attacker. It measures what a stranger can learn from the public record, like how big the crowd is in each payroll and which pieces got linked when they were spent together." |
| _sigilo.work/network. Scroll: "Sigilo in numbers", the 78% unlinked number, "What spending reveals"._ | "That powers this public page, live. It's honest: a one-person payroll hides nothing, and the page says so." |
| _sigilo.work/lender, the "Your advances" portfolio. Then a /record page, "Since payday"._ | "It also runs the lender's portfolio, lent, owed and repaid straight from the chain, and the public record of every payroll." |

Query for the playground:
```graphql
{
  NetworkStats { payrollRuns pieces paidVolume unlinkedShare clusters advancesIssued }
  PayrollRun(order_by: { timestamp: desc }, limit: 3) { txHash pieceCount total largestGroup }
}
```

---

## 6. Mera UX (≤ 2:00, optional)

| Screen | Narration |
|---|---|
| _iPhone, fresh: open an employer invite → **Create my account** → one Face ID → **Activate Income Passport** → dashboard with "ready in X seconds, with N taps"._ | "Mera is our whole account layer. No email, no wallet, no seed phrase. One passkey prompt and Daniel has an account, and we show him how long it took." |
| _Open payslips, start a send home: no prompt._ | "The passkey derives his key and opens a Mera signing session. Inside it, checking his balance, opening payslips or sending money needs no extra prompt, and he never pays gas." |
| _Answer an income check: Face ID appears again._ | "Sensitive things ask again: sharing his Income Passport, taking an advance, or Advanced settings." |
| _Show **Lock** → Welcome back → **Sign in with passkey**._ | "The session locks itself after fifteen minutes, and nothing secret is ever stored." |
| _Mac (synced passkey): sigilo.work/app → **Sign in with a passkey** → same balance and payslips._ | "On a new device it's the same passkey, and everything is rebuilt from it." |

---

## 7. Mera: One Passkey, Many Keys (≤ 2:00, optional)

| Screen | Narration |
|---|---|
| _Editor: `packages/core/src/keys.ts`, the three salts._ | "Sigilo uses three Mera PRF salts as separate namespaces, and most of what they produce never signs a transaction." |
| _iPhone: open a payslip._ | "The account namespace derives a key that decrypts payslips. Employers encrypt to it in their browser, our server only stores ciphertext." |
| _iPhone: answer an income check; Face ID for the passport._ | "The passport namespace, behind its own prompt, derives a zero-knowledge secret. It proves his income, and gives every lender a different ID for him, so lenders can't link him." |
| _Mac: employer console, the team list._ | "The employer namespace encrypts the roster, names and salaries, before it leaves the browser." |
| _Mac in a fresh browser (same synced passkey): same payslips open; the lender shows the same Applicant ID on a second check._ | "And because nothing is stored, a second device with the same passkey decrypts the same payslips and gets the same ID with the same lender." |

---

## 8. Optional 30-second promo

Cut from the technical demo: the landing split (5 s), Run payroll (5 s), "What the internet sees" (5 s), the Income verified stamp (5 s), "Delivered in 0.7 s" (5 s), then the tagline card (5 s).
