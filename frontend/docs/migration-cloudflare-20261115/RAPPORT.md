# Migration CarnetPass vers Cloudflare Workers

Préparation : 15 novembre 2026. Actualisation : 16 novembre 2026, Europe/Paris. État : **adaptations locales réalisées ; Cloudflare connecté ; migration distante non effectuée et non validée**.

Les résultats du 16 novembre et les décisions d'Aime sont consignés dans [CONTROLES-20261116.md](CONTROLES-20261116.md). Après accord spécifique, une seule notice Frisquet a été copiée dans R2 et sa correspondance ajoutée en base. Fiche, validation et index inchangés. Aucun changement applicatif en production.

## 1. Version de départ et sauvegarde

Le dossier habituel est sur `release/paris2-admin-documents`, commit `d8c1951f8a2ab982a0033f802ff769d54a36aa9e`. Il ne correspond pas aux sources actuellement servies. Ses 15 fichiers suivis modifiés ont été préservés : comparaison du diff binaire avant/après identique, 29 979 octets.

La production a été identifiée à partir de Vercel et du relevé de portée des fichiers de publication :

- Déploiement servi par les domaines : `dpl_Fh8uqztA6UnpYhoz1X9RU4KVuqiZ`, READY.
- Sources locales correspondantes : `C:\dev\chaudiere-web3\.vercel\founder-navigation-20261110\release`, commit `4281476b41fb7cf8ee25dfb4b5459777fad33593`.
- Comparaison initiale des 745 fichiers du frontend avec le manifeste de publication conservé dans `.vercel\founder-navigation-branch-repair-20261110\deployment-scope.json` : conservation de la correction Airwell locale, seul écart applicatif relevé dans cette copie.
- Dernier contrôle Vercel en lecture seule à 19:28 UTC : même identifiant de production, READY. Preuve : `..\..\..\..\production-final-check.json` relativement au dossier du rapport.
- Tentative précédente rejetée `dpl_rn2NwNYTp3e32CQUskXNcgjgAeDd` : blocage Hobby sur la cadence du cron existant. Elle n'est pas la production de référence. Aucun changement de ses crons n'a été appliqué pendant cette migration.

La branche locale `migration/cloudflare-20261115` est créée depuis la copie de référence, dans :

`C:\dev\chaudiere-web3\.vercel\cloudflare-migration-20261115\worktree`

Toutes les adaptations applicatives sont dans son sous-dossier `frontend`, pas dans le frontend habituel.

Sauvegarde : `C:\dev\chaudiere-web3\.vercel\cloudflare-migration-20261115\backup` :

- `production-source.bundle` : archive Git autonome, vérifiée avec `git bundle verify` ;
- `release-working.patch` et copie du fichier Airwell : modifications non commitées de référence ;
- `root-working.patch`, état et références Git du dépôt habituel ;
- `migration-working.patch` : diff des adaptations suivies, avec code non suivi conservé dans la copie de travail ;
- `migration-preparation.zip` : 66 fichiers modifiés/nouveaux de préparation, archive relue et comparée octet par octet avant livraison ;
- `private` : copies des configurations locales connues et inventaire de stockage. Chemin exclu de Git, vérifié avec `git check-ignore`. Aucune valeur de configuration privée dans ce rapport.

Ne pas considérer le patch seul comme sauvegarde des nouveaux fichiers : la copie de travail et son relevé `FICHIERS-MODIFIES.md` font partie du dossier de reprise. Aucun commit, push ou reset effectué.

## 2. Architecture retenue et compatibilité

| Composant | Adaptation et état |
|---|---|
| React/Vite/PWA | Conservés ; compilation locale réussie. Pages publiques et interface testées dans workerd. |
| API serveur | Un Worker et le serveur `node:http` compatible Workers. Adaptateur des 11 points d'entrée et 20 alias existants, sans nouveau service distant. |
| Middleware | Exécuté avant les fichiers et API : rôles, MFA, maintenance, sécurité et noindex conservés. |
| Supabase | Comptes, données, RLS et rôles conservés. Aucune migration SQL. La Preview refuse l'URL Paris 2. |
| R2 | Réutilisation du SDK S3 et des chemins/métadonnées existants. Aucune modification des PDF, clés d'objets ou permissions. Vérification distante depuis Workers restant à réaliser. |
| Shiba | Recherche, quotas et filtrage existants conservés ; index historiques chargés pour l'équipement sélectionné, sans réindexation. Tests de conservation des contenus et pages réussis. |
| Stripe | Adaptateur conservant le corps brut des notifications signées. Aucun appel Stripe réel effectué. |
| OpenAI, Upstash, mail, Polygon | Clients existants conservés. Aucun appel IA, courriel, paiement ou transaction blockchain pendant cette préparation. |
| Vercel Blob | SDK conservé. Liste de 61 objets obtenue le 16 novembre ; lecture d'un PDF refusée HTTP 403. Les deux autres espaces refusent l'identité locale Vercel. Accès durable depuis Workers non établi. |
| Photos de plaque | Le module natif canvas reste disponible côté Vercel ; adaptation Workers vers le binding Images réel. Sans ce binding, erreur explicite 503 : aucune simulation de photo ou d'IA. Binding non configuré et non testé. |

