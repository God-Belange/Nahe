# Nahe — Suivi d'avancement

Dernière mise à jour : 2026-10-29 — MVP terminé en local, déploiement en attente de validation

## Analyse de compatibilité

| Sujet | Décision |
|---|---|
| Node | 22.23 (requis ≥ 22.22 par le plugin Vitest Cloudflare) |
| Vite | 8.x (supporté par `@cloudflare/vite-plugin` 1.66 et `@tailwindcss/vite`) |
| Vitest | **4.1.x** (pas de contrainte bloquante vers Vitest 5, mais 4.1 est la version validée) |
| Tests Workers | **`@cloudflare/vitest-plugin`** : `@cloudflare/vitest-pool-workers` (cité dans la spec) est déprécié par Cloudflare |
| TypeScript | **6.0.x** (typescript-eslint exige `<6.1`, donc pas TS 7) |
| Zod | 4.x (partagé front/back) |
| React Router | 8.x, mode « library » (SPA) |
| Tailwind | 4.x via `@tailwindcss/vite`; design tokens dans `@theme` (CSS) |
| Écart vs spec | Spec §3 parle de « config Tailwind » : en Tailwind 4 les tokens vivent dans le CSS (`@theme`). Même résultat. |
| npm | bug arborist (`edgesOut`) → `.npmrc` avec `legacy-peer-deps=true` |
| Écart vs CLAUDE.md | CLAUDE.md cite `docs/SPEC.md` et `AGENTS.md` ; les fichiers réels sont `SPEC.md` et `Agent.md`. |

Tous les services utilisés ont une offre gratuite sans carte bancaire : Workers, Static Assets, D1, Cron Triggers.
Aucun R2, aucun service payant.

## Plan d'implémentation

- [x] 1. Initialisation : package.json, tsconfig, Vite + `@cloudflare/vite-plugin`, wrangler.jsonc, ESLint, .gitignore
- [x] 2. Tailwind 4 + design system (tokens, Button, Card, Input, Badge, Modal, Toast, logo NAHE?)
- [x] 3. Schéma Drizzle + migrations D1 + seed
- [x] 4. Schémas Zod partagés + services métier (événements, réservations/capacité atomique, expiration, paiements, auth, rate-limit)
- [x] 5. API Hono publique + admin (session, CSRF, en-têtes sécurité) + cron
- [x] 6. Tests Vitest (workers pool) : tous les cas obligatoires de la spec §11
- [x] 7. Pages publiques (accueil, événement, réservation, suivi, confidentialité)
- [x] 8. Pages admin (login, dashboard, événements, réservations, paramètres)
- [x] 9. Vérification : typecheck, lint, tests, build, prévisualisation locale, test manuel navigateur
- [x] 10. README, CI GitHub Actions, étapes de déploiement (sans déployer)

## Journal

- 2026-10-29 : lecture de la spec, vérification des versions, plan établi.
- 2026-10-29 : worker + 128 tests (concurrence, sécurité, expiration, cron) ; fork public/admin pour les pages ; bug PATCH partiel trouvé et corrigé (valeurs par défaut Zod 4) ; CSP : suppression des polices en data: URI (`assetsInlineLimit: 0`) ; axe : 11 pages sans violation ; E2E navigateur OK sur le build de production.

## Billetterie QR (ajout demandé le 2026-10-29)

- [x] Spec mise à jour (§4.6, modèle de données, API, sécurité, tests)
- [x] Backend : table `tickets`, émission idempotente, jeton HMAC, QR (matrice + PNG), scan atomique, e-mail Brevo, plafonds anti-abus, annulation/anonymisation
- [x] Tests billetterie (30) : double scan simultané, falsification, groupe, e-mail, plafonds, aller-retour QR
- [x] Interface invité : QR sur le suivi, page `/t/:token`, politique de confidentialité
- [x] Interface organisateur : écran de scan (caméra, lien, saisie, liste de repli), renvoi des billets
- [x] E2E navigateur de la billetterie (`scripts/e2e-tickets.mjs`, caméra simulée) + audit a11y : 12 pages OK
- [ ] **Action propriétaire** : compte Brevo + clé API + adresse d'expédition validée (voir README)

## Décisions et ajouts par rapport à la spec

- Billets : jeton = identifiant + HMAC (non stocké) ; le QR encode `…/admin/scan?t=<jeton>` ; la consultation d'un billet n'a aucun effet de bord, la validation est une action explicite.
- E-mail attendu dans la requête de confirmation (réponse `ticketsEmail`) pour informer l'organisateur ; un échec n'annule rien.

- Colonnes ajoutées : `events.max_per_booking` (max par réservation configurable), `reservations.expired_at` et `anonymized_at` (horodatage des transitions, rétention 6 mois).
- Événements `closed` listés sur l'accueil (avec badge « Réservations fermées ») ; `draft` et `cancelled` jamais listés.
- Routes ajoutées : `/i/:inviteToken/reserver` (réserver un événement privé).
- Jeton CSRF dérivé par HMAC de la session (réémissible après rechargement) ; son hash est stocké (`csrf_token_hash`).
- Anonymisation (et non suppression) 6 mois après l'événement, en une seule requête SQL (limite gratuite : 50 requêtes D1 par invocation).
- Doublon d'e-mail `pending` : refusé de façon atomique dans le même `INSERT … SELECT`.

## Reste à faire (nécessite le propriétaire du compte)

Voir la section « Déploiement » du README : compte Cloudflare, `wrangler login`, `d1 create`, `database_id`, migrations distantes, 2 secrets, `npm run deploy`. Aucun déploiement n'a été effectué.
