// Equivalent to the reviewed Vercel aliases; transport flags are server-owned.
export const aliases = [
  {
    "source": "/api/access-session",
    "destination": "/api/verify-company?access_session_route=1"
  },
  {
    "source": "/api/shiba-devis",
    "destination": "/api/verify-company?shiba_devis_route=1"
  },
  {
    "source": "/api/aid-admin",
    "destination": "/api/verify-company?aid_admin_route=1"
  },
  {
    "source": "/api/company-rge",
    "destination": "/api/verify-company?company_rge_route=1"
  },
  {
    "source": "/api/plate-scan",
    "destination": "/api/verify-company?plate_scan_route=1"
  },
  {
    "source": "/api/maintenance-control",
    "destination": "/api/verify-company?maintenance_control_route=1"
  },
  {
    "source": "/api/shiba-usage",
    "destination": "/api/verify-company?shiba_usage_route=1"
  },
  {
    "source": "/api/public-maintenance-reminders",
    "destination": "/api/carnetpass?public_reminder_route=1"
  },
  {
    "source": "/api/maintenance-reminders",
    "destination": "/api/carnetpass?maintenance_route=1"
  },
  {
    "source": "/api/model-reminders",
    "destination": "/api/carnetpass?model_reminders_route=1"
  },
  {
    "source": "/api/public-shiba",
    "destination": "/api/carnetpass?public_shiba_route=1"
  },
  {
    "source": "/api/account",
    "destination": "/api/verify-company?account_route=1"
  },
  {
    "source": "/api/billing",
    "destination": "/api/verify-company?billing_route=1"
  },
  {
    "source": "/api/shiba-recharge",
    "destination": "/api/verify-company?shiba_recharge_route=1"
  },
  {
    "source": "/api/stripe-webhook",
    "destination": "/api/verify-company?billing_route=1&webhook=1"
  },
  {
    "source": "/api/enterprise-quote",
    "destination": "/api/verify-company?enterprise_quote_route=1"
  },
  {
    "source": "/api/platform-admin",
    "destination": "/api/verify-company?platform_admin_route=1"
  },
  {
    "source": "/api/platform-catalog-documents",
    "destination": "/api/platform-admin-documents?catalog_route=1"
  },
  {
    "source": "/api/platform-document-submissions",
    "destination": "/api/platform-admin-documents?submission_route=1"
  },
  {
    "source": "/api/thermodynamic-documents",
    "destination": "/api/interventions?thermodynamic_route=1"
  }
];
export const apiModules = {
  '/api/ai-web': () => import('../api/ai-web.js'),
  '/api/ai': () => import('../api/ai.js'),
  '/api/carnetpass-status': () => import('../api/carnetpass-status.js'),
  '/api/carnetpass': () => import('../api/carnetpass.js'),
  '/api/document': () => import('../api/document.js'),
  '/api/equipment-attachments': () => import('../api/equipment-attachments.js'),
  '/api/interventions': () => import('../api/interventions.js'),
  '/api/platform-admin-documents': () => import('../api/platform-admin-documents.js'),
  '/api/search': () => import('../api/search.js'),
  '/api/technical-document': () => import('../api/technical-document.js'),
  '/api/verify-company': () => import('../api/verify-company.js'),
};
