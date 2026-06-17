"use client";

import { useEffect } from "react";

// The merged /charts/<model> view is retired — every model page is now split
// by framework. Redirect to the default (llama.cpp) framework page so there is
// no mixed-framework chart anywhere.
export default function ChartsRedirect({ model, framework = "vllm" }: { model: string; framework?: string }) {
  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
    window.location.replace(`${base}/charts/${model}/${framework}/`);
  }, [model, framework]);
  return <p className="p-8 text-sm text-zinc-500">Loading…</p>;
}
