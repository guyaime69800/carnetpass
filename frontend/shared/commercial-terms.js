export const COMMERCIAL_TERMS_VERSION = "2026-11-28.2";
export const COMMERCIAL_TERMS_SHA256 = "d03e69f2c2cdafe179152743f93967c08b59e6f18621c2dc19423be9beb7a4b6";
export const COMMERCIAL_TERMS_URL = "https://www.carnetpass.fr/conditions-commerciales";
export function acceptedCommercialTerms(value) {
  return value?.accepted === true && value.version === COMMERCIAL_TERMS_VERSION;
}
export function commercialTermsMetadata(userId, companyId, acceptedAt = new Date().toISOString()) {
  return {
    "metadata[cgv_version]": COMMERCIAL_TERMS_VERSION,
    "metadata[cgv_sha256]": COMMERCIAL_TERMS_SHA256,
    "metadata[cgv_user_id]": userId,
    "metadata[cgv_company_id]": companyId,
    "metadata[cgv_accepted_at]": acceptedAt,
    "consent_collection[terms_of_service]": "required",
    "custom_text[terms_of_service_acceptance][message]": `J'accepte les [CGV CarnetPass](${COMMERCIAL_TERMS_URL}).`,
  };
}
