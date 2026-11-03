# Nahe? — Le prochain rendez-vous est ici.

Application web pour organiser des événements privés entre amis : publication d'événements, invitation par lien (WhatsApp), réservation **sans compte**, paiement manuel par **Wero**, **PayPal.Me** ou **Revolut.me**, suivi des participants et des encaissements, et **billetterie à QR codes** (un billet par place, envoi par e-mail, contrôle d'entrée par scan).

Coût fixe : **0 €/mois** (offres gratuites Cloudflare). Spécification : [SPEC.md](SPEC.md). Avancement : [PROGRESS.md](PROGRESS.md).

## Stack

React 19 + Vite + TypeScript strict · Tailwind CSS 4 · React Router · Cloudflare Workers + Static Assets (un seul Worker pour l'API et le SPA) · Hono · Cloudflare D1 + Drizzle ORM · Zod (schémas partagés) · Vitest avec `@cloudflare/vitest-plugin` (tests dans le runtime Workers).

## Démarrage local

Prérequis : Node.js ≥ 22.22.

```bash
npm install
cp .dev.vars.example .dev.vars          # puis renseigner les deux valeurs (voir ci-dessous)
npm run db:migrate:local                # crée la base D1 locale (.wrangler/state)
npm run db:seed:local                   # facultatif : événements de démonstration
npm run dev                             # http://localhost:5173
```

Le fichier `.dev.vars` est ignoré par git. Pour générer le hash du mot de passe administrateur :

```bash
npm run admin:hash -- "un mot de passe d'au moins 12 caractères"
```

Copier le résultat dans `ADMIN_PASSWORD_HASH` (entre apostrophes dans `.dev.vars`, car il contient des `$`).

### Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Vite + Worker (D1 locale) |
| `npm run build` | Typecheck + build de production (`dist/`) |
| `npm run preview` | Prévisualise le build avec le runtime Workers |
| `npm run typecheck` / `npm run lint` | Contrôles statiques |
| `npm run test` | Tests Vitest (dans workerd) |
| `npm run check` | Typecheck + lint + tests |
| `npm run e2e` / `npm run e2e:tickets` / `npm run a11y` | Parcours navigateur et audit axe (nécessitent `npm run dev` ou `preview` + Google Chrome) |
| `npm run db:generate` | Génère une migration Drizzle après modification de `worker/db/schema.ts` |
| `npm run db:migrate:local` / `db:migrate:remote` | Applique les migrations (locale / distante) |
| `npm run admin:hash -- "mdp"` | Calcule `ADMIN_PASSWORD_HASH` |
| `npm run deploy` | Build + `wrangler deploy` (**manuel**, voir plus bas) |

## Variables d'environnement

| Nom | Type | Description |
|---|---|---|
| `ADMIN_PASSWORD_HASH` | secret Worker | Hash PBKDF2-SHA256 (100 000 itérations) du mot de passe organisateur. |
| `SCANNER_PASSWORD_HASH` | secret Worker (facultatif) | Hash (même commande `npm run admin:hash`) du **code d'accès du personnel d'entrée**. Ce code ouvre une session limitée au contrôle des billets. Doit différer du mot de passe organisateur. Sans lui, seul l'organisateur peut scanner. |
| `SESSION_SECRET` | secret Worker | Chaîne aléatoire longue : dérive le jeton CSRF, **signe les billets** et hache les IP pour la limitation de débit. ⚠ Le changer invalide tous les billets déjà émis. |
| `BREVO_API_KEY` | secret Worker (facultatif) | Clé API Brevo pour l'envoi des billets. |
| `MAIL_FROM_EMAIL` | variable/secret (facultatif) | Adresse d'expéditeur **vérifiée dans Brevo**. |
| `MAIL_FROM_NAME` | variable (facultatif) | Nom d'expéditeur (défaut : « Nahe »). |

Aucun secret n'est présent côté frontend ni dans le dépôt. En production : `npx wrangler secret put ADMIN_PASSWORD_HASH`, `npx wrangler secret put SESSION_SECRET` (et, pour le personnel d'entrée, `SCANNER_PASSWORD_HASH` ; et, pour les e-mails de billets, `BREVO_API_KEY` et `MAIL_FROM_EMAIL`). Sans configuration Brevo, tout fonctionne sauf l'envoi d'e-mails : les billets restent visibles sur le lien de suivi.

## Utilisation

