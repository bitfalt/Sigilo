import type { Metadata } from "next";

import { Settings } from "@/components/worker/settings";

export const metadata: Metadata = {
  title: "Settings",
  robots: { index: false, follow: false },
};

// Worker settings and Advanced (SPEC.md F10). Everything renders on the client once unlocked.
export default function Page() {
  return <Settings />;
}
