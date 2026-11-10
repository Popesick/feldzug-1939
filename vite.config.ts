import { defineConfig } from 'vite';

// base './' hält alle Pfade relativ – nötig für GitHub Pages und für eine
// spätere Desktop-Hülle (Tauri/Electron), die aus dem Dateisystem lädt.
export default defineConfig({ base: './' });
