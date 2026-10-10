import type { Metadata } from "next";

import { EmployerConsole } from "@/components/employer/employer-console";

export const metadata: Metadata = { title: "Payroll" };

// Employer dashboard — SPEC.md §3 and §4 (flows F2, F3).
export default function Page() {
  return <EmployerConsole />;
}
