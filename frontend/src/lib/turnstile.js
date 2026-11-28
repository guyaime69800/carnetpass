// Captcha Cloudflare Turnstile (anti-robots) des formulaires d'authentification.
// La clé de site est publique ; elle n'est valable que pour carnetpass.fr.
// Ailleurs (test, développement), VITE_TURNSTILE_SITE_KEY peut fournir une clé
// de test Cloudflare ; sans clé, aucun captcha n'est affiché ni exigé.
export const PRODUCTION_TURNSTILE_SITE_KEY = "0x4AAAAAAGXE6GKJPUPQYJPu";
export const TURNSTILE_SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function turnstileSiteKey(
  hostname = typeof window === "undefined" ? "" : window.location.hostname,
  env = import.meta.env || {},
) {
  if (/(^|\.)carnetpass\.fr$/i.test(hostname || "")) return PRODUCTION_TURNSTILE_SITE_KEY;
  return typeof env.VITE_TURNSTILE_SITE_KEY === "string" ? env.VITE_TURNSTILE_SITE_KEY : "";
}

export function captchaReady(token, siteKey = turnstileSiteKey()) {
  return !siteKey || (typeof token === "string" && token.length > 0);
}

let loader = null;
export function loadTurnstile() {
  if (typeof window === "undefined") return Promise.reject(new Error("Turnstile indisponible"));
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loader) {
    loader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = TURNSTILE_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile indisponible")));
      script.onerror = () => { loader = null; reject(new Error("Turnstile indisponible")); };
      document.head.appendChild(script);
    });
  }
  return loader;
}
