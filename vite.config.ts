import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  server: {
    host: "0.0.0.0",
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      clientPort: 5173
    }
  },
  plugins: [
    react(),
    {
      name: "strip-branch-root-fallback",
      apply: "build",
      transformIndexHtml(html) {
        return html.replace(
          /\s*<!-- branch-root-fallback:start -->[\s\S]*?<!-- branch-root-fallback:end -->/gu,
          ""
        );
      }
    }
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"]
  }
});
