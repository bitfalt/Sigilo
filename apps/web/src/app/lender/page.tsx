import type { Metadata } from "next";

import { LenderConsole } from "@/components/lender/lender-console";

export const metadata: Metadata = {
  title: "Income checks",
  robots: { index: false, follow: false },
};

// Demo lender console — SPEC.md §3 and §4 (flows F5, F6).
export default function Page() {
  return <LenderConsole />;
}
