import { styles } from "./styles";
import { Container, RevealHeading, Words } from "./words";

// The problem, then the signature moment ("the split"): María's $2,400 payslip tips toward the
// public record and four pieces of her pay fly out from under it into a ledger of identical
// payments to brand-new accounts. Choreography in landing.css; flight paths in landing-motion.tsx.

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

export function Problem() {
  return (
    <section aria-labelledby="problem-title" className={styles.section}>
      <Container>
        <RevealHeading
          id="problem-title"
          text="Digital-dollar payroll is public payroll."
          className={`${styles.heading} ${styles.h2} max-w-[18ch]`}
        />
        <p className={`${styles.ink} ${styles.statement} mt-8 sm:mt-10`} data-play="" data-scrub="">
          <Words text="Paying a remote team in digital dollars takes seconds. It also puts every salary on a public record, where anyone who learns a worker's account can see what they earn, who pays them and when. In much of Latin America, that's a safety problem, not just a privacy one." />
        </p>
      </Container>
    </section>
  );
}

export function Split() {
  return (
    <section aria-labelledby="split-title" className={styles.section}>
      <Container className="grid gap-x-10 gap-y-10 lg:grid-cols-12">
        <RevealHeading
          id="split-title"
          text="Everyone sees that payroll ran. No one sees who got what."
          className={`${styles.heading} ${styles.h2} max-w-[22ch] lg:col-span-12`}
        />
        <p className={`${styles.lede} ${styles.body} max-w-[46ch] lg:col-span-4`}>
          Sigilo splits each salary into standard amounts and sends every one to a brand-new account
          that only the worker can open, mixed in with the rest of the team&apos;s pay. María still
          sees one balance and one payslip.
        </p>

        <div
          className={`${styles.split} grid items-start gap-4 sm:grid-cols-2 lg:col-span-8`}
          data-split=""
          data-play=""
          data-scrub=""
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
            <figcaption className={`${styles.muted} text-sm`}>What everyone else sees</figcaption>
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
  );
}
