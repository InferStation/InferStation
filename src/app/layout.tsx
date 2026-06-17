import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = DM_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "InferStation — LLM Inference Reference Station",
  description:
    "Independent, reproducible LLM inference performance data for desktop and workstation hardware: Strix Halo, DGX Spark, and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              InferStation
            </Link>
            <ul className="flex items-center gap-6 text-sm text-zinc-600 dark:text-zinc-400">
              <li>
                <Link href="/summary" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  Summary
                </Link>
              </li>
              <li>
                <Link href="/charts" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  Charts
                </Link>
              </li>
              <li>
                <Link href="/history" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  History
                </Link>
              </li>
              <li>
                <Link href="/compare" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  Compare
                </Link>
              </li>
              <li>
                <Link href="/runs" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  Runs
                </Link>
              </li>
              <li>
                <Link href="/docs" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  Docs
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/JoursBleu/InferStation"
                  target="_blank"
                  rel="noreferrer"
                  aria-label="GitHub repository"
                  title="GitHub"
                  className="flex items-center text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.69-.01-1.36-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                  </svg>
                </a>
              </li>
            </ul>
          </nav>
        </header>
        <main className="flex flex-1 flex-col">{children}</main>
        <footer className="border-t border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-zinc-500">
            <span>© {new Date().getFullYear()} InferStation · Independent benchmarks · Open methods.</span>
            <Link href="/about" className="hover:text-zinc-900 dark:hover:text-zinc-100">
              About
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
