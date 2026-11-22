import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: the API runs on PORT (default 7833, npm start); Vite serves the page and proxies /api so the browser only ever talks to one origin
// (same-origin writes). The dev port is a dev-only default and Vite moves to a free one if it is busy (this app claims one port: 7833).
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const api = { target: `http://127.0.0.1:${Number(process.env.PORT) || 7833}` };

export default defineConfig({
  plugins: [react()],
  define: { __LAB_VERSION__: JSON.stringify(`v${version}`) },
  server: { host: "127.0.0.1", port: Number(process.env.VITE_PORT) || 17833, strictPort: false, proxy: { "/api": api } },
  test: { environment: "jsdom", globals: true, setupFiles: "./src/testSetup.js", exclude: ["node_modules", "dist"] },
});
