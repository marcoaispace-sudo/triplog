import type { Metadata, Viewport } from "next";
import "./globals.css";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "triplog";
const basePath = isGitHubPages && !repositoryName.endsWith(".github.io") ? `/${repositoryName}` : "";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://triplog-travel.marcoho.chatgpt.site";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "旅記 TripLog",
  description: "把行程、入境準備、地點與旅行開支放在一起。",
  manifest: `${basePath}/manifest.webmanifest`,
  openGraph: {
    title: "旅記 TripLog",
    description: "行程・準備・記帳，一次整理",
    images: [{ url: `${siteUrl}/og.png`, width: 1200, height: 630, alt: "旅記 TripLog" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "旅記 TripLog",
    description: "行程・準備・記帳，一次整理",
    images: [`${siteUrl}/og.png`],
  },
  icons: {
    icon: `${basePath}/favicon.svg`,
    shortcut: `${basePath}/favicon.svg`,
    apple: `${basePath}/icons/apple-touch-icon.png`,
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1ea7e8" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
