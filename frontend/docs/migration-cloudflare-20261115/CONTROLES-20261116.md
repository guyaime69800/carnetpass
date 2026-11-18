# Contrôles complémentaires du 16 novembre 2026

Périmètre : préparation de migration Cloudflare. Contrôles initiaux en lecture seule, puis **copie d'une seule notice Frisquet et ajout de sa correspondance R2, expressément autorisés par Aime**. Aucune publication, nouvelle indexation, modification de permission, de DNS ou d'abonnement. Aucun collecteur réactivé. Aime a refusé la remise en marche du projet de test ; il reste en pause.

Contrôle Vercel à 11 h 03 Paris : `carnetpass.fr` et `www.carnetpass.fr` pointent toujours vers `dpl_Fh8uqztA6UnpYhoz1X9RU4KVuqiZ`, READY, commit `4281476b41fb7cf8ee25dfb4b5459777fad33593`. Le diff suivi du dépôt habituel est strictement identique à la sauvegarde du 15 novembre : 29 979 octets. Aucun commit, push ou déploiement.

## Accès et configuration

| Contrôle | Résultat réel | Limite |
|---|---|---|
| Cloudflare Wrangler | Identité du compte attendu confirmée par `whoami` | Connexion seule, pas un déploiement |
| Offres Cloudflare dans la console | Workers Free actif ; R2 Paid déjà actif, échéance affichée au 11 décembre 2026 | API de facturation refusée ; constat provenant de la console. Aucun achat |
| Supabase de test | Console connectée : « CarnetPass Admin Preview », `bqqzzbwqmiyxcotvqtoc`, en pause | Aime demande de ne pas le réactiver. Connexion/MFA/import/Shiba en test connecté bloqués |
| Export Vercel Preview du jour | Bonne URL Supabase de test et clé publique présentes | Les valeurs sensibles Supabase serveur, Redis et OpenAI ne sont pas restituées. Cela ne prouve pas leur absence dans Vercel |
| Configuration privée locale | Exports conservés uniquement dans `.cloudflare`, ignoré par Git | Aucun secret à publier ou à coller dans un rapport |

Paramètres non restitués dans l'export de test : `SUPABASE_SECRET_KEY`, `UPSTASH_REDIS_REST_KV_REST_API_URL`, `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`, `OPENAI_API_KEY`. Ne pas les remplacer par des paramètres de production pour tester.

## Démarrage et ressources

Commande locale :

```powershell
node --use-system-ca node_modules/wrangler/bin/wrangler.js check startup --args='--env preview' --outfile .cloudflare/startup-20261116.cpuprofile
```

L'outil effectue une construction **à blanc**, puis mesure le démarrage sur le PC. Résultat : paquet 9 958,45 Kio, gzip 1 957,49 Kio ; fenêtre 361,2 ms ; calcul actif échantillonné 109,1 ms, dont 1,5 ms de ramasse-miettes ; inactivité 251,6 ms. Ce résultat ne mesure pas le CPU d'une requête distante : ne pas comparer directement le démarrage au plafond Free par requête.

L'essai initial sur le JavaScript brut a été refusé par l'analyseur du bundle. La commande ci-dessus, utilisant la construction de l'outil, a réussi. Une mesure complémentaire CPU/mémoire PDF via le débogueur local a été tentée, mais la connexion WebSocket au débogueur échoue, y compris hors bac à sable. **Aucune mesure PDF supplémentaire issue de cet essai.** Le banc a été arrêté. Les mesures PDF réussies du 15 novembre restent valables avec leurs limites : mémoire du processus Node et durée workerd locale, pas mémoire ou CPU facturé de Cloudflare.