Cloudflare documente le support de React existant et du serveur HTTP Node avec `httpServerHandler`. Choix : garder Vite et les handlers actuels, avec `nodejs_compat` et `enable_nodejs_http_server_modules`, date de compatibilité `2026-11-15`. Aucun passage à Next.js, Pages, nouvelle base ou nouvelle architecture d'agent. Sources : [React/Vite](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/), [Node HTTP](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/).

## 3. Modifications réalisées

- `wrangler.jsonc` : environnements distincts, fichiers statiques, routage avant assets, aucun domaine ou compte imposé, tâches désactivées dans tous les environnements.
- `cloudflare/worker.js`, `router.js`, `routes.js`, `environment.js` : transport Fetch/Node, alias exacts et paramètres réservés contrôlés, réponses et cookies, refus des mauvaises cibles.
- `shared/runtime-environment.js` et appels concernés : identité Cloudflare explicite. Pas de faux `VERCEL_ENV`. Comportement Vercel de repli conservé. Origine des liens Preview configurée explicitement et contrôlée.
- `server/lib/platform-admin-environment.js` : branche de migration autorisée uniquement avec la base Preview existante ; protection production conservée.
- `server/plate-scan.js`, `server/lib/plate-image-node.js`, `server/cloudflare/plate-image.js` : séparation du traitement natif et Workers ; budget du scan administrateur conservé dans son espace distinct.
- `server/cloudflare/equipment-registry.js`, `rag-loader.js`, `rag-manifest.json`, alias du registre et appel dans `api/ai.js` : chargement à la demande des anciens index, avec contrôle SHA-256 et taille.
- `scripts/prepare-cloudflare-rag.mjs` : 13 équipements historiques, 38 fichiers d'index uniques, copiés sans modification dans un espace ASSETS privé au Worker. Aucun PDF transféré. Ces fichiers ne sont pas dans le précache PWA. Les URL publiques de cet espace sont refusées, y compris encodées.
- `scripts/build-cloudflare.mjs`, `cloudflare-inventory.mjs`, `check-cloudflare-release.mjs`, commandes npm et lockfile : construction, inventaire de noms sans valeurs, vérification du build et refus du build hors ligne à la publication. Wrangler épinglé `4.162.0`.
- Tests de transport, identité d'environnement, intégrité/portée des index et budget administrateur ajoutés. Trois tests anciens ont été alignés sur la redirection de connexion déjà présente dans les sources de production : les mêmes cinq attentes 401 incorrectes échouaient aussi sur la référence avant migration. Les API anonymes restent refusées.
- Regroupement Airwell existant conservé : famille WELLEA M HT, dix variantes exactes, puissances/phases et références conservées.

La liste exacte des fichiers suivis modifiés et des nouveaux fichiers est dans `FICHIERS-MODIFIES.md`. Les données sources d'index restent intactes ; la validation métier et les droits documentaires n'ont pas changé.

## 4. Vérifications réellement effectuées

