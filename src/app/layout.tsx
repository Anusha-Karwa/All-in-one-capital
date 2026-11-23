import type { Metadata } from "next";
import Link from "next/link";
import { env } from "@/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "All In Capital — Screener",
  description: "Inbound application screening for All In Capital",
};

const NAV = [
  ["/", "Inbox"],
  ["/memos", "Memos"],
  ["/notes", "Notes"],
] as const;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const testMode = env().TEST_MODE;
  return (
    <html lang="en">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {testMode && (
          <div className="bg-red-600 px-4 py-1 text-center text-xs font-semibold tracking-wide text-white">
            TEST MODE — outbound email goes to the test inbox; calendar writes go to the test calendar
          </div>
        )}
        <header className="border-b">
          <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3 text-sm">
            <span className="font-semibold">All In Capital · Screener</span>
            {NAV.map(([href, label]) => (
              <Link key={href} href={href} className="text-muted-foreground hover:text-foreground">
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
