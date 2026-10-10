import Link from "next/link";
import type { CSSProperties } from "react";

import { Guilloche } from "./guilloche";
import { styles } from "./styles";
import { Container, Words } from "./words";

// The hero's art: María's last three payslips stacked like paper on a desk, the Income Passport
// stamp pressed over them, a guilloche rosette behind. On load the payslips print in back to front
// and the stamp comes down; on scroll the layers fan apart at different depths (landing.css).

// The two older payslips sit mostly underneath: they show their month, and their contents stay
// sealed (blank bars), so no half-hidden figures peek out from under October's.
const MONTHS = [
  { month: "August", layer: styles.layerAug, delay: 260, sealed: true },
  { month: "September", layer: styles.layerSep, delay: 420, sealed: true },
  { month: "October", layer: styles.layerOct, delay: 580, sealed: false },
];

function Bar({ width }: { width: string }) {
  return <span className={styles.sealedBar} style={{ width }} />;
}

function HeroPayslip({ month, delay, sealed }: { month: string; delay: number; sealed: boolean }) {
  return (
    <div
      className={`${styles.slip} ${styles.print} p-4 sm:p-5`}
      style={{ "--d": delay } as CSSProperties}
    >
      <div className="flex items-baseline justify-between gap-3 text-sm font-semibold sm:text-base">
        <p className={sealed ? "invisible" : ""}>Acme Labs</p>
        <p>{month} 2026</p>
      </div>
      <p className={`${styles.muted} text-xs sm:text-sm`}>Payslip</p>
      <dl className="mt-3 space-y-1 text-xs sm:mt-4 sm:text-sm">
        <div className="flex justify-between">
          <dt className={styles.muted}>{sealed ? <Bar width="5.5em" /> : "Gross pay"}</dt>
          <dd>{sealed ? <Bar width="4.5em" /> : "$2,400.00"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className={styles.muted}>{sealed ? <Bar width="6em" /> : "Deductions"}</dt>
          <dd>{sealed ? <Bar width="3em" /> : "$0.00"}</dd>
        </div>
      </dl>
      <div className={`${styles.slipStub} mt-3 pt-3 sm:mt-4`}>
        <p className={`${styles.muted} text-xs sm:text-sm`}>
          {sealed ? <Bar width="4em" /> : "Net pay"}
        </p>
        <p className={`${styles.heading} text-2xl sm:text-4xl`}>
          {sealed ? <Bar width="5.2em" /> : "$2,400.00"}
        </p>
        <p className={`${styles.fine} ${styles.muted} mt-1`}>Only María can open this payslip.</p>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className={styles.hero}>
      <Container className="grid items-center gap-x-8 gap-y-14 pt-6 pb-16 sm:pt-10 md:pb-24 lg:grid-cols-12 lg:pt-12 lg:pb-28">
        <div className="lg:col-span-7">
          <h1 id="hero-title" className={`${styles.display} ${styles.heroTitle}`}>
            <span className="block">
              <Words text="Get paid in private." />
            </span>
            <span className="block">
              <Words text="Prove it in seconds." from={4} />
            </span>
          </h1>
          <p className={`${styles.lede} ${styles.heroSub} mt-6 max-w-[44ch] sm:mt-8`}>
            Sigilo pays remote teams in digital dollars without putting a single salary on public
            record. Each worker gets one private balance, and an Income Passport that tells a
            landlord or lender they earn enough, without showing how much.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/employer" className={styles.primary}>
              Set up private payroll
            </Link>
            <Link href="/app" className={styles.secondary}>
              Open your account
            </Link>
          </div>
          <p className={`${styles.muted} mt-4 text-sm`}>
            Invited by your employer? Open the link they sent you.
          </p>
        </div>

        <div className="lg:col-span-5">
          <div
            className={styles.heroArt}
            role="img"
            aria-label="María's payslips for August, September and October, stamped: Income verified, at least $1,500 a month for 3 months, from a verified employer."
            data-play=""
            data-par="page"
          >
            <div className={`${styles.layer} ${styles.layerRosette}`}>
              <Guilloche className="h-full w-full" />
            </div>
            {MONTHS.map(({ month, layer, delay, sealed }) => (
              <div key={month} className={`${styles.layer} ${layer}`}>
                <HeroPayslip month={month} delay={delay} sealed={sealed} />
              </div>
            ))}
            <div className={`${styles.layer} ${styles.layerStamp}`}>
              <div className={`${styles.stamp} ${styles.press} p-3 sm:p-4`}>
                <p className={`${styles.heading} text-base sm:text-xl`}>Income verified</p>
                <p className="mt-1 text-xs leading-snug sm:text-sm">
                  At least $1,500 a month for 3 months, from a verified employer.
                </p>
                <p className="mt-1 text-[11px] opacity-80 sm:text-xs">
                  Salary and employer not shared.
                </p>
              </div>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
