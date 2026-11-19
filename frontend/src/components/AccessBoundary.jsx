import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { isPublicPresentation } from "../../shared/public-site-metadata.js";
import { signOut } from "../services/authService";

// Internal access older than 12 hours: close the session, then ask for a full login.
function ReauthRedirect({ from, admin }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    signOut().catch(() => {}).finally(() => { if (active) setDone(true); });
    return () => { active = false; };
  }, []);
  if (!done) return <main><p role="status">Votre connexion a expiré. Déconnexion…</p></main>;
  return <Navigate to={admin ? "/connexion-interne" : "/connexion"} replace state={{ from, reauth: true }} />;
}

// SPA navigation must pass a fresh server decision before mounting pages or loading their data.
export default function AccessBoundary({ children }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  const pathname = decodeURIComponent(location.pathname).replace(/\/+$/, "").toLowerCase();
  const token = session?.access_token;
  const key = `${location.pathname}:${location.search}:${token || ""}`;
  const [decision, setDecision] = useState(null);
  const privateLogin = ["/connexion-interne", "/securite-compte", "/reinitialiser-mot-de-passe", '/retour-facturation'].includes(location.pathname);
  const presentation = !import.meta.env.DEV && isPublicPresentation(location.pathname);
  useEffect(() => {
    // A full document navigation uses the same pre-rendered presentation as a direct URL.
    if (presentation) window.location.replace(location.pathname + location.search + location.hash);
  }, [presentation, location.pathname, location.search, location.hash]);
  useEffect(() => {
    if (loading || privateLogin || presentation) return;
    let active = true;
    let running = false;
    async function check() {
      if (running) return;
      running = true;
      try {
        const response = await fetch("/api/access-session", {
          cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const result = await response.json();
        const required = pathname === "/administration-maintenance" ? "founder"
          : pathname.startsWith("/administration-") ? "operator" : null;
        const allowed = response.ok && (!required || result.role === "founder" || (required === "operator" && result.role === "operator"));
        if (active) setDecision({ key, allowed, mfaRequired: result.mfaRequired === true, reauthRequired: result.reauthRequired === true, maintenance: result.maintenance === true, message: result.message });
        if (active && allowed && result.role && token) {
          await fetch("/api/access-session", { method: "POST", cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
        }
      } catch {
        if (active) setDecision({ key, allowed: false });
      } finally { running = false; }
    }
    check();
    const timer = setInterval(check, 30000);
    window.addEventListener("focus", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); };
  }, [key, token, loading, privateLogin, pathname, presentation]);

  if (presentation) return <main><p role="status">Chargement de la présentation CarnetPass…</p></main>;
  if (privateLogin) return children;
  if (loading || decision?.key !== key) return <main><p role="status">Vérification de l’accès…</p></main>;
  if (decision.reauthRequired) return <ReauthRedirect from={location} admin={pathname.startsWith("/administration-")} />;
  if (decision.mfaRequired) return <Navigate to="/securite-compte" replace state={{ from: location }} />;
  if (!token && pathname.startsWith('/administration-') && !decision.maintenance) {
    return <Navigate to="/connexion-interne" replace state={{ from: location }} />;
  }
  if (!decision.allowed) return <main style={{ maxWidth: 650, margin: "15vh auto", padding: 28 }}>
    <h1>{decision.maintenance ? "Le site est momentanément en maintenance." : "Accès indisponible."}</h1>
    {decision.maintenance && <p>{decision.message || "Merci de revenir dans quelques instants."}</p>}
  </main>;
  return children;
}
