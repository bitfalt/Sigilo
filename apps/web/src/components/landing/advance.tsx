import { styles } from "./styles";
import { Container, RevealHeading } from "./words";

// The salary advance, shown as the payslip it changes: November's deduction line prints onto
// María's payslip, her net pay updates, and the installment slides off to the lender.
// $450 at a 2% fee is $459, repaid in two installments of $229.50.

export function Advance() {
  return (
    <section id="advance" aria-labelledby="advance-title" className={styles.section}>
      <Container className="grid gap-14 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5 lg:col-start-8 lg:row-start-1">
          <RevealHeading
            id="advance-title"
            text="Borrow against your next paycheck."
            className={`${styles.heading} ${styles.h2}`}
          />
          <p className={`${styles.lede} ${styles.body} mt-6 max-w-[46ch]`}>
            Once a lender has checked María&apos;s Income Passport, it can offer her an advance:
            $450 today, repaid from her next two paychecks with a 2% fee.
          </p>
          <p className={`${styles.lede} ${styles.body} mt-4 max-w-[46ch]`}>
            Acme&apos;s payroll takes each installment out before the money reaches her, the way
            payroll loans work across Latin America, like crédito consignado in Brazil or libranza
            in Colombia. The lender is repaid at the source, so it takes less risk and can charge
            less.
          </p>
        </div>

        <figure
          className={`${styles.advance} lg:col-span-6 lg:col-start-1 lg:row-start-1 lg:self-start`}
          data-play=""
          data-scrub=""
        >
          <div className={`${styles.slip} ${styles.wipe} ${styles.advanceSlip} p-5 sm:p-7`}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-semibold sm:text-lg">Acme Labs</p>
              <p className={`${styles.fine} ${styles.muted}`}>Only María can open this</p>
            </div>
            <p className={`${styles.muted} text-sm`}>Payslip, November 2026</p>
            <dl className="mt-5 space-y-2 text-sm sm:text-base">
              <div className="flex justify-between gap-4">
                <dt className={styles.muted}>Gross pay</dt>
                <dd>$2,400.00</dd>
              </div>
              <div className={`${styles.deduction} flex justify-between gap-4`}>
                <dt>Advance repayment, 1 of 2</dt>
                <dd>−$229.50</dd>
              </div>
            </dl>
            <div className={`${styles.slipStub} mt-5 pt-4`}>
              <p className={`${styles.muted} text-sm`}>Net pay</p>
              <p className={`${styles.heading} ${styles.net} text-4xl sm:text-5xl`}>
                <span className={styles.netBefore} aria-hidden="true">
                  $2,400.00
                </span>
                <span className={styles.netAfter}>$2,170.50</span>
              </p>
              <p className={`${styles.muted} mt-2 text-sm`}>
                The second installment comes out of December&apos;s pay.
              </p>
            </div>
          </div>
          <div className={styles.installment}>
            <span className={`${styles.fine} ${styles.muted} block`}>Repaid from payroll</span>
            <span className="font-semibold">$229.50 to Fondo Quincena</span>
          </div>
        </figure>
      </Container>
    </section>
  );
}
