import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const socialImage = `${protocol}://${host}/og.png`;
  return {
    title: "Market Desk — Economics Job Tracker",
    description: "Collect, prepare, and track economics job applications in one private workspace.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Market Desk",
      description: "Your economics job market, one organized system.",
      type: "website",
      images: [{ url: socialImage, width: 1536, height: 1024, alt: "Market Desk economics job tracker" }],
    },
    twitter: { card: "summary_large_image", title: "Market Desk", description: "Your economics job market, one organized system.", images: [socialImage] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
