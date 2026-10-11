import type { Metadata } from "next";

import { NetworkView } from "@/components/network/network-view";

export const metadata: Metadata = {
  title: "Sigilo in numbers",
  description:
    "Live numbers from Sigilo's public record, and what a stranger can and can't learn from it.",
};

// Public, live network numbers from the Envio indexer (packages/indexer).
export default function Page() {
  return <NetworkView />;
}
