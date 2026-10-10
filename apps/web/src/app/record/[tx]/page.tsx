import type { Metadata } from "next";
import { Suspense } from "react";

import { PublicRecord } from "@/components/record/public-record";

export const metadata: Metadata = {
  title: "What the internet sees",
  description: "Everything a stranger can read about a Sigilo payroll payment.",
  robots: { index: false, follow: false },
};

// Public view of one payroll payment (SPEC.md §13 "privacy you can see").
export default function Page({ params }: PageProps<"/record/[tx]">) {
  return (
    <Suspense fallback={null}>
      <Record params={params} />
    </Suspense>
  );
}

async function Record({ params }: { params: PageProps<"/record/[tx]">["params"] }) {
  const { tx } = await params;
  return <PublicRecord tx={tx} />;
}
