import type { NextConfig } from "next";

const config: NextConfig = {
  // better-sqlite3 is a native module: keep it out of the bundler.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
};

export default config;
