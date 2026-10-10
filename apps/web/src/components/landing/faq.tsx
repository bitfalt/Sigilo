import Link from "next/link";

import { Guilloche } from "./guilloche";
import { styles } from "./styles";
import { Container, RevealHeading } from "./words";

// The close of the page: who it's built with (an imprint line, like the printer's mark on a
// banknote), common questions (native <details>, so they work without JavaScript) and the final
// call to action.

const IMPRINT = [
  { lead: "Built on", name: "Monad" },
  { lead: "Passkeys by", name: "Mera" },
  { lead: "Income Passports with", name: "Noir" },
  { lead: "Digital dollars by", name: "Agora", note: "(AUSD)" },
  { lead: "Pay-per-check API with", name: "MPP" },
];

const QUESTIONS = [
  {
    q: "Is my salary public?",
    a: "No. Your pay arrives as standard amounts in brand-new accounts that only you can open, mixed in with the rest of your team's pay. Anyone can see that your employer ran payroll. No one can tell which payments are yours or add them up. You see one balance.",
  },
  {
    q: "What does a lender see?",
    a: "Only the answer to the question they asked, like “earns at least $1,500 a month for the last 3 months, from a verified employer.” Not your employer's name, not your salary and not your payslips. Each lender also gets a different ID for you, so lenders can't compare notes.",
  },
  {
    q: "What if I lose my phone?",
    a: "Sign in with your passkey on your new phone. Passkeys are backed up by your password manager, like Apple Passwords or Google Password Manager, so your balance, payslips and Income Passport come right back. Nothing secret is stored on the phone itself.",
  },
  {
    q: "How do employers pay?",
    a: "Create a company account, add digital dollars and invite your team. Each month you run payroll with one click: Sigilo prepares it in your browser, seals each payslip and pays the whole team at once, wherever they live.",
  },
  {
    q: "What does it cost?",
    a: "Lenders pay $0.10 for each income check. Getting paid, opening payslips and sharing an Income Passport cost workers nothing. During this preview, every payment uses test dollars.",
  },
];

export function Imprint() {
  return (
    <section aria-label="Built with" className="py-10 md:py-12">
      <Container>
        <ul className={styles.imprint}>
          {IMPRINT.map((item) => (
            <li key={item.name}>
              <span className={styles.muted}>{item.lead}</span> <strong>{item.name}</strong>
              {item.note ? <span className={styles.muted}> {item.note}</span> : null}
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}

export function Faq() {
  return (
    <section id="questions" aria-labelledby="faq-title" className={styles.section}>
      <Container className="grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <RevealHeading
            id="faq-title"
            text="Questions people ask first."
            className={`${styles.heading} ${styles.h2}`}
          />
        </div>
        <div className={`${styles.faq} lg:col-span-8`}>
          {QUESTIONS.map((item) => (
            <details key={item.q}>
              <summary>
                <span>{item.q}</span>
                <span className={styles.faqIcon} aria-hidden="true" />
              </summary>
              <p className={`${styles.lede} ${styles.body}`}>{item.a}</p>
            </details>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function Closing() {
  return (
    <section aria-labelledby="close-title" className={styles.closing}>
      <div className={styles.closingRosette} aria-hidden="true" data-par="">
        <Guilloche className="h-full w-full" />
      </div>
      <Container className="relative pt-6 pb-24 md:pt-12 md:pb-36">
        <RevealHeading
          id="close-title"
          text="Make next month's payroll private."
          className={`${styles.display} ${styles.closingTitle} max-w-[14ch]`}
        />
        <p className={`${styles.lede} ${styles.heroSub} mt-6 max-w-[44ch]`}>
          Create a company account in a minute, invite your team with a link and pay everyone in one
          click. Your team is paid privately from the first run.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/employer" className={styles.primary}>
            Set up private payroll
          </Link>
          <Link href="/app" className={styles.secondary}>
            Open your account
          </Link>
        </div>
      </Container>
    </section>
  );
}
