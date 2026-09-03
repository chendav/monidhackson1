import type { Metadata } from "next";
import "./globals.css";

const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: "RFP X-Ray | Audited tender analysis",
  description: "Document-only tender analysis with mandatory requirements, amendment conflicts, verified source pages, and real run cost.",
  openGraph: {
    title: "RFP X-Ray",
    description: "Drop a tender pack. Get every must, risk, scoring rule, and source page.",
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "RFP X-Ray",
    description: "Audited tender analysis, not tender search."
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
