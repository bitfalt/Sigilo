import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sigilo",
    short_name: "Sigilo",
    description: "Get paid privately. Prove it selectively. Borrow against it.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#111111",
    theme_color: "#111111",
    // TODO: add 192/512 PNG + maskable icons and apple-touch-icon before submission.
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
