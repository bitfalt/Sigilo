import type { Metadata } from "next";
import Link from "next/link";

import { Advance } from "@/components/landing/advance";
import { Audiences } from "@/components/landing/audiences";
import { Closing, Faq, Imprint } from "@/components/landing/faq";
import { Hero } from "@/components/landing/hero";
import { LandingMotion } from "@/components/landing/landing-motion";
import { Passport } from "@/components/landing/passport";
import { SealMark } from "@/components/landing/seal-mark";
import { Sealed } from "@/components/landing/sealed";
import { SendHome } from "@/components/landing/send-home";
import { Problem, Split } from "@/components/landing/split";
import { styles } from "@/components/landing/styles";
import { Container, Perforation } from "@/components/landing/words";

export const metadata: Metadata = {
  title: { absolute: "Sigilo · The original proof of work" },
  description:
    "Get paid in digital dollars without your salary on display, prove what you earn without handing over your payslip, and borrow against your next paycheck.",
};

// The landing tells one month of María's pay: paid privately (the split), proven to a lender
// (Income Passport), borrowed against (advance), sent home; then who it's for, why a leak reveals
// nothing, questions and the close. Motion: landing.css + landing-motion.tsx.

export default function Home() {
  return (
    <div className={`${styles.page} flex min-h-full flex-1 flex-col`}>
      <header>
        <Container className="flex h-16 items-center justify-between gap-4 sm:h-20">
          <Link href="/" className={`${styles.brand} flex items-center gap-2`}>
            <SealMark className="size-7" />
            <span className={`${styles.heading} text-xl`}>Sigilo</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-6 text-sm font-medium">
            <a href="#employers" className={`${styles.navLink} hidden md:inline`}>
              Employers
            </a>
            <a href="#workers" className={`${styles.navLink} hidden md:inline`}>
              Workers
            </a>
            <a href="#lenders" className={`${styles.navLink} hidden md:inline`}>
              Lenders
            </a>
            <Link href="/app" className={`${styles.secondary} ${styles.small}`}>
              Open your account
            </Link>
          </nav>
        </Container>
      </header>

      <main className="flex-1">
        <Hero />
        <Perforation />
        <Problem />
        <Split />
        <Perforation />
        <Passport />
        <Advance />
        <SendHome />
        <Perforation />
        <Audiences />
        <Sealed />
        <Imprint />
        <Perforation />
        <Faq />
        <Closing />
      </main>

      <footer>
        <Perforation />
        <Container className="flex flex-col gap-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <SealMark className="size-5" />
            <span className="font-semibold">Sigilo</span>
            <span className={styles.muted}>sigilo.work</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
            <Link href="/network" className={styles.navLink}>
              Sigilo in numbers
            </Link>
            <p className={styles.muted}>Testnet preview: payments use test dollars.</p>
          </div>
        </Container>
      </footer>
      <LandingMotion />
    </div>
  );
}
