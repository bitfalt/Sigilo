import type { CSSProperties } from "react";

import { styles } from "./styles";
import { Container, RevealHeading } from "./words";

// The Income Passport, shown as the lender's copy of María's answer. As it scrolls up, everything
// the lender doesn't get (employer, salary, payslips) is blacked out, then the stamp comes down.

const FIELDS = [
  { label: "Employer", value: "Acme Labs" },
  { label: "Monthly salary", value: "$2,400.00" },
  { label: "Payslips", value: "August to October" },
];

const FACTS = [
  {
    term: "About 6 seconds",
    detail: "to seal an Income Passport on her phone. Nothing about her pay leaves it.",
  },
  {
    term: "A different ID for every lender",
    detail: "so two lenders can't compare notes about her.",
  },
  {
    term: "$0.10 per check",
    detail: "paid by the lender, for a verified answer in under a minute.",
  },
];

function Redacted({ children, k }: { children: string; k: number }) {
  return (
    <span className={styles.redact}>
      <span aria-hidden="true">{children}</span>
      <span className={styles.redactBar} style={{ "--k": k } as CSSProperties}>
        Not shared
      </span>
    </span>
  );
}

export function Passport() {
  return (
    <section id="passport" aria-labelledby="passport-title" className={styles.section}>
      <Container className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <RevealHeading
            id="passport-title"
            text="Prove your income without handing over your payslips."
            className={`${styles.heading} ${styles.h2}`}
          />
          <p className={`${styles.lede} ${styles.body} mt-6 max-w-[46ch]`}>
            Renting an apartment or taking a loan usually means giving a stranger your payslips and
            months of bank statements. An Income Passport answers the one question they need
            answered, and nothing else leaves María&apos;s phone.
          </p>
          <dl className={`${styles.facts} mt-8`}>
            {FACTS.map((fact) => (
              <div key={fact.term}>
                <dt>{fact.term}</dt>
                <dd>{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <figure className={`${styles.passport} lg:col-span-7 lg:pl-6`} data-play="" data-scrub="">
          <figcaption className={`${styles.muted} mb-3 text-sm`}>
            What Fondo Quincena sees
          </figcaption>
          <div className={`${styles.doc} ${styles.wipe}`}>
            <p className={`${styles.fine} ${styles.muted}`}>Income check</p>
            <p className={`${styles.docQuestion} mt-2`}>
              Does this applicant earn at least $1,500 a month for the last 3 months, from a
              verified employer?
            </p>
            <dl className="mt-5 text-sm sm:text-base">
              {FIELDS.map((field, k) => (
                <div key={field.label} className={styles.docRow}>
                  <dt className={styles.muted}>{field.label}</dt>
                  <dd>
                    <Redacted k={k}>{field.value}</Redacted>
                  </dd>
                </div>
              ))}
            </dl>
            <div className={styles.docFoot}>
              <p className={`${styles.muted} text-sm`}>
                Checked for $0.10.
                <br />
                Answered from María&apos;s phone.
              </p>
              <div className={`${styles.stamp} ${styles.docStamp} p-3 sm:p-4`}>
                <p className={`${styles.heading} text-base sm:text-xl`}>Income verified</p>
                <p className="mt-1 text-xs leading-snug sm:text-sm">
                  At least $1,500 a month for 3 months, from a verified employer.
                </p>
              </div>
            </div>
          </div>
        </figure>
      </Container>
    </section>
  );
}