Documentation officielle relue le 16 novembre : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/) et [tarifs Workers](https://developers.cloudflare.com/workers/platform/pricing/). Free : 10 ms CPU/requête. Free et Paid : 128 Mo par isolate. Paid débute à 5 USD/mois ; les services externes restent séparés. Aucun forfait souscrit. La faisabilité de l'ensemble de CarnetPass sur le gratuit n'est pas démontrée.

## Vercel Blob : accès réellement testé

Les trois espaces contiennent toujours 218 objets au total, soit 1 093 447 851 octets, et sont signalés `limits-exceeded-suspended`. Ce ne sont pas 218 PDF uniques.

| Espace | Objets indiqués | Liste détaillée | Lecture du contenu |
|---|---:|---|---|
| carnetpass-documents-production, privé | 140 | Refus `BlobOidcEnvironmentNotAllowedError` | Non testée, accès refusé avant cette étape |
| carnetpass-documents-public, public existant | 17 | Même refus | Non testée avec cette identité |
| carnetpass-documents, privé | 61 | 61 objets listés, sans page restante | Un petit PDF essayé : HTTP 403, aucun contenu récupéré |

Les exports Preview et Production obtenus localement contiennent tous deux une identité OIDC d'environnement `development`, vérifiée dans leurs métadonnées. Ne pas les présenter comme une identité de déploiement Production. Les jetons sont temporaires, pas une solution autonome durable pour Workers. Aucun `BLOB_READ_WRITE_TOKEN` utilisable dans ces exports. Ne pas créer de clé ni élargir les permissions sans nécessité et accord. Le 403 est prouvé ; sa cause exacte, au-delà du refus de lecture, ne l'est pas.

## Couverture R2 en base et lecture des objets

État initial : Paris 2 consulté avec une transaction explicitement `READ ONLY`, terminée par `ROLLBACK`. Aucun compte ni document fictif créé. Le tableau ci-dessous précède la seule copie autorisée, réalisée ensuite à 11 h 10 Paris.

| État documentaire | Fiches | Empreintes distinctes | Correspondances R2 vérifiées enregistrées | Sans correspondance vérifiée |
|---|---:|---:|---:|---:|
| Approuvé | 1 212 | 644 | 1 211 | 1 |
| En attente | 13 | 13 | 13 | 0 |
| Rejeté | 2 | 2 | 1 | 1 |

657 empreintes ont une copie R2 vérifiée enregistrée. Ce relevé ne relit pas les 657 fichiers. Une empreinte peut couvrir plusieurs fiches ; ne pas appeler ces associations des doublons à supprimer. Les tables des pièces jointes d'équipement actives et des rapports thermodynamiques contiennent zéro ligne au contrôle ; cela ne prouve pas l'absence d'autres références historiques dans les fichiers statiques ou le code.

Deux lectures R2 seulement, via le raccord S3 existant et sans écriture :

- Vue éclatée Viessmann 7749602 : relecture complète réussie, 1 019 515 octets, empreinte identique au PDF local : `6d9e9c55e84ed1d51abcde8da51a9f3213bc9054a9c7ea815cca0cf97473782f`.
- Notice d'installation Frisquet GAZLINER-VENTOUSE : chemin SHA-256 attendu absent, réponse **404 NoSuchKey**. Le PDF local est intact et correspond exactement à la taille et à l'empreinte de la base : 1 224 408 octets ; `8f813a61af4e9589472abf7ab371afccd0c0a4be81a7418cbe099ce3ad496405`.

Fiche concernée : `007f1692-c316-4b0a-ab08-82577665923f`, référence enregistrée `gazliner-ventouse-23-kw-9701000-9839999`, déjà approuvée et index `ready`. Aucun changement de son association ou de ses droits.

Copie locale préservée :

`C:\dev\carnetpass-documents\documents\Frisquet\GAZLINER-VENTOUSE\gazliner-ventouse-23-kw-9701000-9839999\notice-installation-3df5f6638fe37aa5143463e7dc1781c4.pdf`

Les lectures réussies sur le PC ne constituent pas des lectures depuis un Worker distant.

États Shiba enregistrés parmi les fiches approuvées : 974 `ready`, 212 `pending`, 26 `needs_ocr`. Les 13 fiches en attente et les 2 rejetées restent `pending`. **Aucune nouvelle indexation ni réponse Shiba vérifiée pendant cette session.**

## Seul changement distant autorisé puis exécuté à 11 h 10 Paris

Après présentation de ce périmètre, Aime a répondu « Oui, copier cette seule notice ». Opération réalisée avec le raccord existant, sans relancer le collecteur :

1. Contrôle du PDF local par le validateur existant ; sauvegarde complète de la seule fiche et de son état de correspondance dans un fichier privé ignoré de Git.
2. Nouvelle vérification d'absence de l'objet, puis création du seul PDF avec `If-None-Match: *`, sans écrasement.
3. Relecture intégrale R2 réussie, taille et SHA-256 identiques au fichier local.
4. Une seule correspondance insérée dans `platform_document_r2_copies`, avec `ON CONFLICT DO NOTHING` et contrôle de l'enregistrement relu. Aucun écrasement de correspondance.
5. Empreinte de la fiche complète, index `rag_data` inclus, identique avant/après ; chemin Blob historique, validation, statut et index conservés. PDF local relu et intact. Aucune publication nouvelle ni réindexation.

Clé créée : `platform-documents/sha256/8f813a61af4e9589472abf7ab371afccd0c0a4be81a7418cbe099ce3ad496405.pdf`.

Contrôle en lecture seule après opération : **1 212 fiches approuvées sur 1 212 avec correspondance R2 vérifiée enregistrée** ; 13 sur 13 en attente couvertes ; 1 sur 2 rejetées couverte. Total : **658 empreintes R2 enregistrées**. Les états Shiba sont identiques au relevé initial : 974 `ready`, 212 `pending`, 26 `needs_ocr` pour les fiches approuvées. Ce ne sont pas 658 nouveaux fichiers ou de nouvelles indexations.

Retour arrière, à ne réaliser qu'en cas d'incident : comparer l'enregistrement à la sauvegarde privée, vérifier qu'aucune autre nouvelle fiche ne dépend de la correspondance, puis retirer seulement la ligne créée si nécessaire ; conserver le PDF R2 et toutes les autres données. Aucune restauration globale de base.

L'accès Blob durable reste nécessaire pour la bibliothèque historique (`api/technical-document.js`), les dépôts de pièces jointes (`api/equipment-attachments.js`), les propositions de documents (`server/platform-document-submissions.js`) et les PDF réglementaires (`server/thermodynamic-documents.js`). Les 1 212 correspondances du catalogue ne prouvent pas l'indépendance de ces autres parcours. Cette seule copie ne suffit donc pas à déclarer la migration terminée.

## Preuves privées et état final

Sous `frontend\.cloudflare` : `account-check-20261116.json`, `vercel-test-config-check-20261116.json`, `test-service-reachability-20261116.json`, `startup-20261116.log`, `startup-20261116.cpuprofile`, `blob-read-check-20261116.json`, `blob-production-read-check-20261116.json`, `blob-content-read-check-20261116.json`, `database-storage-counts-20261116.json`, `database-storage-missing-20261116.json`, `frisquet-local-copy-check-20261116.json`, `r2-read-check-20261116.json`, `frisquet-r2-completion-20261116.json`, `database-storage-after-20261116.json`, `production-readonly-check-20261116.json`, `root-preservation-check-20261116.json`, `local-servers-stopped-20261116.json`. Sauvegarde de la seule fiche avant opération dans `.cloudflare/private/frisquet-before-r2-20261116.json`.

Les exports `.env.local` de ce répertoire sont privés : ne pas les joindre à l'archive des sources ou à Git. Les métadonnées de facturation sont limitées aux noms et états des offres ; ne pas conserver de donnée de carte ou d'adresse dans le rapport.

Les 327 tests applicatifs réussis du 15 novembre ne sont pas présentés comme rejoués aujourd'hui. Aucun code applicatif n'a été modifié pendant ces contrôles complémentaires. Les essais connectés restent bloqués ; aucune mise en production justifiée à ce stade. Aucun serveur de mesure laissé actif : absence d'écoute vérifiée sur 8787, 8788 et 9231.
