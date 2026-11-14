import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const control = {
  "/api": {
    // The default APEX port is occupied by a stale listener on this machine.
    // Keep the UI proxy aligned with the documented alternate daemon port.
    target: "http://127.0.0.1:4318",
    changeOrigin: false,
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: control,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    proxy: control,
  },
});
