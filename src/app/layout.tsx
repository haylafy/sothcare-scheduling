import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sothcare Scheduling",
  description: "Book time with the Sothcare team.",
  // Same asset the real app serves, so the browser tab matches Sothcare
  // instead of showing Next.js's default icon.
  icons: { icon: "https://app.sothcare.com/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#0F766E",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
