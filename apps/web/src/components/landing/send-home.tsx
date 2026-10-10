import { styles } from "./styles";
import { Container, RevealHeading } from "./words";

// Send home: $200 leaves María's balance, crosses the route (and a border) as you scroll, and
// lands on her mom's phone as local money. 0.7 s is the delivery time measured end to end.

export function SendHome() {
  return (
    <section id="send-home" aria-labelledby="send-title" className={styles.section}>
      <Container>
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-10">
          <RevealHeading
            id="send-title"
            text="Send money home in under a second."
            className={`${styles.heading} ${styles.h2} lg:col-span-6`}
          />
          <p className={`${styles.lede} ${styles.body} max-w-[46ch] lg:col-span-5 lg:col-start-8`}>
            María sends $200 to her mom from the same balance her salary lands in. Agora converts it
            to local money at a fixed price, and it arrives in 0.7 seconds. Her mom joined with a
            link and a passkey: nothing to download, no forms to fill in.
          </p>
        </div>

        <figure className={`${styles.send} mt-12 md:mt-16`} data-play="" data-scrub="">
          <div className={`${styles.slip} ${styles.wipe} ${styles.phone} p-5 sm:p-6`}>
            <p className={`${styles.fine} ${styles.muted}`}>María&apos;s phone</p>
            <p className="mt-3 text-sm">You sent</p>
            <p className={`${styles.heading} text-4xl`}>$200.00</p>
            <p className={`${styles.muted} mt-1 text-sm`}>to Mamá, confirmed with your passkey</p>
          </div>

          <div className={styles.route} aria-hidden="true">
            <span className={styles.routeLine} />
            <span className={styles.border} />
            <span className={styles.routeTime}>0.7 s</span>
            <span className={styles.traveller}>$200.00</span>
          </div>

          <div className={`${styles.slip} ${styles.wipe} ${styles.phone} p-5 sm:p-6`}>
            <p className={`${styles.fine} ${styles.muted}`}>Mamá&apos;s phone</p>
            <p className="mt-3 text-sm">María sent you</p>
            <div className={styles.received}>
              <p className={`${styles.heading} text-4xl`}>$200.00</p>
              <p className={`${styles.muted} mt-1 text-sm`}>
                Paid out in local money, at a fixed price
              </p>
            </div>
            <p className={`${styles.stamp} ${styles.deliveredStamp}`}>Delivered in 0.7 s</p>
          </div>
        </figure>
      </Container>
    </section>
  );
}
