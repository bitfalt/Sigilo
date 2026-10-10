import type { Metadata, Viewport } from "next";
import { Archivo, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import { SigiloProvider } from "@/components/sigilo-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Landing display and body face; the width axis gives the engraved, banknote-like headlines.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SHARE_TITLE = "Sigilo · The original proof of work";
const SHARE_DESCRIPTION =
  "Get paid in digital dollars privately, prove your income without showing your payslip, and borrow against your next paycheck.";

export const metadata: Metadata = {
  // Absolute URLs for share previews (WhatsApp, X, LinkedIn); the image is opengraph-image.jpg.
  metadataBase: new URL("https://sigilo.work"),
  title: { default: "Sigilo", template: "%s · Sigilo" },
  openGraph: {
    type: "website",
    siteName: "Sigilo",
    url: "/",
    title: SHARE_TITLE,
    description: SHARE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: SHARE_TITLE, description: SHARE_DESCRIPTION },
  description:
    "Get paid in digital dollars privately, prove your income without revealing it, and borrow against your next paycheck.",
  applicationName: "Sigilo",
  appleWebApp: { capable: true, title: "Sigilo", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SigiloProvider>{children}</SigiloProvider>
      </body>
    </html>
  );
}
