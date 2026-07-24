import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative URLs let the same build run at a GitHub Pages project subpath,
  // a custom domain root, or any ordinary static HTTP directory.
  base: "./",
  plugins: [react()],
  server: {
    watch:
      process.env.CODEX_SANDBOX === "seatbelt"
        ? { useFsEvents: false, usePolling: true }
        : undefined,
  },
  worker: {
    format: "es",
  },
});
