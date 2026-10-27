import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { modsPlugin } from "./vite/modsPlugin";

// In development the page is served by Vite and talks to the FastAPI server on port 8000, or on UNDERCUT_API (host:port) when that is set.
const api = process.env.UNDERCUT_API ?? "localhost:8000";
export default defineConfig({
  plugins: [react(), modsPlugin()],
  build: {
    // the legal notices get a chunk of their own, so the release check can allow the disclaimer in that one file and nowhere else
    rollupOptions: { output: { manualChunks: (id) => (id.endsWith("/src/legal.ts") ? "legal" : undefined) } },
  },
  server: {
    fs: { allow: [".."] }, // the circuit folders are at the repository root
    proxy: {
      "/api": `http://${api}`,
      "/ws": { target: `ws://${api}`, ws: true },
    },
  },
});
