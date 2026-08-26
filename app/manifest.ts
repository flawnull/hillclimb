import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Val Borbera Hillclimb",
    short_name: "ValBorbera",
    description: "Alpine hillclimb racing through Ligurian mountain passes. 60 FPS deterministic physics.",
    start_url: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#020617",
    theme_color: "#f59e0b",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
