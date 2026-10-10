import type { Metadata } from "next";
import { Suspense } from "react";

import { InviteFlow } from "@/components/worker/invite-flow";

const INVITE_TITLE = "You're invited to get paid with Sigilo";
const INVITE_DESCRIPTION =
  "Your employer pays you with Sigilo. Your salary stays private: only you can see it.";

// Invite links travel over WhatsApp, so they get their own preview text (same share image).
export const metadata: Metadata = {
  title: { absolute: INVITE_TITLE },
  description: INVITE_DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    siteName: "Sigilo",
    title: INVITE_TITLE,
    description: INVITE_DESCRIPTION,
    images: [{ url: "/opengraph-image.jpg", width: 1200, height: 630, alt: "Sigilo" }],
  },
  twitter: { card: "summary_large_image", title: INVITE_TITLE, description: INVITE_DESCRIPTION },
};

// Employer invite (SPEC.md F1). With cacheComponents, runtime params are awaited under Suspense.
export default function Page({ params }: PageProps<"/app/invite/[code]">) {
  return (
    <Suspense fallback={null}>
      <Invite params={params} />
    </Suspense>
  );
}

async function Invite({ params }: { params: PageProps<"/app/invite/[code]">["params"] }) {
  const { code } = await params;
  return <InviteFlow code={code} />;
}
