import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8080",
      "/socket.io": { target: "http://localhost:8080", ws: true },
    },
  },
});
