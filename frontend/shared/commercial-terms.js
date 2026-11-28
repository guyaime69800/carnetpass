export const COMMERCIAL_TERMS_VERSION = "2026-11-28.3";
export const COMMERCIAL_TERMS_SHA256 = "aee41c990d00c515152087bcafcde302d342c202c51c3a8d47179651c4edd36c";
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
