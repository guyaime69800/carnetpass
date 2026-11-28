import { supabase } from "./supabaseClient";

export async function loadMfaSecurity(accessToken) {
  const [factors, assurance, response] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    fetch("/api/platform-admin?security=1", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    }),
  ]);
  if (factors.error || assurance.error) throw new Error("Contrôle de sécurité indisponible. Réessayez.");
  let role = null;
  if (response.ok) {
    const status = await response.json();
    if (['founder', 'operator'].includes(status.role)) role = status.role;
  }
  else if (response.status !== 404) throw new Error("Contrôle de sécurité indisponible. Réessayez.");
  const admin = role !== null;
  const verified = (factors.data?.totp || []).filter((factor) => factor.status === "verified");
  const enrolled = (factors.data?.all || []).some((factor) => factor.status === "verified");
  return {
    factors: verified,
    admin,
    role,
    enrolled,
    assurance: assurance.data?.currentLevel,
    needsVerification: (admin || enrolled) && assurance.data?.currentLevel !== "aal2",
  };
}

// Après un lien de réinitialisation, la session est de niveau aal1 : Supabase refuse
// de changer le mot de passe d'un compte protégé par la double authentification
// tant que le code n'a pas été validé (aal2).
export async function pendingMfaFactor() {
  const [factors, assurance] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (factors.error || assurance.error) throw new Error("Contrôle de sécurité indisponible. Réessayez.");
  const factor = (factors.data?.totp || []).find((item) => item.status === "verified");
  return factor && assurance.data?.currentLevel !== "aal2" ? factor.id : null;
}

export async function verifyMfaCode(factorId, code) {
  if (!/^\d{6}$/.test(code)) throw new Error("Saisissez le code à six chiffres de votre application.");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw new Error(error.status === 429
    ? "Trop de tentatives. Patientez avant de réessayer."
    : "Code incorrect ou expiré. Utilisez le nouveau code affiché dans votre application.");
}