1. `/admin/login` : connexion organisateur.
2. **Paiements** : renseigner les instructions Wero, le QR code (envoyé depuis l'admin) et, si besoin, l'e-mail ou le numéro Wero (copiable en un clic par l'invité ; Wero ne permet pas de pré-remplir via un lien), le lien PayPal.Me et le lien Revolut.me. Sans moyen de paiement configuré, un événement payant ne peut pas être réservé.
3. **Événements** : créer, publier, copier le lien d'invitation / partager via les réseaux. Un événement `public` est listé sur l'accueil ; un événement `private` n'est accessible que par son lien secret `/i/<jeton>`.
4. L'invité réserve, choisit Wero, PayPal ou Revolut, et conserve son **lien de suivi** `/r/<jeton>` (il peut y changer de moyen de paiement tant que la réservation est en attente) (il lui est aussi envoyé par e-mail à la réservation si Brevo est configuré).
5. **Réservations** : l'organisateur vérifie le paiement dans son application, puis confirme manuellement. Le bouton « J'ai payé » de l'invité n'est qu'un signalement.

### Images

Couverture d'événement et QR code Wero : dans l'admin, « Choisir une image » ouvre la galerie (ou l'appareil photo) du téléphone. L'image est réduite dans le navigateur puis stockée dans D1 (table `images`, 1 Mo max, sans service payant) ; les images devenues inutiles sont purgées par la tâche quotidienne. Nécessite d'appliquer les migrations `0003_images`, `0004_revolut_me_url`, `0005_wero_url`, `0006_reservation_guests`, `0007_wero_contact`, `0008_email_templates`, `0009_scanner_role`, `0010_door_price` et `0011_reminded_at` (`npm run db:migrate:remote`).

Alternative : déposer le fichier dans `public/images/` (ex. `public/images/barbecue.jpg`), saisir `/images/barbecue.jpg` dans l'admin et redéployer.

## Billetterie et contrôle d'entrée

- **Un billet par place** : une réservation de 4 places → 4 billets, chacun avec son QR code (« Billet 2 / 4 »). Les billets sont émis à la **confirmation du paiement** (ou immédiatement pour un événement gratuit), de façon idempotente.
- **Où l'invité les voit** : sur sa page de suivi, sur une page billet `/t/<jeton>`, et par **e-mail** (un message récapitulatif avec tous les QR, envoyé à la confirmation ; il ne contient pas le lien de suivi).
- **Contrôle** : `/admin/scan` (Scanner), sur téléphone — caméra intégrée ou appareil photo natif (le QR ouvre `/admin/scan?t=…` ; il faut être connecté). Le scan **affiche d'abord** le résultat sans rien modifier, puis l'organisateur valide l'entrée (une option permet la validation automatique). Repli sans caméra : liste des billets avec recherche et validation manuelle.
- **Code d'accès « entrée »** : l'organisateur peut donner à une personne de confiance un code distinct (`SCANNER_PASSWORD_HASH`), saisi sur la même page de connexion. Cette session ne voit que le contrôle d'entrée (liste d'événements minimale, scan, validation, liste des billets avec noms) : ni ventes, ni e-mails ou téléphones, ni paiements, ni réglages (toute autre route répond 403). Changer ce code = mettre à jour le secret ; les sessions durent 12 h.
- **Un billet = une entrée** : la validation est une unique instruction SQL conditionnelle ; même deux scans simultanés ne laissent entrer qu'une personne (testé). Un billet annulé, d'un autre événement ou d'un événement annulé est refusé.
- **Sécurité des billets** : le jeton du QR est un identifiant aléatoire signé par HMAC (non stocké, infalsifiable) ; il ne contient aucune donnée personnelle.
- **Gras dans la description** : dans la description d'un événement, entourez un texte de `**deux astérisques**` pour l'afficher en gras sur la page publique.
- **E-mail** : envoyé via [Brevo](https://www.brevo.com) (gratuit, 300 e-mails/jour). L'envoi ne bloque jamais la confirmation ; en cas d'échec, l'organisateur voit l'état dans Réservations et peut **renvoyer les billets**. Plafonds anti-abus : 250 e-mails/jour au total, 3 par adresse et par événement.
  - **Relancer un paiement** : sur `/admin/reservations`, le bouton « Relancer » d'une réservation en attente envoie un e-mail de rappel (montant, échéance, bouton « Payer ma réservation »). Le lien de suivi étant stocké sous forme de hash, l'e-mail contient un nouveau lien et l'ancien est invalidé (uniquement si l'envoi réussit). Nécessite la migration `0011_reminded_at` et la clé Brevo.
  - **Personnaliser les e-mails** : `/admin/emails` permet de modifier l'objet, l'introduction et la conclusion des e-mails de billets, de suivi et de relance de paiement (variables `{{prenom}}`, `{{evenement}}`…, gras avec `**texte**`, aperçu intégré, bouton « Rétablir le texte par défaut »). Nécessite la migration `0008_email_templates`.
  - ⚠ **Délivrabilité** : sans nom de domaine propre authentifié (SPF/DKIM/DMARC), Brevo envoie depuis votre adresse d'expéditeur vérifiée mais certains fournisseurs (Gmail, Outlook) peuvent classer le message en indésirable. D'où la redondance : billets toujours visibles sur le lien de suivi et renvoyables.

### Configurer Brevo (une seule fois, gratuit)

1. Créer un compte sur brevo.com (offre gratuite, pas de carte bancaire).
2. *Expéditeurs, domaines et IP → Expéditeurs* : ajouter et **valider** l'adresse e-mail d'expédition (lien de vérification reçu par mail).
3. *SMTP & API → Clés API* : créer une clé API.
4. `npx wrangler secret put BREVO_API_KEY` ; `npx wrangler secret put MAIL_FROM_EMAIL` (l'adresse validée). En local, renseigner les mêmes valeurs dans `.dev.vars`.

## Règles métier importantes

- **Capacité** : places prises = réservations `confirmed` + `pending` non expirées. La réservation est une unique instruction SQL atomique `INSERT … SELECT … WHERE (places prises + quantité) <= capacité` : aucune surréservation, même en concurrence (testé).
- **Expiration** (24 h par défaut, configurable) : calcul paresseux (une réservation expirée libère immédiatement ses places) + marquage `expired` à la prochaine lecture/écriture + Cron quotidien. Une réservation expirée n'est pas réactivable.
- **Montants** en centimes entiers, figés à la création de la réservation.
- **Événement gratuit** : réservation directement `confirmed`.
- **Rétention** : le Cron quotidien (03:00 UTC) anonymise les réservations 6 mois après la fin de l'événement et invalide leur lien de suivi.
- Les virements entre proches (Wero, PayPal, Revolut) ne doivent être utilisés que lorsque l'opération est éligible selon les conditions de ces services.

## Sécurité

Validation Zod côté serveur · mot de passe PBKDF2 (WebCrypto) · session aléatoire côté serveur (hash en base, 12 h) · cookie `__Host-` `HttpOnly; Secure; SameSite=Strict` · jeton CSRF + contrôle de l'en-tête `Origin` sur toute requête mutante · limitation de débit en base (connexion : 5 échecs / 15 min / IP ; réservation : 5 / h / IP ; « J'ai payé » : 10 / h / IP) · jetons ≥ 128 bits dont seuls les hash sont stockés · pages de suivi et d'invitation en `no-store`, `no-referrer`, `noindex` · CSP stricte via `public/_headers` · export CSV protégé contre l'injection de formules · l'API publique n'expose jamais de donnée de participant.

## Quotas du plan gratuit Cloudflare

Vérifiés dans la documentation Cloudflare le 2026-10-29 (à re-vérifier avant le déploiement) :

| Service | Limite gratuite | Comportement en cas de dépassement |
|---|---|---|
| Workers : requêtes | 100 000 / jour (reset 00:00 UTC) | Le Worker répond en erreur (1027) jusqu'au lendemain |
| Workers : CPU | 10 ms / requête | La requête échoue ; le hachage PBKDF2 utilise WebCrypto natif |
| Workers : sous-requêtes / requêtes D1 | 50 par invocation | Erreur sur l'invocation concernée |
| Cron Triggers | 5 par compte (1 utilisé) | — |
| Brevo (e-mails) | 300 e-mails / jour (offre gratuite) | Envois refusés jusqu'au lendemain ; le plafond interne (250/jour) évite d'atteindre la limite |
| Static Assets | requêtes illimitées, 20 000 fichiers | — |
| D1 | 5 M lignes lues/jour, 100 k écritures/jour, 5 Go | Les requêtes D1 échouent jusqu'au lendemain |

Pour un petit groupe privé, la marge est très large. Aucun service payant n'est activé ni requis ; Cloudflare ne facture rien tant que le compte reste sur le plan Free.

## Déploiement (gratuit)

**Rien n'est déployé automatiquement.** Étapes à réaliser par le propriétaire du compte :

1. Créer un compte Cloudflare gratuit (sans carte bancaire) et s'authentifier : `npx wrangler login`.
2. Créer la base : `npx wrangler d1 create nahe-db`, puis copier le `database_id` retourné dans [wrangler.jsonc](wrangler.jsonc).
3. Appliquer les migrations : `npm run db:migrate:remote`.
4. Définir les secrets : `npx wrangler secret put ADMIN_PASSWORD_HASH` (valeur de `npm run admin:hash`) et `npx wrangler secret put SESSION_SECRET` (chaîne aléatoire longue).
5. Déployer : `npm run deploy`. L'URL sera `https://nahe.<compte>.workers.dev`.
6. (Optionnel) Automatiser avec **GitLab CI** : voir la section « Intégration continue » ci-dessous. Alternatives : soit **Workers Builds** (Cloudflare Dashboard → Workers → nahe → Settings → Builds, connexion au dépôt GitHub), soit le workflow GitHub manuel [.github/workflows/deploy.yml](.github/workflows/deploy.yml) (secrets `CLOUDFLARE_API_TOKEN` avec le modèle « Edit Cloudflare Workers » + D1, et `CLOUDFLARE_ACCOUNT_ID`).
7. Sur GitHub : protéger la branche `main` et exiger la CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Intégration continue (GitLab)

[.gitlab-ci.yml](.gitlab-ci.yml) : une pipeline par merge request et par push sur `main`.

| Étape | Jobs | Bloquant |
|---|---|---|
| `quality` | `typecheck`, `lint`, `unit-tests` (rapport JUnit), `build`, `migrations-drift` (schéma Drizzle sans migration committée), `dependency-audit` (`npm audit`, prod, niveau high) | oui, sauf `dependency-audit` |
| `test` | `e2e` (parcours invité/admin, audit axe, billetterie sur build de production, image Playwright) ; `secret_detection` (template GitLab) | `secret_detection` oui ; `e2e` non pour l'instant (`allow_failure`, à retirer une fois la pipeline stable) |
| `deploy` | migrations D1 distantes + `wrangler deploy`, **uniquement sur `main`** | — |

Variables CI/CD à créer (en « Masked » et « Protected ») : `CLOUDFLARE_API_TOKEN` (modèle « Edit Cloudflare Workers » + D1 Edit) et `CLOUDFLARE_ACCOUNT_ID`. `main` doit être une branche protégée. Activer « Auto-cancel redundant pipelines » (Settings → CI/CD → General pipelines) et, côté merge request, « Pipelines must succeed ». Le tag de l'image Playwright (`e2e`) doit suivre la version de `playwright-core`.

## Structure

```
src/        Frontend React (components, pages/public, pages/admin, hooks, lib)
worker/     Worker : index.ts (fetch + cron), routes/, services/ (logique métier), middleware/, db/
shared/     Schémas Zod, règles et types partagés front/back
drizzle/    Migrations SQL générées
db/         Données de démonstration (seed.sql, local uniquement)
public/     Assets statiques : images/, _headers (en-têtes de sécurité)
tests/      Tests Vitest exécutés dans le runtime Workers
```

## Limites connues

- Un seul administrateur ; pas de comptes invités ; les seuls e-mails envoyés sont le lien de suivi (à la réservation) et les billets (à la confirmation) ; un lien perdu se régénère depuis l'admin.
- Le scan par caméra exige HTTPS (ou `localhost`) et l'autorisation de la caméra ; sur iOS, utiliser Safari ou l'appareil photo natif.
- Fenêtres de limitation de débit fixes (un pic à cheval sur deux fenêtres peut doubler brièvement le quota).
- Le cookie `__Host-` exige `Secure` : en local, utiliser `http://localhost` (traité comme sécurisé par Chrome et Firefox ; Safari peut refuser le cookie).
- Les dépendances de développement `drizzle-kit` embarquent un ancien `esbuild` (alerte `npm audit` modérée, outil de développement uniquement, jamais déployé).
- Le plugin `@cloudflare/vitest-plugin` remplace `@cloudflare/vitest-pool-workers` cité dans la spec (déprécié par Cloudflare).
