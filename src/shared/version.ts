/** Which build this is: the version in package.json, the commit it was built from, and when. Filled in by vite.config.ts at build time. */
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;

const NOT_BUILT = 'dev';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : NOT_BUILT;
export const GIT_SHA: string = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : NOT_BUILT;
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : NOT_BUILT;

/** For people: "v0.2.0 · 1a2b3c4". */
export function versionLabel(): string {
  return `v${APP_VERSION} · ${GIT_SHA}`;
}
