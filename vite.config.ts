import path from "path"
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite server options
  server: {
    // Tauri expects a fixed port, not a random one
    port: 1420,
    // Listen on all addresses to allow connections from mobile devices
    host: '0.0.0.0',
    // Strict port ensures the app doesn't try to use another port if 1420 is taken
    strictPort: true,
  },
  
  // Build configuration
  build: {
    // Output directory for the build (matches distDir in tauri.conf.json)
    outDir: 'dist',
    // Generate sourcemaps for better debugging
    sourcemap: true,
    // Target modern browsers
    target: 'es2021',
    // Minify the output for production
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // Empty the output directory before building
    emptyOutDir: true,
  },
  
  // Optimize dependencies
  optimizeDeps: {
    // Include dependencies that need optimization
    include: ['react', 'react-dom'],
  },
});
