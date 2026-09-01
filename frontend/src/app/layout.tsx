import "./globals.css";
import type { Metadata } from "next";
import { themeBootstrap } from "@/components/Theme";

export const metadata: Metadata = {
  title: "Revenue Doctor",
  description:
    "Find the gap between what a merchant collects and what their category achieves — and measure how often the diagnosis is wrong.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint, so the page never
            renders light and then snaps to dark. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
