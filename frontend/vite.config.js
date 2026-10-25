import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, /api is proxied to the local FastAPI server so no CORS setup is needed.
// API_PROXY lets tests point the dev server at a different backend (default http://localhost:8000).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": process.env.API_PROXY || "http://localhost:8000" } },
});
