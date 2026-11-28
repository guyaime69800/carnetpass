import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { loadTurnstile, turnstileSiteKey } from "../lib/turnstile.js";

// Affiche le contrôle anti-robots Cloudflare Turnstile et transmet son jeton.
// Un jeton ne sert qu'une fois : appeler reset() après chaque envoi du formulaire.
const TurnstileWidget = forwardRef(function TurnstileWidget({ onToken, action }, ref) {
  const box = useRef(null);
  const widgetId = useRef(null);
  const callback = useRef(onToken);
  const [failed, setFailed] = useState(false);
  const siteKey = turnstileSiteKey();

  useEffect(() => { callback.current = onToken; }, [onToken]);

  useImperativeHandle(ref, () => ({
    reset() {
      callback.current?.("");
      if (widgetId.current !== null && window.turnstile) window.turnstile.reset(widgetId.current);
    },
  }), []);

  useEffect(() => {
    if (!siteKey) return undefined;
    let active = true;
    loadTurnstile().then((turnstile) => {
      if (!active || !box.current) return;
      widgetId.current = turnstile.render(box.current, {
        sitekey: siteKey,
        action,
        language: "fr",
        callback: (token) => { setFailed(false); callback.current?.(token); },
        "expired-callback": () => callback.current?.(""),
        "error-callback": () => { setFailed(true); callback.current?.(""); },
      });
    }).catch(() => { if (active) setFailed(true); });
    return () => {
      active = false;
      if (widgetId.current !== null && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey, action]);

  if (!siteKey) return null;
  return (
    <div className="captcha-widget">
      <div ref={box} />
      {failed && <p className="auth-message auth-message-error">La vérification anti-robots n’a pas pu se charger. Rechargez la page puis réessayez.</p>}
    </div>
  );
});

export default TurnstileWidget;
