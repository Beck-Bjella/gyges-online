import type { MetadataRoute } from "next";

/**
 * The pages worth a search engine's attention. Games and profiles are
 * deliberately absent: they are many, ephemeral, and reachable from these.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://gyges.app";
  return [
    { url: `${base}/`, priority: 1 },
    { url: `${base}/computer`, priority: 0.9 },
    { url: `${base}/rules`, priority: 0.8 },
    { url: `${base}/games`, priority: 0.7 },
    { url: `${base}/leaderboard`, priority: 0.5 },
  ];
}
