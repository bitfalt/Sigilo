import { Suspense } from "react";

import { InviteFlow } from "@/components/worker/invite-flow";

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
