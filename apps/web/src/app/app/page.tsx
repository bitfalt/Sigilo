import type { Metadata } from "next";

import { WorkerHome } from "@/components/worker/worker-home";

export const metadata: Metadata = { title: "Your account" };

// Worker app — SPEC.md §3 and §4 (flows F1, F4, F9).
export default function Page() {
  return <WorkerHome />;
}
