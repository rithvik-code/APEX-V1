import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const control = {
  "/api": {
    // Follow the daemon's own port so a custom APEX_CONTROL_PORT cannot
    // silently leave the console talking to an empty socket.
    target: `http://127.0.0.1:${process.env.APEX_CONTROL_PORT || 4317}`,
    changeOrigin: false,
  },
};

const hermes = {
  "/hermes": {
    target: "http://127.0.0.1:8642",
    changeOrigin: false,
    rewrite: (path: string) => path.replace(/^\/hermes/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { ...control, ...hermes },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: { ...control, ...hermes },
  },
});
