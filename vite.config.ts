import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const git = (command: string): string => {
  try { return execSync(`git ${command}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
};
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// What was built: the version in package.json, the commit it was built from (and whether the tree had changes not in it), and when.
const dirty = git('status --porcelain --untracked-files=no') !== '';
const sha = git('rev-parse --short HEAD') || 'unknown';

export default defineConfig({
  // Relative asset paths, so the built site works from any folder or sub-path.
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_SHA__: JSON.stringify(dirty ? `${sha}+changes` : sha),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    // Reachable from outside the machine and from hosted preview domains (Replit, tunnels).
    host: true,
    allowedHosts: true,
    // The score server of `npm run stack`, so the browser sees one origin.
    proxy: { '/api': 'http://localhost:8787' },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
});
