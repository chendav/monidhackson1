import type { Metadata } from "next";
import "./globals.css";

const origin = process.env.NEXT_PUBLIC_APP_ORIGIN ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: "RFP X-Ray | Evidence-backed tender analysis",
  description: "Document-only tender analysis with requirements, amendment conflicts, verified physical-page citations, cleanup proof, and transparent run cost.",
  openGraph: {
    title: "RFP X-Ray",
    description: "Analyze a tender pack without search. Review requirements, risks, conflicts, source pages, cleanup, and run cost.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "RFP X-Ray evidence-backed tender analysis workspace" }],
    type: "website"
  },
  twitter: {
    card: "summary_large_image",
    title: "RFP X-Ray",
    description: "Document-only tender analysis with verified physical-page evidence.",
    images: ["/og.png"]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
