// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://kidthales.github.io',
  base: '/',
  trailingSlash: 'always',
  build: {
    format: 'directory'
  }
});
