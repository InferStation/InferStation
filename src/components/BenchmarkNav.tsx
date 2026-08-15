import Link from "next/link";

export default function BenchmarkNav({ active }: { active: "summary" | "run" }) {
  return (
    <nav
      aria-label="Benchmark sections"
      className="inline-flex rounded-lg border border-zinc-200 bg-white p-1 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
    >
      <Link
        href="/benchmark"
        aria-current={active === "summary" ? "page" : undefined}
        className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
          active === "summary"
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
        }`}
      >
        Summary
      </Link>
      <Link
        href="/benchmark/run"
        aria-current={active === "run" ? "page" : undefined}
        className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
          active === "run"
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
        }`}
      >
        Run benchmark
      </Link>
    </nav>
  );
}
