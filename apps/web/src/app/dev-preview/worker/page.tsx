import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WorkerPreview } from "./preview";

export const metadata: Metadata = {
  title: "Worker screens (dev preview)",
  robots: { index: false, follow: false },
};

// Development only: the worker screens with sample data, one per URL hash (#dashboard, #empty, …).
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WorkerPreview />;
}
