import type { NextConfig } from "next";

// When set (e.g. in CI for GitHub Pages), prepend a base path so the site works
// under https://<user>.github.io/InferStation/. For local dev we leave it empty.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
