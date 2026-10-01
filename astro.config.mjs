// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
// SITE / BASE_PATH are set by the GitHub Pages workflow; locally the app is served from '/'.
export default defineConfig({
  site: process.env.SITE,
  base: process.env.BASE_PATH ?? '/',
});
