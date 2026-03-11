import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@governance-engine/shared": path.resolve(__dirname, "../shared/src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "https://t1t7s9jm71.execute-api.us-east-1.amazonaws.com/prod",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
        secure: true,
      },
    },
  },
  define: {
    "process.env.REACT_APP_API_URL": JSON.stringify(
      process.env.VITE_API_URL || process.env.REACT_APP_API_URL || ""
    ),
  },
});
