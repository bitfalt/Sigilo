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

export const metadata: Metadata = {
  title: { default: "Sigilo", template: "%s · Sigilo" },
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
