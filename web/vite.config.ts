import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:7437",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/ws": {
        target: "ws://127.0.0.1:7437",
        ws: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
});
