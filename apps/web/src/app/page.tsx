import type { Metadata } from "next";
import Link from "next/link";

import { Guilloche } from "@/components/landing/guilloche";
import { LandingMotion } from "@/components/landing/landing-motion";
import { styles } from "@/components/landing/styles";
import { SealMark } from "@/components/landing/seal-mark";

export const metadata: Metadata = {
  title: { absolute: "Sigilo · The original proof of work" },
  description:
    "Get paid in digital dollars without your salary on display, prove what you earn without handing over your payslip, and borrow against your next paycheck.",
};

// What everyone else sees after Acme's payroll: identical amounts to brand-new accounts. María's
// $2,400 is four of them; `piece` orders their flight from her payslip in the scroll animation.
const PUBLIC_PIECES: { amount: string; piece?: number }[] = [
  { amount: "1,000.00", piece: 0 },
  { amount: "500.00" },
  { amount: "1,000.00" },
  { amount: "200.00", piece: 1 },
  { amount: "1,000.00", piece: 2 },
  { amount: "500.00" },
  { amount: "200.00", piece: 3 },
  { amount: "100.00" },
];

const STUBS = [
  {
    title: "Get paid privately",
    body: "Your salary arrives as identical amounts in accounts only you can open. You see one balance and spend it as one. Nobody else can tie those payments to you.",
  },
  {
    title: "Prove your income, not your payslip",
    body: "Show a landlord or lender that you earn at least $1,500 a month from a verified employer. They learn exactly that: not your salary, not your employer, not your other lenders.",
  },
  {
    title: "Borrow against your next paycheck",
    body: "Get an advance from a lender who checked your Income Passport. It's repaid from your next payroll before the money reaches you, which is why it costs less.",
  },
];

const SEALED = [
  { what: "Names and salaries", how: "Encrypted on the employer's device" },
  { what: "Payslips", how: "Sealed to each worker's passkey" },
  { what: "Who received which payment", how: "Never stored, anywhere" },
];