| Contrôle | Résultat observé | Limite |
|---|---|---|
| Suite complète Node | **327 tests réussis, zéro échec, zéro ignoré** | Tests locaux, avec substituts déjà utilisés pour les services externes. Pas un test connecté réel. |
| Compilation | React/Vite réussi, 842 modules ; audit client 39 fichiers, aucun secret détecté | Build hors ligne : aucune clé serveur chargée ; comparaison avec zéro valeur secrète réelle, pas une preuve de configuration distante complète. |
| Paquet Worker | `wrangler deploy --env preview --dry-run` réussi | Aucun téléchargement du paquet vers Cloudflare ; démarrage distant et limites réelles non mesurés. |
| Navigateur Chromium | Accueil et connexion en 1366×900 et 390×844 : pas d'erreur JavaScript, pas de débordement horizontal ; captures inspectées | Contexte neuf sans session ; aucune saisie de compte ni requête externe autorisée. |
| Administration anonyme | `/administration-interne` : 303 vers `/connexion-interne` ; API administrative : 401 | Compte fondateur connecté et AAL2 non testés en ligne. |
| Maintenance locale | Accueil 200 avec présentation fermée ; `/espace-pro` et `/api/search` : 503, Retry-After 300 ; connexion administrative conservée | Activation Preview locale uniquement, aucun changement Redis de production. |
| SEO Preview | Pages publiques avec noindex ; robots Disallow ; sitemap sans URL de production à indexer | Search Console et DNS non modifiés. |
| Index privés | URL réelle et variantes encodées : 404 ; intégrité et contenu du modèle sélectionné vérifiés par tests | Réponse Shiba avec API réelle et utilisateur authentifié non obtenue. |
| Signatures/corps brut | Octets bruts et plusieurs Set-Cookie conservés lors du test HTTP Node ; contrôles Stripe existants réussis | Webhook Stripe reçu dans Workers distant non testé ; aucun paiement lancé. |
| Fichiers privés/configuration | `.dev.vars*`, `.cloudflare`, `.wrangler`, `.env.cloudflare*` ignorés ; sauvegardes privées sous `.vercel` ignoré | Configuration des secrets Workers non effectuée. |

Les preuves locales sont dans `frontend\.cloudflare` : `full-tests.log`, `build.log`, `dry-run.log`, `http-smoke.json`, `maintenance-smoke.json`, `ui-smoke.json`, captures PNG et mesures PDF. Le premier essai de navigateur attendait un arrêt de trafic PWA et expirait ; l'attente a été remplacée par l'affichage réel du formulaire. Le premier contrôle maintenance rencontrait un conflit entre serveurs locaux, corrigé par arrêt ciblé et nom distinct ; seuls les résultats du contrôle final ci-dessus sont retenus.

Les deux derniers serveurs Wrangler ont été arrêtés après vérification : zéro écoute restante sur les ports locaux 8787 et 8788. Aucun serveur de test laissé actif.

Les sept pages publiques conservées sont `/`, `/faq`, `/mentions-legales`, `/confidentialite`, `/cookies`, `/conditions-utilisation`, `/conditions-commerciales`. `/contact` est une route applicative, pas une huitième page SEO déclarée.

### Mesures sur deux PDF existants

| PDF local | Taille | Pages / passages | Node Windows | Moteur Workers local |
|---|---:|---:|---|---|
| Vue éclatée Viessmann 7749602 | 1 019 515 octets | 10 / 10 ; 0 page blanche | 394 ms écoulées ; 656 ms CPU ; maximum RSS 160 Mio | HTTP 200 ; 10 pages / 10 passages ; 362 ms écoulées |
| Manuel Vitocal 200-S R32 201.E | 24 242 104 octets | 184 / 214 ; 0 page blanche | 4 447 ms écoulées ; 5 985 ms CPU ; maximum RSS 252 Mio | HTTP 200 ; 184 pages / 214 passages ; 8 602 ms écoulées |

Les valeurs Node sont celles du processus Windows, pas la mémoire d'un isolate Cloudflare. Les durées workerd sont des temps de requête locaux, pas du CPU facturé. Le test local n'applique pas à lui seul les limites du forfait distant. **Le traitement des gros PDF n'est pas encore validé sous la limite de mémoire Workers.** Ne pas annoncer le gratuit suffisant.

Commandes de mesure : `node scripts/benchmark-cloudflare-pdf.mjs <chemin-local>` et Worker de mesure séparé `wrangler.benchmark.json` sur localhost seulement. Ce dernier n'est pas l'entrée du Worker applicatif et ne doit jamais être publié. Pas d'indexation, d'appel IA ou de rattachement pendant ces mesures.

## 5. Coûts et limites vérifiés dans les documentations actuelles

Le paquet initial embarquait environ 124 Mio d'index JSON et dépassait la limite de script. Après chargement privé à la demande : environ **9,7 Mio non compressés / 1,9 Mio compressés**, contrôlés à blanc. Les fichiers statiques préparés représentent environ 109 Mio au total, avec un maximum individuel de 11 988 534 octets. Les fichiers RAG ne sont pas de nouveaux documents téléchargés.

