import { defineConfig } from "vite";

export default defineConfig({
  root: "src",
  server: {
    host: true,
    port: 1420,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
