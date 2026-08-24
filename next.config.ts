import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "triplog";
const basePath = isGitHubPages && !repositoryName.endsWith(".github.io") ? `/${repositoryName}` : "";

const nextConfig: NextConfig = {
  ...(isGitHubPages
    ? {
        output: "export" as const,
        trailingSlash: true,
        basePath,
        assetPrefix: basePath,
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
};

export default nextConfig;