Workers Free : 100 000 requêtes/jour, CPU 10 ms/invocation, mémoire 128 Mo, 50 sous-requêtes, 64 variables. Paid : mémoire identique, davantage de CPU et de sous-requêtes. Script non compressé 64 Mio, démarrage 1 seconde ; asset individuel 25 Mio. Ces limites ne sont pas un abonnement R2 ou un forfait de domaine. [Limites Workers](https://developers.cloudflare.com/workers/platform/limits/).

Workers Paid commence à **5 USD/mois**, incluant 10 millions de requêtes et 30 millions de ms CPU, puis facturation d'usage. Ici le Worker passe avant les assets pour la sécurité : ne pas promettre toutes ces visites gratuites au motif que les assets seuls sont gratuits. Le coût réel dépendra des mesures distantes et du trafic. Pour l'indexation PDF et le calcul Shiba, le forfait gratuit n'est pas démontré adéquat. Aucun forfait souscrit. [Tarifs Workers](https://developers.cloudflare.com/workers/platform/pricing/).

Images est distinct : transformations disponibles sur l'offre gratuite, 5 000 transformations uniques mensuelles ; sur le payant, supplément annoncé de 0,50 USD/1 000 au-delà du palier inclus. Le binding photo n'a pas été activé. La disponibilité pour ce compte et les limites doivent être vérifiées avant son utilisation. [Tarifs Images](https://developers.cloudflare.com/images/pricing/).

Construction faite sur le PC : aucune minute Workers Builds consommée. Si raccordement Git ultérieur : documentation indiquant 3 000 minutes/mois gratuites, timeout 20 minutes, puis conditions propres à l'offre. Aucune intégration Git Cloudflare créée. [Limites et tarifs Builds](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/).

Supabase, R2, OpenAI, Upstash, Stripe, Resend et Polygon restent des services séparés avec leurs consommations existantes. Leur facture n'a pas été auditée. Ne pas annoncer « 5 USD tout compris » ni une économie totale garantie.

Si le test distant dépasse 128 Mo : conserver le lecteur et proposer l'indexation administrative sur un exécuteur Node séparé, éventuellement le PC existant pour limiter le coût. Aucune externalisation ou nouvelle infrastructure créée aujourd'hui. L'augmentation du forfait Workers ne relève pas sa limite mémoire : décision à prendre seulement après mesure.

## 6. Stockage Vercel Blob restant

Inventaire metadata en lecture seule :

| Espace | Accès | Objets | Octets | État Vercel |
|---|---|---:|---:|---|
| carnetpass-documents-production | Privé | 140 | 814 347 642 | limits-exceeded-suspended |
| carnetpass-documents-public | Public existant | 17 | 42 706 261 | limits-exceeded-suspended |
| carnetpass-documents | Privé | 61 | 236 393 948 | limits-exceeded-suspended |
| Total | | 218 | 1 093 447 851 | |

Il s'agit d'objets de stockage, pas d'un décompte de PDF uniques ou de modèles. Aucune permission publique ajoutée. Preuve privée : `backup/private/storage-inventory.json` dans le dossier de migration parent.

Le 16 novembre, les exports Vercel existants ont permis d'obtenir une identité locale OIDC temporaire d'environnement `development`, y compris lors de l'export des variables de production. Une liste complète de 61 objets a été obtenue pour `carnetpass-documents`, mais un PDF renvoie HTTP 403. Les deux autres espaces renvoient `BlobOidcEnvironmentNotAllowedError`. Aucun contenu Blob récupéré, aucune permission élargie. L'attribution du HTTP 403 à la seule suspension n'est pas démontrée. Ces jetons locaux temporaires ne constituent pas un accès durable pour Workers.

**La consultation effective de tous les anciens fichiers depuis Cloudflare n'est donc pas encore vérifiée.** Le code de consultation est préservé ; cela ne prouve pas que les espaces suspendus répondent aux lectures. Bloquant pour la bascule complète.

Stratégie proposée, non exécutée : établir l'accès serveur approprié, inventorier les chemins et références, comparer chaque objet aux copies R2 déjà vérifiées ; conserver les anciens objets tant que leur réutilisation et les associations ne sont pas confirmées. Pour les objets encore uniquement dans Blob, proposer un transfert R2 privé conditionnel avec comparaison SHA-256 et mise à jour ciblée des correspondances, après accord. Ne pas rendre public un document privé ; ne rien supprimer aujourd'hui et ne pas rompre les anciens liens pendant le retour arrière.

## 7. Contrôles connectés restant obligatoires

Wrangler connecté depuis le 15 novembre par `login --device` ; identité confirmée à nouveau le 16 novembre. Console de facturation : Workers Free actif et R2 Paid déjà actif, sans achat. Les clés S3 R2 restent distinctes des identifiants Workers.

Le projet Supabase existant `bqqzzbwqmiyxcotvqtoc`, « CarnetPass Admin Preview », est en pause, constaté dans la console connectée le 16 novembre. **Aime a demandé de le laisser en pause et de poursuivre localement.** Ne pas le réactiver ni créer un autre environnement. Les essais connectés ci-dessous restent bloqués.

Préparer ensuite une configuration de test réellement isolée : URL/clé publique/clé serveur du Supabase existant de test, Redis séparé, espace R2 de test pour toute écriture. Aucun environnement créé et aucun compte fictif ajouté pendant cette préparation. Ne pas utiliser Paris 2 pour contourner l'absence d'accès au test. Le code refuse explicitement Paris 2 en Preview. Les fonctions R2 historiques réservées à la production n'ont pas été ouvertes à un compartiment de production depuis la Preview.

Après accord pour une publication de test, vérifier et consigner :

1. Connexion/restauration de session ; fondateur avec MFA AAL2 ; utilisateur ordinaire refusé ; absence de session redirigée. Aucun rôle déduit d'un e-mail ou d'un abonnement.
2. Catalogue : recherche, pagination, variantes et ouverture PDF autorisée ; refus d'un identifiant d'une autre entreprise ou d'un PDF privé sans session.
3. Import manuel ZIP/PDF par un compte autorisé ; doublons, validation et indexation inchangées. Déclenchement explicite, aucun automatisme du collecteur réactivé.
4. Shiba : document et page exacts, modèle voisin exclu, document non validé exclu, compteurs conservés. Les index historiques privés doivent rester inaccessibles par URL.
5. Équipements, interventions, rapports, pièces jointes et QR en lecture seule pour le public selon les règles existantes.
6. Stripe uniquement test : signature d'un webhook réellement reçu, retour à l'origine configurée, aucune clé live dans les essais. Les rappels et transactions restent désactivés. Une réponse d'un test unitaire ne remplace pas cette preuve.
7. Scan photo réel via le binding Images ; refus d'image invalide et coût mesuré.
8. Profil CPU/mémoire/démarrage sur Workers, notamment PDF 184 pages et plus gros PDF encore accepté ; décider le forfait et le plafond CPU après ces mesures. Vérifier aussi les requêtes sortantes et le nombre de variables effectivement nécessaires.

La configuration R2 et les règles d'origine CORS de l'import direct doivent être contrôlées pour l'origine de test exacte avant un test d'écriture. Ne pas ajouter un joker global. Les retours Supabase doivent autoriser uniquement l'origine précise nécessaire. Aucun changement effectué dans Supabase, R2, Stripe ou Resend.

## 8. Publication et bascule : procédure préparée, non exécutée

Toutes les commandes ci-dessous se lancent depuis le `frontend` de migration. La connexion seule n'est pas un déploiement.

### Connexion Cloudflare déjà effectuée

```powershell
node --use-system-ca node_modules/wrangler/bin/wrangler.js whoami
```

Ne pas refaire une connexion fonctionnelle. Ce contrôle ne publie rien. Les offres et l'identité sont confirmées ; aucun abonnement ne doit être activé pendant cette préparation.

### Refaire une construction destinée au test

Renseigner les deux variables publiques du projet isolé dans l'environnement local de construction. Configurer séparément les secrets d'exécution de test dans Workers, après présentation des changements distants et accord. Voir `cloudflare/VARIABLES.md` pour les noms.

```powershell
npm run cf:build
npm run cf:test
npm run cf:check
npm run cf:release:check
```

`npm run cf:build -- --offline` permet de reproduire le contrôle sans accès, mais produit volontairement un build non publiable. Le contrôle refuse actuellement celui-ci avec `OFFLINE_BUILD_NOT_PUBLISHABLE`. Ne pas le contourner. La commande à blanc ne remplace pas le contrôle préalable à une vraie publication.

Après accord explicite, seulement :

```powershell
node --use-system-ca node_modules/wrangler/bin/wrangler.js deploy --env preview
```

Ne pas connecter GitHub ou pousser cette branche pour déclencher une publication involontaire. Ne pas ajouter de domaines de production à ce stade. Conserver noindex et crons désactivés. Vérifier l'identifiant de version réellement servi, puis réaliser les contrôles connectés ci-dessus.

### Préparer la production après validation du test

- Sauvegarder le relevé DNS web actuel, aliases Vercel et variables de configuration dans un emplacement privé. Ne pas toucher à MX, SPF, DKIM, DMARC.
- Résoudre l'accès aux anciens objets Blob et vérifier les copies R2 et autorisations. Aucun changement de validation documentaire.
- Recréer une construction `npm run cf:build -- --production` avec les variables publiques Paris 2 ; vérifier les secrets et les verrous réels. Exécuter le contrôle `npm run cf:release:check -- --production`.
- Faire approuver le compte/forfait, la version, les modifications DNS web exactes, le transfert des crons et le retour arrière. Aucun enregistrement DNS concret ne doit être inventé avant lecture de la zone Cloudflare et de son propriétaire.
- Publier uniquement après accord : `node --use-system-ca node_modules/wrangler/bin/wrangler.js deploy --env production`. Pas de route de domaine dans la configuration actuelle : les deux domaines se raccordent explicitement lors de l'opération approuvée.
- Conserver l'origine canonique `https://www.carnetpass.fr`. Le Worker redirige `carnetpass.fr` vers `www` avant restauration de session ; le cookie `__Host-` reste attaché à son hôte, sans élargissement de domaine. Vérifier la connexion après redirection : ne pas promettre le partage automatique de cookies entre apex et www.
- Mettre à jour les liens de callback nécessaires seulement si l'origine change. Les URL du domaine de production restant identiques, les callbacks Supabase/Stripe existants ne doivent pas être changés arbitrairement. Tester la réception avant retrait définitif de Vercel.

### Tâches planifiées, sans double exécution

Cadences existantes recensées : rapprochement Stripe `*/5 * * * *`, rappels `0 8 * * *`, nettoyage `15 * * * *`. Ces expressions sont en UTC, pas des horaires Paris garantis toute l'année. Aucun changement de cadence effectué et aucune tâche du collecteur réactivée.

Dans Cloudflare, crons vides, `CARNETPASS_SCHEDULED_ENABLED=false`, `CARNETPASS_SCHEDULER_OWNER=none`. Le handler refuse toute exécution si l'environnement, le propriétaire, le secret ou l'activation manquent. Preview toujours désactivée.

Lors de la bascule approuvée : vérifier les exécutions Vercel réellement actives, désactiver d'abord ses déclencheurs dédiés, attendre la fin de l'exécution en cours, puis activer les expressions identiques et les deux indicateurs Cloudflare. Ne pas maintenir les deux producteurs en parallèle. Aucun verrou interhébergeurs nouveau n'a été créé : cette séquence de transfert est obligatoire et les mécanismes d'idempotence existants restent utilisés. Vérifier la première exécution réelle, pas seulement la présence des expressions.

## 9. Retour arrière

Avant la bascule, conserver le déploiement Vercel READY identifié et les domaines existants ; ne pas le supprimer. Le bundle et les sources de référence restent disponibles sans restaurer une ancienne base.

En cas d'échec après bascule :

1. Désactiver les crons Cloudflare et attendre les traitements en cours.
2. Rétablir les seuls rattachements web sauvegardés vers le déploiement Vercel conservé ; garder la messagerie intacte.
3. Vérifier la version servie, le parcours de connexion/fondateur/MFA, catalogue, lecture PDF et Shiba.
4. Réactiver les crons Vercel seulement après confirmation de l'arrêt Cloudflare ; ne pas déployer une nouvelle version Vercel sur Hobby pour « réparer » les crons pendant le retour.
5. Conserver toutes les données ajoutées depuis la bascule, PDF R2, associations et index. Aucune restauration globale Supabase ni suppression de fichiers.

Si le déploiement Vercel conservé ne peut plus être servi à cause d'une restriction de compte, le constater avant la bascule : le bundle seul ne garantit pas un retour hébergé disponible. Le statut READY observé aujourd'hui et le maintien des domaines constituent le point de retour actuel.

## Conclusion

Le code est adapté et testable localement ; les contrôles réalisés ne justifient pas encore une bascule de carnetpass.fr. Cloudflare est connecté. La notice Frisquet manquante a été copiée après accord : les 1 212 fiches approuvées ont désormais une correspondance R2 vérifiée enregistrée. Les points restants sont les essais connectés isolés (projet volontairement laissé en pause), l'autonomie des lectures et écritures encore liées à Blob, le binding photo et les ressources PDF mesurées en ligne. L'hébergement de production, les comptes, validations et indexations n'ont pas changé.
