/** Cloudflare Turnstile, loaded only when the score server asks for it. Real players pass it without doing anything. */
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Cloudflare's published test key, which always passes: for local development only. */
const TEST_SITE_KEY = '1x00000000000000000000AA';
const WAIT_MS = 20_000;

interface Turnstile { render(target: HTMLElement, options: Record<string, unknown>): string; remove(id: string): void }
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<Turnstile> | null = null;

function load(): Promise<Turnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT; script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('no turnstile')));
    script.onerror = () => { loading = null; reject(new Error('turnstile failed to load')); };
    document.head.append(script);
  });
  return loading;
}

/** A token proving this is a person, or null when the check cannot be completed. */
export async function solveChallenge(target: HTMLElement): Promise<string | null> {
  const siteKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? (import.meta.env.DEV ? TEST_SITE_KEY : '');
  if (!siteKey) return null;
  try {
    const turnstile = await load();
    return await new Promise<string | null>(resolve => {
      const timer = setTimeout(() => resolve(null), WAIT_MS);
      const id = turnstile.render(target, {
        sitekey: siteKey,
        callback: (token: string) => { clearTimeout(timer); resolve(token); },
        'error-callback': () => { clearTimeout(timer); resolve(null); },
      });
      void id;
    });
  } catch {
    return null;
  }
}
