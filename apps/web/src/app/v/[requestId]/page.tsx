import type { Metadata } from "next";
import { Suspense } from "react";

import { PassportRequest } from "@/components/worker/passport-request";

const TITLE = "Confirm your income with Sigilo";
const DESCRIPTION =
  "A lender asked to confirm your income. Answer with your Income Passport: they see that you earn enough, not your salary or your employer.";

// Income check links travel over WhatsApp too, so they get their own preview text.
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "Sigilo",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/opengraph-image.jpg", width: 1200, height: 630, alt: "Sigilo" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Lender income check (SPEC.md F5). With cacheComponents, runtime params are awaited under Suspense.
export default function Page({ params }: PageProps<"/v/[requestId]">) {
  return (
    <Suspense fallback={null}>
      <Request params={params} />
    </Suspense>
  );
}

async function Request({ params }: { params: PageProps<"/v/[requestId]">["params"] }) {
  const { requestId } = await params;
  return <PassportRequest requestId={requestId} />;
}
