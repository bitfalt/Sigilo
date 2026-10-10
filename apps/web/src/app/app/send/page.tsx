import type { Metadata } from "next";
import { Suspense } from "react";

import { SendHome } from "@/components/worker/send-home";

export const metadata: Metadata = {
  title: "Send home",
  description: "Send money to family in seconds with Sigilo.",
  robots: { index: false, follow: false },
};

// Send home (SPEC.md F8). The recipient comes from the link's search params (client side).
export default function Page() {
  return (
    <Suspense fallback={null}>
      <SendHome />
    </Suspense>
  );
}
