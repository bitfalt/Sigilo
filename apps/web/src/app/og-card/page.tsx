import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Guilloche } from "@/components/landing/guilloche";
import { SealMark } from "@/components/landing/seal-mark";
import { styles } from "@/components/landing/styles";

// Source of the social share image (src/app/opengraph-image.jpg): a 1200×630 card built from the
// landing's own pieces. Development only; regenerate with `pnpm og:render` while `pnpm dev` runs.

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function OgCard() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div
      className={`${styles.page} relative overflow-hidden`}
      style={{ width: 1200, height: 630 }}
      data-og-card
    >
      <div className="absolute top-[56px] left-[72px] flex items-center gap-3">
        <SealMark className="size-11" />
        <span className={`${styles.heading} text-[34px]`}>Sigilo</span>
      </div>

      <div className="absolute top-[150px] left-[72px] w-[600px]">
        <h1 className={`${styles.display} text-[74px]`}>The original proof of work.</h1>
        <p className={`${styles.lede} mt-7 text-[26px] leading-snug`}>
          Get paid privately. Prove your income without showing your payslip. Borrow against your
          next paycheck.
        </p>
      </div>

      <p className={`${styles.muted} absolute bottom-[52px] left-[72px] text-[24px] font-semibold`}>
        sigilo.work
      </p>

      <div className="absolute top-[35px] right-[18px] h-[560px] w-[560px]">
        <Guilloche className="absolute inset-0 h-full w-full" />
        <div className={`${styles.slip} absolute top-[110px] left-[52px] w-[360px] -rotate-3 p-7`}>
          <p className="text-[22px] font-semibold">Acme Labs</p>
          <p className={`${styles.muted} text-[18px]`}>Payslip, October 2026</p>
          <div className={`${styles.slipStub} mt-5 pt-4`}>
            <p className={`${styles.muted} text-[18px]`}>Net pay</p>
            <p className={`${styles.heading} text-[50px]`}>$2,400.00</p>
            <p className={`${styles.muted} mt-1 text-[15px]`}>Only María can open this payslip.</p>
          </div>
        </div>
        <div className={`${styles.stamp} absolute right-[18px] bottom-[64px] w-[300px] p-5`}>
          <p className={`${styles.heading} text-[26px]`}>Income verified</p>
          <p className="mt-1 text-[17px] leading-snug">
            At least $1,500 a month for 3 months, from a verified employer.
          </p>
        </div>
      </div>

      <div className={`${styles.perforation} absolute right-[72px] bottom-[28px] left-[72px]`} />
    </div>
  );
}
