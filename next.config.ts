import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The scheduling module is mounted under /scheduling inside the Sothcare app.
  // When running it standalone, leave basePath empty.
  basePath: process.env.SCHEDULING_BASE_PATH || undefined,
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
