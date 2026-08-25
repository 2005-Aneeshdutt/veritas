import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Revenue Doctor",
  description:
    "Diagnoses why a merchant's payment success rate falls short of its cohort — and measures how often it is wrong.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