function Container({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

function Perforation() {
  return (
    <Container>
      <div className={styles.perforation} role="presentation" />
    </Container>
  );
}

export default function Home() {
  return (
    <div className={`${styles.page} flex min-h-full flex-1 flex-col`}>
      <header>
        <Container className="flex h-16 items-center justify-between gap-4 sm:h-20">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-sm focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[#2a3cb0]"
          >
            <SealMark className="size-7" />
            <span className={`${styles.heading} text-xl`}>Sigilo</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-6 text-sm font-medium">
            <a href="#workers" className="hidden hover:underline md:inline">
              Workers
            </a>
            <a href="#employers" className="hidden hover:underline md:inline">
              Employers
            </a>
            <a href="#lenders" className="hidden hover:underline md:inline">
              Lenders
            </a>
            <Link href="/app" className={`${styles.secondary} min-h-10 px-4 text-sm`}>
              Open your account
            </Link>
          </nav>
        </Container>
      </header>

      <main className="flex-1">
        <section aria-labelledby="hero">
          <Container className="grid items-center gap-10 py-10 sm:py-14 md:py-20 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <h1
                id="hero"
                className={`${styles.display} text-[clamp(2.6rem,8.5vw,5.6rem)] lg:text-[clamp(3rem,6.2vw,5.6rem)]`}
              >
                The original proof of work.
              </h1>
              <p className={`${styles.lede} mt-6 max-w-[36ch] text-lg sm:text-xl`}>
                Get paid in digital dollars without your salary on display. Prove what you earn
                without handing over your payslip. Borrow against your next paycheck.
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

            <div className="lg:col-span-6">
              <div
                className={`${styles.heroArt} relative mx-auto aspect-[5/6] w-full max-w-[540px] sm:aspect-square`}
              >
                <Guilloche className={`${styles.lathe} absolute inset-0 h-full w-full`} />

                <div
                  className={`${styles.slip} ${styles.driftSlip} absolute top-[6%] left-[3%] w-[76%] -rotate-3 p-4 sm:top-[16%] sm:left-[8%] sm:w-[66%] sm:p-6`}
                >
                  <p className="text-sm font-semibold sm:text-base">Acme Labs</p>
                  <p className={`${styles.muted} text-xs sm:text-sm`}>Payslip, October 2026</p>
                  <dl className="mt-3 space-y-1 text-xs sm:mt-4 sm:text-sm">
                    <div className="flex justify-between">
                      <dt className={styles.muted}>Gross pay</dt>
                      <dd>$2,400.00</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className={styles.muted}>Deductions</dt>
                      <dd>$0.00</dd>
                    </div>
                  </dl>
                  <div className={`${styles.slipStub} mt-3 pt-3 sm:mt-4`}>
                    <p className={`${styles.muted} text-xs sm:text-sm`}>Net pay</p>
                    <p className={`${styles.heading} text-2xl sm:text-4xl`}>$2,400.00</p>
                    <p className={`${styles.muted} mt-1 text-[11px] sm:text-xs`}>
                      Only María can open this payslip.
                    </p>
                  </div>
                </div>

                <div
                  className={`${styles.driftStamp} absolute right-[2%] bottom-[4%] w-[66%] sm:right-[3%] sm:bottom-[7%] sm:w-[56%]`}
                >
                  <div className={`${styles.stamp} ${styles.press} p-3 sm:p-4`} data-play="">
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

        <Perforation />

        <section aria-labelledby="problem">
          <Container className="grid gap-10 py-16 md:py-24 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <h2 id="problem" className={`${styles.heading} text-[clamp(2rem,4.4vw,3.3rem)]`}>
                Digital-dollar payroll is public payroll.
              </h2>
              <p className={`${styles.lede} mt-6 max-w-[52ch] text-base sm:text-lg`}>
                Paying a remote team in digital dollars is fast and cheap. But every payment lands
                on a public record, so anyone who learns a worker&apos;s account can read what they
                earn, who pays them and when. In much of Latin America, that&apos;s a safety
                problem, not just a privacy one.
              </p>
              <p className={`${styles.lede} mt-4 max-w-[52ch] text-base sm:text-lg`}>
                Sigilo splits every salary into identical amounts and sends each one to a brand-new
                account that only the worker can open.
              </p>
            </div>

            <div
              className={`${styles.split} grid items-start gap-4 sm:grid-cols-2 lg:col-span-7`}
              data-split=""
              data-play=""
            >
              <figure className={`${styles.slip} ${styles.splitSource} flex flex-col p-5 sm:p-6`}>
                <figcaption className={`${styles.muted} text-sm`}>What María sees</figcaption>
                <p className="mt-6 text-sm">You got paid</p>
                <p className={`${styles.heading} text-4xl xl:text-5xl`}>
                  <span data-split-from="">$2,400.00</span>
                </p>
                <p className={`${styles.muted} mt-2 text-sm`}>Acme Labs, October 2026</p>
              </figure>
              <figure className={`${styles.panel} p-5 sm:p-6`}>
                <figcaption className={`${styles.muted} text-sm`}>
                  What everyone else sees
                </figcaption>
                <ul className="mt-4 text-sm">
                  {PUBLIC_PIECES.map(({ amount, piece }, i) => (
                    <li
                      key={i}
                      className={`${styles.ledgerRow} flex justify-between py-1.5`}
                      data-k={piece}
                    >
                      {piece === undefined ? (
                        <span>${amount}</span>
                      ) : (
                        <span className={styles.piece} data-piece={piece}>
                          <span className={styles.piecePaper} aria-hidden="true" />${amount}
                        </span>
                      )}
                      <span
                        className={`${styles.muted} ${piece === undefined ? "" : styles.pieceDest}`}
                      >
                        to a new account
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-sm font-medium">
                  Which of these are María&apos;s? There&apos;s no way to tell.
                </p>
              </figure>
            </div>
          </Container>
        </section>

        <Perforation />

        <section id="workers" aria-labelledby="workers-title">
          <Container className="py-16 md:py-24">
            <h2
              id="workers-title"
              className={`${styles.heading} max-w-[20ch] text-[clamp(2rem,4.4vw,3.3rem)]`}
            >
              Your paycheck works for you, and only you.
            </h2>
            <div className="mt-10 grid lg:grid-cols-3">
              {STUBS.map((stub, i) => (
                <article
                  key={stub.title}
                  className={`py-6 lg:px-8 lg:py-2 ${i > 0 ? "border-t border-dashed border-current/25 lg:border-t-0 lg:border-l" : ""} ${i === 0 ? "lg:pl-0" : ""}`}
                >
                  <h3 className={`${styles.heading} text-xl sm:text-2xl`}>{stub.title}</h3>
                  <p className={`${styles.lede} mt-3 text-base`}>{stub.body}</p>
                </article>
              ))}
            </div>
          </Container>
        </section>

        <Perforation />

        <section aria-label="For employers and lenders">
          <Container className="grid gap-14 py-16 md:grid-cols-2 md:gap-16 md:py-24">
            <div id="employers">
              <h2 className={`${styles.heading} text-[clamp(1.75rem,3.4vw,2.6rem)]`}>
                Pay your whole team in one click.
              </h2>
              <p className={`${styles.lede} mt-4 max-w-[48ch] text-base sm:text-lg`}>
                Add people, send each one an invite link, and run payroll in digital dollars to
                anywhere. Salaries stay confidential from everyone, including us.
              </p>
              <Link href="/employer" className={`${styles.primary} mt-6`}>
                Set up private payroll
              </Link>
            </div>
            <div id="lenders">
              <h2 className={`${styles.heading} text-[clamp(1.75rem,3.4vw,2.6rem)]`}>
                Lend on income you can trust.
              </h2>
              <p className={`${styles.lede} mt-4 max-w-[48ch] text-base sm:text-lg`}>
                Ask exactly what you need to know, like &ldquo;earns at least $1,500 a month for 3
                months&rdquo;, and get a verified answer in seconds. Pay per check, and get repaid
                straight from payroll.
              </p>
              <Link href="/lender" className={`${styles.secondary} mt-6`}>
                Verify an applicant&apos;s income
              </Link>
            </div>
          </Container>
        </section>

        <Perforation />

        <section aria-labelledby="blind">
          <Container className="grid gap-10 py-16 md:py-24 lg:grid-cols-12">
            <div className="lg:col-span-6">
              <h2 id="blind" className={`${styles.heading} text-[clamp(2rem,4.4vw,3.3rem)]`}>
                Even we can&apos;t see your salary.
              </h2>
              <p className={`${styles.lede} mt-6 max-w-[50ch] text-base sm:text-lg`}>
                If our database leaked tomorrow, it would show sealed envelopes and nothing else.
              </p>
            </div>
            <dl className="divide-y divide-current/15 border-y border-current/15 lg:col-span-6">
              {SEALED.map((row) => (
                <div
                  key={row.what}
                  className="flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <dt className="font-semibold">{row.what}</dt>
                  <dd className={styles.muted}>{row.how}</dd>
                </div>
              ))}
            </dl>
          </Container>
        </section>
      </main>

      <footer>
        <Perforation />
        <Container className="flex flex-col gap-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <SealMark className="size-5" />
            <span className="font-semibold">Sigilo</span>
            <span className={styles.muted}>sigilo.work</span>
          </div>
          <p className={styles.muted}>Testnet preview: payments use test dollars.</p>
        </Container>
      </footer>
      <LandingMotion />
    </div>
  );
}
