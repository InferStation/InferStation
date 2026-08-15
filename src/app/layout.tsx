import type { Metadata } from "next";
import { DM_Sans, Geist_Mono } from "next/font/google";
import Link from "next/link";
import HeaderNav from "@/components/HeaderNav";
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
            <HeaderNav />
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
