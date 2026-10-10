import type { CSSProperties } from "react";

import { Guilloche } from "./guilloche";
import { SealMark } from "./seal-mark";
import { styles } from "./styles";
import { Container, RevealHeading } from "./words";

// "If our servers leak": what a thief would find, row by row. Each row starts as the readable
// record an ordinary payroll database keeps and is sealed as it scrolls up. The last one was never
// there to begin with. Then the passkey: no passwords, and a new phone is the same account.

const ROWS = [
  {
    what: "Team roster",
    plain: "María R., $2,400.00 a month",
    sealed: "Encrypted on Acme's device",
  },
  {
    what: "Payslips",
    plain: "October 2026, net pay $2,400.00",
    sealed: "Sealed to María's passkey",
  },
  {
    what: "Who got which payment",
    plain: "4 payments to María",
    sealed: "Never stored",
    absent: true,
  },
];

export function Sealed() {
  return (
    <section aria-labelledby="sealed-title" className={styles.dark}>
      <div className={styles.darkRosette} aria-hidden="true" data-par="">
        <Guilloche className="h-full w-full" />
      </div>
      <Container className="relative grid gap-14 py-20 md:py-28 lg:grid-cols-12 lg:gap-10">
        <div className="lg:col-span-5">
          <RevealHeading
            id="sealed-title"
            text="If our servers leak, your salary doesn't."
            className={`${styles.heading} ${styles.h2}`}
          />
          <p className={`${styles.lede} ${styles.body} mt-6 max-w-[46ch]`}>
            Names, salaries and payslips are encrypted on the employer&apos;s and the worker&apos;s
            own devices before they reach Sigilo. Our servers keep only sealed data, and never which
            payment belongs to whom. Not even we can open it.
          </p>
        </div>

        <figure className="lg:col-span-7 lg:pl-6" data-play="" data-scrub="">
          <figcaption className={`${styles.muted} mb-4 text-sm`}>
            What a thief would find on our servers
          </figcaption>
          <dl className={styles.vault}>
            {ROWS.map((row, k) => (
              <div key={row.what} className={styles.vaultRow} style={{ "--k": k } as CSSProperties}>
                <dt className="font-semibold">{row.what}</dt>
                <dd className={styles.vaultCell}>
                  <span className={styles.vaultPlain} aria-hidden="true">
                    {row.plain}
                  </span>
                  <span className={`${styles.seal} ${row.absent ? styles.sealAbsent : ""}`}>
                    {row.absent ? null : <SealMark className="size-5 shrink-0" />}
                    {row.sealed}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </figure>

        <div className={`${styles.passkeys} grid gap-10 pt-12 sm:grid-cols-2 lg:col-span-12`}>
          <div>
            <h3 className={`${styles.heading} ${styles.h3}`}>
              No passwords. Nothing to write down.
            </h3>
            <p className={`${styles.lede} ${styles.body} mt-3 max-w-[46ch]`}>
              Your account is a passkey that unlocks the way your phone already does, with your
              face, fingerprint or PIN. There&apos;s no password to steal and nothing for a fake
              site to phish.
            </p>
          </div>
          <div>
            <h3 className={`${styles.heading} ${styles.h3}`}>A new phone, the same account.</h3>
            <p className={`${styles.lede} ${styles.body} mt-3 max-w-[46ch]`}>
              Sign in with your passkey on a new phone and your balance, payslips and Income
              Passport are all there. Nothing secret is kept on the device, so a lost phone is just
              a lost phone.
            </p>
          </div>
        </div>
      </Container>
    </section>
  );
}
