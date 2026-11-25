import { deploymentEnvironment } from '../shared/runtime-environment.js';
import { requireVerifiedCompany } from "./lib/require-verified-company.js";
import { getShibaPlan, readShibaUsage, shibaQuotaEnabled } from "./lib/shiba-quota.js";

export default async function handler(request, response) {
  if (request.method !== "GET") return response.status(405).json({ error: "Méthode non autorisée." });
  if (!shibaQuotaEnabled() && deploymentEnvironment(process.env) !== "production") return response.status(200).json({ enabled: false });
  const professional = await requireVerifiedCompany(request, response);
  if (!professional) return;
  try {
    const plan = professional.accessKind === "discovery" ? "free" : await getShibaPlan(request, professional);
    return response.status(200).json(await readShibaUsage(professional, plan));
  } catch (error) {
    console.error("Compteur de l’assistant indisponible :", error);
    return response.status(503).json({ error: "Le compteur de l’assistant est momentanément indisponible." });
  }
}
