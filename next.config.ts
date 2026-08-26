import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["three"],

  // `next dev` and `next build` both write to distDir, and their output is NOT
  // interchangeable: running a production build while a dev server is live replaces the
  // dev chunks and the running server then 500s with "Cannot find module './611.js'".
  // Honouring NEXT_DIST_DIR lets a verification build go somewhere else entirely
  // (see the build:verify script) so it can never disturb a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
