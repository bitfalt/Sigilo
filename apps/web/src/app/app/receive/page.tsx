import type { Metadata } from "next";

import { ReceiveMoney } from "@/components/worker/receive-money";

export const metadata: Metadata = {
  title: "Get money from family",
  robots: { index: false, follow: false },
};

// Receive link for Send home (SPEC.md F8).
export default function Page() {
  return <ReceiveMoney />;
}
