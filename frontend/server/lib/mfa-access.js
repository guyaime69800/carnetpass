// Call only after auth.getUser(token) has verified this exact bearer token.
// Authorization never uses user_metadata or a browser-supplied assurance level.

// Internal (founder/operator) access requires a primary sign-in (password…)
// done less than 12 hours ago. Supabase keeps the original sign-in time in the
// token "amr" claim even when the session is refreshed, so a long-lived browser
// session can no longer keep administration rights forever.
export const ADMIN_AUTH_MAX_AGE_SECONDS = 12 * 60 * 60;
const SECOND_FACTORS = new Set(["totp", "phone", "webauthn", "mfa/totp", "mfa/phone", "mfa/webauthn"]);

export function primaryAuthenticationTime(claims) {
  if (!Array.isArray(claims?.amr)) return null;
  const times = claims.amr
    .filter((entry) => entry && typeof entry.method === "string" && !SECOND_FACTORS.has(entry.method))
    .map((entry) => Number(entry.timestamp))
    .filter((value) => Number.isFinite(value) && value > 0);
  return times.length ? Math.max(...times) : null;
}

export function mfaAccessError(verifiedUser, verifiedToken, { required = false, now = Date.now() } = {}) {
  const enrolled = verifiedUser?.factors?.some((factor) => factor.status === "verified");
  if (!required && !enrolled) return null;
  let claims;
  try { claims = JSON.parse(Buffer.from(verifiedToken.split(".")[1], "base64url").toString("utf8")); }
  catch { claims = null; }
  if (claims?.sub === verifiedUser.id && claims.aal === "aal2") {
    if (!required) return null;
    const signedInAt = primaryAuthenticationTime(claims);
    if (signedInAt && Math.floor(now / 1000) - signedInAt <= ADMIN_AUTH_MAX_AGE_SECONDS) return null;
    return {
      status: 401,
      code: "REAUTH_REQUIRED",
      message: "Votre connexion date de plus de 12 heures. Reconnectez-vous avec votre mot de passe et votre code.",
    };
  }
  return {
    status: 403,
    code: enrolled ? "MFA_REQUIRED" : "MFA_ENROLLMENT_REQUIRED",
    message: enrolled
      ? "Validez le code de votre application d’authentification pour continuer."
      : "Activez la double authentification pour accéder à l’administration CarnetPass.",
  };
}

export async function accountMfaAccessError(verifiedUser, verifiedToken, database) {
  const enrolledError = mfaAccessError(verifiedUser, verifiedToken);
  if (enrolledError) return enrolledError;
  // A verified AAL2 bearer already satisfies either account policy.
  if (!mfaAccessError(verifiedUser, verifiedToken, { required: true })) return null;
  const { data: operator, error } = await database.from("platform_admins")
    .select("role").eq("user_id", verifiedUser.id).maybeSingle();
  if (error) return { status: 503, code: "MFA_UNAVAILABLE", message: "Contrôle de sécurité indisponible. Réessayez." };
  return mfaAccessError(verifiedUser, verifiedToken, { required: Boolean(operator) });
}
