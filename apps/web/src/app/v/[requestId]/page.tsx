import { Suspense } from "react";

// Public verification request page — see SPEC.md §4 (flow F5).
// With cacheComponents, runtime params must be awaited below a <Suspense> boundary.
export default function Page({ params }: PageProps<"/v/[requestId]">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Verification request</h1>
      <Suspense fallback={null}>
        <RequestId params={params} />
      </Suspense>
    </main>
  );
}

async function RequestId({ params }: { params: PageProps<"/v/[requestId]">["params"] }) {
  const { requestId } = await params;
  return <p className="text-muted-foreground font-mono text-sm">{requestId}</p>;
}
