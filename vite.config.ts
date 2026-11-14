import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const control = {
  "/api": {
    // Must match apexd's default port (APEX_CONTROL_PORT, 4317), otherwise the
    // console in the page talks to a socket nobody is listening on.
    target: "http://127.0.0.1:4317",
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
