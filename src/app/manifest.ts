import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumio — AI Assistant",
    short_name: "Lumio",
    description:
      "Your AI companion for thinking, writing, coding, and getting things done.",
    start_url: "/",
    display: "standalone",
    background_color: "#09090b",
    theme_color: "#8b5cf6",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
