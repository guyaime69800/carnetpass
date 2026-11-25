# Configuration Cloudflare : noms uniquement

Aucune valeur secrète dans ce document. Ne pas copier globalement un export de production vers le test.

## Identité explicite de l'hébergement

Définis dans `wrangler.jsonc` : `CARNETPASS_RUNTIME`, `CARNETPASS_ENV`, `CARNETPASS_RELEASE_BRANCH`, `CARNETPASS_SCHEDULED_ENABLED`, `CARNETPASS_SCHEDULER_OWNER`.

En test, définir aussi `CARNETPASS_PUBLIC_ORIGIN` sur l'origine HTTPS exacte obtenue après publication autorisée : sous-domaine workers.dev de ce Worker ou `https://test.carnetpass.fr`. Aucun joker de confiance. Les liens de retour Stripe de test et les rappels Preview utilisent cette origine. Le QR code conserve l'origine courante sur workers.dev. Les tâches restent désactivées.

Ne pas définir `VERCEL_ENV`, `VERCEL_GIT_COMMIT_REF` ou `VERCEL_URL` pour imiter Vercel. Les branches Vercel de secours continuent à lire leurs variables natives.

## Variables publiques de construction

Requises : `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.

Selon les fonctions déjà utilisées : `VITE_RPC_URL`, `VITE_CONTRACT_ADDRESS`, `VITE_CHAIN_ID`, `VITE_REMINDERS_PRODUCTION_ENABLED`, `VITE_PUBLIC_REMINDERS_ENABLED`, `VITE_REMINDER_PREVIEW_TEST_ENABLED`, `VITE_STRIPE_TEST_BILLING_ENABLED`.

Tout nom `VITE_` peut être intégré au JavaScript du navigateur. Aucune clé serveur à cet endroit. En test : clé publique du projet isolé uniquement. Le build `--offline` utilise une valeur non fonctionnelle explicitement interdite à la publication.

## Secrets et paramètres serveur existants à reconfigurer

| Fonction | Noms |
|---|---|
| Supabase | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` ; aliases existants selon code : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Droits d'administration Production | `CARNETPASS_PRODUCTION_ADMIN_ENABLED`, `CARNETPASS_PRODUCTION_ADMIN_SUPABASE_REF` |
| Redis/quotas/maintenance | `UPSTASH_REDIS_REST_KV_REST_API_URL`, `UPSTASH_REDIS_REST_KV_REST_API_TOKEN` ; conserver les aliases uniquement lorsqu'ils sont réellement utilisés |
| OpenAI | `OPENAI_API_KEY` |
| R2 lecture | `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CARNETPASS_R2_READ_ENABLED` |
| R2 import existant | `R2_UPLOAD_ACCESS_KEY_ID`, `R2_UPLOAD_SECRET_ACCESS_KEY` |
| Reprise des copies R2 | `R2_MIGRATION_ACCESS_KEY_ID`, `R2_MIGRATION_SECRET_ACCESS_KEY` |
| Fichiers privés d'entreprise dans R2 (pièces jointes, fiches clim/PAC), ajout du 17 novembre | `R2_ENDPOINT` (commun), `R2_PRIVATE_BUCKET_NAME` (= `carnetpass-private-files-test` en Preview ou `carnetpass-private-files-production`, imposé par le code), `R2_PRIVATE_ACCESS_KEY_ID`, `R2_PRIVATE_SECRET_ACCESS_KEY` (clé limitée à ce seul compartiment), `CARNETPASS_PRIVATE_R2_WRITE_ENABLED` (défaut : absent = Blob), `CARNETPASS_PRIVATE_R2_READ_LEGACY` (défaut : absent) |
| Propositions au catalogue écrites dans R2 (production), ajout du 17 novembre | `CARNETPASS_SUBMISSIONS_R2_ENABLED` (défaut : absent = Blob) ; réutilise `R2_ENDPOINT`, `R2_BUCKET_NAME`, `R2_UPLOAD_ACCESS_KEY_ID`, `R2_UPLOAD_SECRET_ACCESS_KEY` |
| Anciens fichiers Blob | `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`, `PUBLIC_DOCS_STORE_ID`, `PUBLIC_DOCS_WEBHOOK_PUBLIC_KEY` ; accès serveur autonome à établir, notamment `BLOB_READ_WRITE_TOKEN` si le SDK l'utilise hors Vercel |
| Stripe réel, après tests uniquement | `STRIPE_SECRET_KEY`, `STRIPE_EXPECTED_ACCOUNT_ID`, `STRIPE_LIVE_WEBHOOK_SECRET` |
| Stripe test | `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `CARNETPASS_ADMIN_TEST_STRIPE_KEY` selon le parcours concerné |
| Verrous fonctionnels Stripe | `CARNETPASS_LIVE_BILLING_ENABLED`, `CARNETPASS_LIVE_SEATS_ENABLED`, `CARNETPASS_STRIPE_LIVE_PORTAL_ENABLED`, `CARNETPASS_STRIPE_LIVE_PROCESSING_ENABLED`, `CARNETPASS_STRIPE_LIVE_WEBHOOK_ENABLED` |
| Courriels et rappels | `RESEND_API_KEY`, `REMINDER_FROM_EMAIL`, `ENTERPRISE_QUOTE_FROM_EMAIL`, `REMINDER_MANAGE_SIGNING_KEY`, `REMINDER_TEST_EMAIL`, `REMINDERS_PRODUCTION_ENABLED`, `PUBLIC_REMINDERS_ENABLED` |
| Tâches serveur | `CRON_SECRET` ; propriétaire et activation Cloudflare explicitement séparés |
| Polygon | `POLYGON_RPC_URL`, `POLYGON_SERVER_PRIVATE_KEY`, `POLYGON_SERVER_WALLET_ADDRESS`, `EQUIPMENT_REGISTRY_V2_ADDRESS` |
| Limites de scan existantes | `SHIBA_SCAN_DAILY_BUDGET_MICRO_USD`, `SHIBA_SCAN_MAX_CALLS_PER_HOUR`, `SHIBA_SCAN_RESERVATION_MICRO_USD` |
| Autres verrous conservés | `SHIBA_DEVIS_WATCH_ENABLED` |

L'inventaire statique complet et ses chemins de code sont générés dans `.cloudflare/inventory.json`. Les 71 noms relevés incluent aliases, bindings, variables publiques et anciennes variables Vercel ; ce n'est pas une liste de 71 secrets obligatoires. L'API Vercel a fourni les noms et types de 46 paramètres de production ; les valeurs marquées sensibles ne sont pas récupérables via cette lecture.

## Fichiers privés locaux et bindings

- `.dev.vars.preview` : secrets d'exécution de test ; `.dev.vars.production` : secrets de production pour l'opération autorisée ultérieure. Ces fichiers sont ignorés par Git.
- Variables publiques de build : environnement du terminal ou fichier de variables publiques chargé explicitement. Ne pas placer les secrets serveur dans un fichier public.
- `ASSETS` : binding configuré pour les fichiers construits. L'accès aux index privés de l'assistant passe exclusivement par le Worker.
- `IMAGES` : binding nécessaire au prétraitement réel des photos de plaque ; préparé dans le code mais non activé. Vérifier disponibilité et coût avant ajout de `images.binding = IMAGES`.
- Test connecté : Supabase isolé `bqqzzbwqmiyxcotvqtoc` et Redis isolé. Vérifier leur disponibilité et leurs clés avant écriture. Paris 2 est refusé en Preview. Ne pas utiliser le compartiment R2 de production pour un essai d'écriture.

La connexion interactive Wrangler et les secrets Workers sont distincts des clés S3 déjà utilisées pour R2. Ne pas réutiliser une clé R2 comme identifiant de déploiement Workers.

## Contrôle du 16 novembre 2026

Cloudflare est connecté ; la console affiche Workers Free actif et l'offre R2 Paid déjà existante. Aucun changement d'offre effectué.

Le Supabase de test existant est en pause et doit le rester à la demande d'Aime. L'export Preview Vercel du jour fournit sa bonne URL et sa clé publique, mais pas les valeurs sensibles des paramètres serveur Supabase/Redis/OpenAI listés ci-dessus. Ce constat porte sur l'export, pas sur leur présence distante. Ne pas substituer les paramètres de Paris 2.

Les deux exports Vercel locaux du jour contiennent des jetons OIDC d'environnement `development`, même celui demandé pour les variables de production. Ils sont temporaires et refusés par deux espaces Blob ; le troisième autorise la liste de 61 objets mais une lecture de PDF renvoie 403. Ne pas copier ces jetons dans les secrets Workers comme solution d'accès permanent. L'accès autonome aux anciens fichiers reste à établir.
