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
    "Independent, reproducible LLM inference performance and accuracy data for local hardware and online APIs.",
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
          <nav className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              InferStation
            </Link>
            <ul className="flex flex-wrap items-center justify-end gap-x-5 gap-y-2 text-sm text-zinc-600 dark:text-zinc-400">
              <li className="relative">
                <details className="group">
                  <summary className="cursor-pointer list-none font-medium hover:text-zinc-900 dark:hover:text-zinc-100">
                    Performance <span aria-hidden="true" className="ml-1 text-[10px]">▾</span>
                  </summary>
                  <div className="absolute right-0 z-50 mt-2 grid min-w-40 gap-1 rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                    <Link href="/" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">Overview</Link>
                    <Link href="/summary" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">Summary</Link>
                    <Link href="/charts" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">Charts</Link>
                    <Link href="/compare" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">Compare</Link>
                    <Link href="/runs" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">Runs</Link>
                    <Link href="/history" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">History</Link>
                  </div>
                </details>
              </li>
              <li className="relative">
                <details className="group">
                  <summary className="cursor-pointer list-none font-medium text-indigo-700 hover:text-indigo-500 dark:text-indigo-300 dark:hover:text-indigo-200">
                    Benchmark <span aria-hidden="true" className="ml-1 text-[10px]">▾</span>
                  </summary>
                  <div className="absolute right-0 z-50 mt-2 grid min-w-44 gap-1 rounded-lg border border-zinc-200 bg-white p-2 text-sm shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
                    <Link href="/benchmark" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">Summary</Link>
                    <Link href="/benchmark/run" className="rounded px-2.5 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900">Run benchmark</Link>
                  </div>
                </details>
              </li>
              <li>
                <Link href="/docs" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  Docs
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/InferStation/InferStation"
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
