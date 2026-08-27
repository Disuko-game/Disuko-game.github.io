import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist-botlab",
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "botlab/index.html") }
  },
  server: { port: 4188 }
});
