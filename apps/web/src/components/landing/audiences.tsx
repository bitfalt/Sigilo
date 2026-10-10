import Link from "next/link";

import { styles } from "./styles";
import { Container, RevealHeading } from "./words";

// How it works for each of the three people on a payslip. The ids are the header's anchors.

const AUDIENCES = [
  {
    id: "employers",
    title: "Employers pay the whole team in one click.",
    steps: [
      "Create a company account with a passkey. There's no password to share or lose.",
      "Add your team and send each person an invite link. Names and salaries are encrypted on your device.",
      "Run payroll once a month in digital dollars, wherever your people live. Advance repayments come out on their own.",
    ],
    cta: { href: "/employer", label: "Set up private payroll", primary: true },
  },
  {
    id: "workers",
    title: "Workers get paid, prove it and send it home.",
    steps: [
      "Join from your employer's link with a passkey. Nothing to install, nothing to write down.",
      "See one balance in digital dollars, and payslips only you can open.",
      "Share an Income Passport, send money to family, or take an advance on your next paycheck.",
    ],
    cta: { href: "/app", label: "Open your account", primary: false },
  },
  {
    id: "lenders",
    title: "Lenders check income in a minute.",
    steps: [
      "Ask what you need to know, like “at least $1,500 a month for 3 months.”",
      "Get a verified answer for $0.10 per check. No payslips to review, no documents to store.",
      "Offer an advance and get repaid straight from the applicant's payroll.",
    ],
    cta: { href: "/lender", label: "Verify an applicant's income", primary: false },
  },
];

export function Audiences() {
  return (
    <section aria-labelledby="who-title" className={styles.section}>
      <Container>
        <RevealHeading
          id="who-title"
          text="One payroll, three people."
          className={`${styles.heading} ${styles.h2}`}
        />
        <div className="mt-4 grid lg:mt-12 lg:grid-cols-3">
          {AUDIENCES.map((audience, i) => (
            <article
              key={audience.id}
              id={audience.id}
              aria-labelledby={`${audience.id}-title`}
              className={`${styles.audience} flex flex-col py-8 lg:px-8 lg:py-2 ${i === 0 ? "lg:pl-0" : ""} ${i === AUDIENCES.length - 1 ? "lg:pr-0" : ""}`}
            >
              <h3 id={`${audience.id}-title`} className={`${styles.heading} ${styles.h3}`}>
                {audience.title}
              </h3>
              <ul className={`${styles.steps} mt-6 flex-1`}>
                {audience.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              <div className="mt-8">
                <Link
                  href={audience.cta.href}
                  className={audience.cta.primary ? styles.primary : styles.secondary}
                >
                  {audience.cta.label}
                </Link>
              </div>
            </article>
          ))}
        </div>
      </Container>
    </section>
  );
}
