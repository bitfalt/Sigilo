import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmployerPreview } from "./preview";

export const metadata: Metadata = { title: "Employer preview", robots: { index: false } };

// Development only: the employer console views with sample data, one state per URL hash
// (#dashboard, #running, #done, #new, #loading, #error, #create, #welcome, #opening).
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return <EmployerPreview />;
}
