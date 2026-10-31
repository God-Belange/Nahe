# NAHE? — Spécifications techniques et fonctionnelles

> **Nahe?** — Le prochain rendez-vous est ici.
> Version : MVP 0.2 (ajout de la billetterie, 2026-10-29) — Statut : brouillon à valider

## 1. Présentation

Nahe est une application web pour organiser des événements privés entre amis (soirées, barbecues, anniversaires, repas, sorties), partager l'invitation via WhatsApp, gérer les réservations et suivre les participations financières. Le nom vient de l'expression « Nahe ? » utilisée entre amis pour se donner rendez-vous.

### Objectifs

- Créer et publier un événement en quelques minutes.
- Partager un lien d'invitation (WhatsApp en priorité).
- Permettre aux invités de réserver **sans compte**.
- Proposer trois moyens de paiement manuels : **Wero**, **PayPal** et **Revolut**.
- Suivre participants, places et paiements.
- **Émettre un billet nominatif avec QR code par place** après confirmation du paiement, l'envoyer par e-mail, et **contrôler les entrées par scan** (un billet = une seule entrée).
- **Coût fixe : 0 €/mois** (offres gratuites Cloudflare uniquement).

### Périmètre MVP

Petit groupe privé, un seul organisateur (admin unique). L'architecture doit rester extensible, sans anticiper de fonctionnalités hors périmètre.

### Hors périmètre (explicitement exclu)

Comptes invités, chat, notifications SMS, remboursement automatisé, marketplace multi-organisateurs, intégration API de paiement, e-mails autres que le lien de suivi à la réservation et l'envoi des billets (pas de rappels ni de newsletters).

---

## 2. Stack technique

| Composant | Choix |
|---|---|
| Frontend | React + Vite + TypeScript (strict) |
| Styling | Tailwind CSS |
| Routing front | React Router |
| Backend | Cloudflare Workers (API) |
| Routeur API | Hono (léger, typé, natif Workers) |
| Base de données | Cloudflare D1 (SQLite) |
| ORM / migrations | Drizzle ORM + drizzle-kit |
| Validation | Zod (partagé front/back) |
| Tests | Vitest + `@cloudflare/vitest-pool-workers` |
| Hébergement | Cloudflare Workers avec Static Assets (via `@cloudflare/vite-plugin`) |
| Versioning / CI | GitHub (+ Workers Builds ou GitHub Actions) |
| Paiements | Wero, PayPal.Me et Revolut.me, sans API |
| Billets / QR | `qrcode-generator` (encodage QR, front + Worker) ; scan par caméra avec `jsqr` ; PNG du QR généré dans le Worker (sans dépendance native) |
| E-mail des billets | Brevo, API HTTPS (offre gratuite : 300 e-mails/jour, sans carte bancaire) ; interface `Mailer` remplaçable |

### Décisions techniques

- **Un seul Worker** sert l'API (`/api/*`) et les assets statiques du SPA. Cloudflare recommande désormais Workers + Static Assets pour les nouveaux projets plutôt que Pages ; à re-vérifier au moment de l'initialisation. Une seule unité de déploiement, pas de CORS à gérer.
- **Hono** est ajouté (non imposé) pour le routage, les middlewares et la validation Zod ; remplaçable si l'équipe préfère du Worker "nu".
- **Images** : pour rester à 0 € sans carte bancaire, les images (couvertures d'événements, QR code Wero) sont soit des **fichiers du projet** dans `public/images/` (assets statiques), soit des **photos téléversées depuis l'admin** (galerie ou appareil photo du téléphone), réduites dans le navigateur (JPEG, 1 Mo max) et stockées dans la table D1 `images` (base64), servies par `GET /api/images/:id`. La base d'événements ne garde que le chemin. R2 (offre gratuite mais carte bancaire requise) reste une évolution possible, non incluse.
- **Hachage du mot de passe admin** : PBKDF2 via WebCrypto (natif, rapide). Éviter bcrypt/scrypt en JS pur, qui dépassent le budget CPU du plan gratuit (10 ms/requête).
- **Expiration des réservations** : calcul paresseux (une réservation `pending` avec `expires_at` dépassé ne compte plus dans les places et est marquée `expired` à la prochaine lecture/écriture) **plus** un Cron Trigger quotidien de nettoyage.
- **Rate limiting** : table D1 dédiée (compteurs par IP hachée + fenêtre), car on ne suppose pas la disponibilité du binding natif de rate limiting sur le plan gratuit.

### Contraintes

- Aucun VPS, Docker ou Kubernetes. Aucun service payant obligatoire. Aucun nom de domaine payant (sous-domaine `*.workers.dev`).
- Aucun secret côté frontend ; secrets via variables Worker (`wrangler secret`).
- TypeScript strict partout (`strict: true`, `noUncheckedIndexedAccess`).

### Quotas du plan gratuit (à re-vérifier avant déploiement)

Valeurs indicatives connues à la date de rédaction ; la documentation Cloudflare fait foi.

| Service | Limite gratuite indicative | Impact Nahe |
|---|---|---|
| Workers (requêtes dynamiques) | ~100 000 / jour | Largement suffisant pour un groupe privé |
| Workers (CPU) | ~10 ms / requête | Hachage via WebCrypto uniquement |
| Static Assets | requêtes illimitées | Le SPA n'entame pas le quota |
| D1 | ~5 M lignes lues/jour, ~100 k écrites/jour, 5 Go | Index obligatoires pour limiter les lectures |
| Cron Triggers | inclus (nombre limité) | 1 tâche quotidienne |

Le README documente ces limites et le comportement attendu en cas de dépassement.

---

## 3. Identité visuelle et UX

Moderne, chaleureuse, festive — **pas** le style d'une billetterie professionnelle.

- Minimaliste, élégant, convivial ; typographie moderne ; palette cohérente avec une couleur principale dynamique.
- Logo typographique **NAHE?** avec le point d'interrogation mis en valeur.
- Cartes d'événements avec grandes images.
- Mobile-first, animations légères, transitions fluides (respect de `prefers-reduced-motion`).
- Accessibilité : contrastes AA, navigation clavier, états de focus visibles, labels de formulaire, messages d'erreur associés aux champs.
- Langue de l'interface : **français** (textes centralisés pour une i18n future éventuelle).
- Design tokens (couleurs, rayons, ombres, espacements) définis dans la config Tailwind ; composants de base réutilisables (Button, Card, Input, Badge, Modal, Toast).

### Pages

| Route | Page | Accès |
|---|---|---|
| `/` | Accueil | Public |
| `/e/:slug` | Détail événement publié | Public |
| `/i/:inviteToken` | Détail événement privé (lien d'invitation) | Lien secret |
| `/e/:slug/reserver` | Formulaire de réservation | Public / lien |
| `/r/:accessToken` | Suivi de réservation + instructions de paiement | Lien secret |
| `/confidentialite` | Politique de confidentialité | Public |
| `/admin/login` | Connexion admin | Public |
| `/admin` | Dashboard | Admin |
| `/admin/evenements`, `/admin/evenements/nouveau`, `/admin/evenements/:id` | Liste, création, édition | Admin |
| `/admin/reservations` | Gestion des participants | Admin |
| `/admin/parametres` | Paramètres de paiement | Admin |
| `/admin/emails` | Modèles des e-mails (billets, suivi) | Admin |

---

## 4. Fonctionnalités publiques

### 4.1 Accueil

- Logo NAHE?, slogan « Le prochain rendez-vous est ici. ».
- Liste des événements **publiés, à venir et non annulés**, triés par date.
- Par carte : image, titre, date, lieu (nom puis adresse), prix, places restantes (si l'organisateur l'a activé ; « Complet » reste toujours affiché), bouton « Voir l'événement ».
- Les événements non publiés ou privés n'apparaissent jamais ici.

### 4.2 Page événement

Contenu : titre, description, image de couverture, date/heure, lieu (nom puis adresse), prix (€), capacité, places restantes (si activé), date limite de réservation, informations complémentaires, bouton « Je réserve ma place ».

- **Visibilité** : un événement est soit `public` (listé, accessible via slug), soit `private` (non listé, accessible uniquement via un lien contenant un `invite_token` aléatoire). L'admin copie le lien en un clic, avec un bouton « Partager » (feuille de partage du système via Web Share API, copie du message en repli).
- Le bouton de réservation est désactivé, avec un message explicite, si l'événement est complet, fermé, annulé, passé ou si la date limite est dépassée. Le serveur applique ces règles indépendamment du front.

### 4.3 Réservation

Aucun compte requis.

| Champ | Règles |
|---|---|
| Prénom, nom | Obligatoires, 1–80 caractères |
| E-mail | Obligatoire, format valide |
| Téléphone | Obligatoire, format normalisé |
| Nombre de places | Entier ≥ 1, défaut 1, max configurable par réservation (défaut 10) et ≤ places restantes |
| Participants | Dès 2 places : prénom et nom obligatoires pour chaque place supplémentaire (la place 1 est au nom du titulaire). Stockés en JSON (`reservations.guests`), repris sur chaque billet, le scan et l'e-mail |
| Moyen de paiement | `wero` ou `paypal` (non demandé si l'événement est gratuit) |

Comportement :

1. Validation Zod côté serveur ; création atomique de la réservation en `pending` (voir §6).
2. Génération d'une **référence lisible unique** (ex. `NAHE-7K3F9Q`, alphabet sans caractères ambigus) et d'un **jeton d'accès** cryptographique (≥ 128 bits) dont seul le hash est stocké.
3. Redirection vers `/r/:accessToken` : récapitulatif, montant total, instructions de paiement.
4. `expires_at` = création + délai configurable (défaut **24 h**).
5. **Anti-doublon** : une clé d'idempotence envoyée par le formulaire évite la double soumission ; une seconde réservation `pending` avec le même e-mail pour le même événement est refusée avec un message clair renvoyant au suivi existant.
6. **Événement gratuit** (`price_cents = 0`) : la réservation passe directement en `confirmed`, sans étape de paiement.
7. Le jeton d'accès n'existe que dans l'URL de suivi ; l'invité est invité à **conserver ce lien** (favori, copie, partage à soi-même sur WhatsApp). Le lien de suivi est aussi envoyé **par e-mail à la création** d'une réservation en attente (e-mail distinct, « Suivre ma réservation » ; le jeton n'étant stocké que sous forme de hash, cet envoi n'est possible qu'à ce moment). L'envoi n'a jamais d'effet bloquant (fournisseur absent, en échec ou quota atteint : la réservation reste valide) et partage les plafonds anti-abus des billets (compteur par adresse distinct). L'e-mail des **billets** (§4.6) ne contient, lui, jamais le lien de suivi. Un lien perdu se retrouve via l'organisateur, qui peut régénérer un lien de suivi depuis l'admin (l'ancien jeton est invalidé).

### 4.4 Paiements (manuels)

Aucune intégration API. Aucune confirmation automatique.

**Wero** : instructions, QR code et/ou contact (e-mail ou numéro, avec bouton « Copier ») configurés par l'admin ; Wero ne fournit pas de lien pour ouvrir l'application ni pré-remplir numéro ou motif, montant à régler, référence de réservation à indiquer en motif lorsque c'est possible.

**PayPal** : lien PayPal.Me configuré, avec le montant ajouté (`paypal.me/<compte>/<montant>EUR`), référence affichée à copier.

**Revolut** : lien Revolut.me configuré (domaine `revolut.me` uniquement), normalisé en `revolut.me/<compte>`. Le montant n'est pas pré-rempli (non vérifié côté Revolut) : il est affiché à côté du bouton, avec la référence.

Règles :

- Un clic sur un lien de paiement **ne change jamais** le statut.
- Seul l'organisateur confirme, après vérification dans son application.
- Un bouton facultatif « J'ai payé » peut signaler le paiement à l'admin (indicateur visuel `payment_declared_at`), sans effet sur le statut.
- Rappel dans l'interface et le README : les modes de transfert entre proches ne sont à utiliser que lorsque l'opération est éligible selon les conditions de Wero, PayPal et Revolut.

### 4.5 Statuts de réservation

| Statut | Signification | Compte dans les places ? |
|---|---|---|
| `pending` | En attente de paiement (non expirée) | Oui |
| `confirmed` | Paiement vérifié par l'organisateur | Oui |
| `cancelled` | Annulée | Non |
| `expired` | Délai de paiement dépassé | Non |

Transitions autorisées : `pending → confirmed | cancelled | expired`, `confirmed → cancelled`. Une réservation `expired` ou `cancelled` n'est pas réactivable (l'invité refait une réservation). Toute transition est horodatée.

### 4.6 Billetterie et contrôle d'entrée

**Émission.** Lorsqu'une réservation passe à `confirmed` (confirmation manuelle par l'organisateur, ou réservation gratuite), le système émet **un billet par place** : une réservation de 4 places produit 4 billets, chacun avec son propre QR code. L'émission est idempotente (jamais de doublon, rattrapage automatique si une étape a échoué).

**Billet.** Numéroté `i / N`, rattaché à la réservation et à l'événement. Le QR code encode un jeton opaque signé `<id>.<signature>` (HMAC-SHA256 avec `SESSION_SECRET`, signature de 192 bits minimum), sous la forme d'une URL `https://<site>/admin/scan?t=<jeton>` : scanné avec l'appareil photo de l'organisateur, il ouvre directement l'écran de contrôle ; scanné par un tiers, il mène à la connexion admin sans rien révéler. Aucune donnée personnelle n'est contenue dans le QR code.

**Où l'invité voit ses billets.**
- sur la page de suivi `/r/:accessToken` dès que la réservation est confirmée (un QR code par billet, agrandissable) ;
- sur la page billet `/t/:ticketToken` (lien reçu par e-mail), qui affiche un seul billet en grand ;
- par e-mail (voir ci-dessous).

**E-mail.** À la confirmation, un e-mail unique récapitule l'événement et liste tous les billets (QR en image hébergée `GET /api/tickets/:token/qr.png` + lien vers la page billet). L'envoi **n'a jamais d'effet bloquant** : si le fournisseur est indisponible, non configuré ou si le quota est atteint, la confirmation reste valide, les billets restent visibles sur la page de suivi, et l'organisateur peut **renvoyer les billets** depuis l'admin. L'état d'envoi (`tickets_emailed_at`) est visible dans l'admin. Garde-fous anti-abus : plafond global quotidien (250 e-mails/24 h) et plafond par adresse et par événement (3 envois/24 h). L'e-mail ne contient pas le lien de suivi de la réservation.

**Contrôle d'entrée.** Écran `/admin/scan`, utilisable sur téléphone :
- scan par la caméra (HTTPS requis) ou saisie manuelle du code ; choix de l'événement contrôlé ;
- le scan affiche d'abord un résultat **sans effet de bord** (billet valide / déjà utilisé / annulé / autre événement / invalide) avec nom, billet `i / N` et événement, puis l'organisateur valide l'entrée (option « validation automatique » pour les files d'attente) ;
- **un billet ne peut entrer qu'une fois** : la validation est une unique instruction SQL atomique `UPDATE … WHERE checked_in_at IS NULL AND status = 'valid'` ; en cas de double scan (même simultané), un seul passe et l'autre reçoit « déjà utilisé le … à … » ;
- repli sans caméra : liste des billets de l'événement avec recherche (nom, référence) et validation manuelle ;
- l'organisateur peut annuler une validation faite par erreur ;
- compteur « entrés / attendus » par événement.

**Personnel d'entrée.** L'organisateur peut déléguer le contrôle sans partager son mot de passe : un second code d'accès (`SCANNER_PASSWORD_HASH`, facultatif) ouvre une session au rôle `scanner`, limitée à l'écran `/admin/scan` (navigation réduite, redirection depuis toute autre page admin). Elle ne donne accès ni aux ventes, ni aux e-mails/téléphones, ni aux paiements, ni aux réglages ; elle voit uniquement les noms des porteurs et références des billets nécessaires à l'entrée.

**Invalidation.** L'annulation d'une réservation annule tous ses billets ; l'annulation d'un événement bloque toute entrée ; un billet annulé ou d'un autre événement est refusé au scan. Un billet déjà utilisé reste visible comme tel. La régénération du lien de suivi n'affecte pas les billets.

**Rétention.** Les billets suivent la durée de conservation des réservations (6 mois après l'événement) ; l'anonymisation les rend inutilisables.

---

## 5. Administration

### 5.1 Événements

Créer, modifier, définir image/date/lieu (nom + adresse)/prix/capacité/affichage ou non des places restantes/date limite, **publier/dépublier**, **fermer les réservations**, **annuler** l'événement, copier le lien d'invitation.

Statuts d'événement : `draft`, `published`, `closed` (réservations fermées), `cancelled`.

Garde-fous : impossible de réduire la capacité sous le nombre de places déjà prises ; changer le prix n'affecte pas les réservations existantes (le montant est figé à la création) ; l'annulation d'un événement n'annule pas automatiquement les paiements déjà faits, elle affiche un avertissement et la liste des remboursements à traiter manuellement.

### 5.2 Réservations

Tableau : participant, événement, places, montant, moyen de paiement, statut, date de réservation, indicateur « paiement déclaré », état d'envoi des billets.

Actions : confirmer manuellement un paiement (émet les billets et déclenche l'e-mail), **renvoyer les billets**, annuler une réservation (libère les places et annule les billets), rechercher (nom, e-mail, référence), filtrer par événement et statut, **exporter en CSV** (échappement des formules `=`, `+`, `-`, `@` contre l'injection CSV).

### 5.3 Dashboard

- Nombre d'événements.
- Participants confirmés (somme des places).
- Réservations en attente.
- Places disponibles (tous événements à venir).
- **Montant encaissé** : somme des réservations `confirmed`.
- **Montant restant à collecter** : somme des réservations `pending` non expirées.

Les deux montants sont toujours présentés séparément et étiquetés pour ne jamais confondre « attendu » et « réellement encaissé ».

### 5.4 Paramètres de paiement

Instructions Wero, QR code Wero (fichier de `public/images/` ou image envoyée depuis l'admin), URL PayPal.Me (validée : domaine `paypal.me` uniquement), URL Revolut.me (domaine `revolut.me` uniquement), délai d'expiration par défaut.

### 5.5 Modèles d'e-mails

L'admin personnalise, pour chacun des deux e-mails (billets, lien de suivi), l'**objet**, l'**introduction** et la **conclusion**. La mise en page, le bloc événement, les QR codes et le bouton de suivi restent fixes (pas de HTML libre). Une ligne = un paragraphe ; `**gras**` supporté ; variables `{{prenom}}`, `{{evenement}}`, `{{date}}`, `{{lieu}}`, `{{adresse}}`, `{{reference}}` (+ `{{billets}}`, `{{billets_avec_nombre}}`, `{{nb_billets}}` pour les billets ; `{{lien}}` pour le suivi). Les valeurs sont toujours échappées ; une variable inconnue ou propre à l'autre modèle est refusée à l'enregistrement. Sans personnalisation (ou après « Rétablir le texte par défaut »), le texte d'origine est utilisé. Un aperçu en texte brut avec des valeurs d'exemple est affiché dans l'admin. Les modifications ne concernent que les envois suivants.

---

## 6. Modèle de données

D1 + Drizzle ORM. Montants en **centimes entiers**. Dates en ISO 8601 UTC (texte) ou timestamps entiers, de façon cohérente. Clés primaires en texte aléatoire (UUID v4/ULID) pour ne pas exposer de séquences.

### `events`

| Colonne | Type / contrainte |
|---|---|
| id | PK |
| slug | UNIQUE, NOT NULL |
| invite_token | UNIQUE, NOT NULL (aléatoire) |
| visibility | `public` \| `private`, NOT NULL |
| title, description | NOT NULL / texte |
| cover_image_url | texte |
| location | NOT NULL (nom du lieu) |
| address | texte, défaut `''` (adresse postale, facultative, ≤ 300 caractères) |
| show_remaining | booléen, défaut vrai (afficher ou non le compteur de places restantes) |
| starts_at, ends_at | NOT NULL / nullable ; `ends_at > starts_at` |
| price_cents | INTEGER ≥ 0 |
| capacity | INTEGER ≥ 1 |
| booking_deadline | nullable, ≤ `starts_at` |
| extra_info | texte |
| status | `draft` \| `published` \| `closed` \| `cancelled` |
| created_at, updated_at | NOT NULL |

Index : `slug`, `invite_token`, `(status, visibility, starts_at)`.

### `reservations`

| Colonne | Type / contrainte |
|---|---|
| id | PK |
| event_id | FK → events, NOT NULL |
| reference | UNIQUE, NOT NULL |
| first_name, last_name, email | NOT NULL |
| phone | nullable |
| quantity | INTEGER ≥ 1 |
| guests | TEXT (JSON `[{firstName, lastName}]`, places 2 à N), NULL si 1 place ; effacé à l'anonymisation |
| total_amount_cents | INTEGER ≥ 0 (figé à la création) |
| payment_method | `wero` \| `paypal` \| NULL (si gratuit) |
| payment_status | `pending` \| `confirmed` \| `cancelled` \| `expired` |
| payment_declared_at | nullable |
| access_token_hash | UNIQUE, NOT NULL (SHA-256) |
| idempotency_key | nullable, UNIQUE avec `event_id` |
| expires_at | nullable (NULL si confirmée/gratuite) |
| confirmed_at, cancelled_at | nullable |
| created_at | NOT NULL |

Index : `event_id`, `(event_id, payment_status)`, `access_token_hash`, `reference`, `email`, `(payment_status, expires_at)`.

### `tickets`

| Colonne | Type / contrainte |
|---|---|
| id | PK (identifiant aléatoire 128 bits, hexadécimal) |
| reservation_id | FK → reservations, NOT NULL |
| event_id | FK → events, NOT NULL |
| seq | INTEGER ≥ 1 (numéro du billet dans la réservation) ; UNIQUE avec `reservation_id` |
| status | `valid` \| `void` |
| checked_in_at | nullable (horodatage de l'entrée) |
| voided_at | nullable |
| created_at | NOT NULL |

Index : `reservation_id`, `(event_id, status)`. Le jeton affiché dans le QR n'est **pas stocké** : il est dérivé (`id` + HMAC de l'`id`) et vérifié à chaque scan.

`reservations` reçoit en plus : `tickets_emailed_at` (nullable), `anonymized_at`, `expired_at`.

### `email_templates`

`kind` (PK : `tickets` | `tracking`), `subject`, `intro`, `footer`, `updated_at`. Absence de ligne = texte par défaut (`shared/email-templates.ts`).

### `payment_settings` (ligne unique)

`id`, `wero_instructions`, `wero_qr_image_url`, `wero_contact`, `paypal_me_url`, `revolut_me_url`, `pending_ttl_hours`, `updated_at`.

### `admin_sessions`

`id`, `session_token_hash` (UNIQUE), `csrf_token_hash`, `expires_at`, `created_at`.

### `rate_limits`

`key` (IP hachée + action), `window_start`, `count` — PK `(key, window_start)`.

### Intégrité de la capacité (critique)

Places occupées = somme de `quantity` des réservations `confirmed` + `pending` non expirées.

D1 ne propose pas de transactions interactives : la réservation s'effectue par **une seule instruction SQL atomique**, de type `INSERT … SELECT … WHERE (places_prises + :quantity) <= capacity AND event ouvert`, suivie de la vérification du nombre de lignes insérées. En cas de 0 ligne, le serveur répond « plus assez de places » (409). Un test de concurrence (N requêtes parallèles sur les dernières places) valide ce comportement. `db.batch()` est utilisé là où plusieurs écritures doivent être atomiques (ex. annulation + horodatage).

---

## 7. API (esquisse)

Préfixe `/api`. Réponses JSON, erreurs au format `{ error: { code, message, fields? } }`.

**Public**

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/events` | Événements publics à venir |
| GET | `/events/:slug` | Détail (public) |
| GET | `/invites/:inviteToken` | Détail (privé) |
| POST | `/events/:id/reservations` | Créer une réservation |
| GET | `/reservations/:accessToken` | Suivi + instructions de paiement |
| POST | `/reservations/:accessToken/declare-payment` | Signaler « j'ai payé » |
| GET | `/tickets/:ticketToken` | Détail d'un billet (page billet) |
| GET | `/tickets/:ticketToken/qr.png` | Image PNG du QR code (e-mails) |

**Admin** (session + CSRF)

| Méthode | Route | Rôle |
|---|---|---|
| POST / DELETE | `/admin/session` | Connexion / déconnexion |
| GET | `/admin/dashboard` | Statistiques |
| GET/POST/PATCH | `/admin/events[/:id]` | CRUD événements |
| POST | `/admin/events/:id/{publish,unpublish,close,cancel}` | Changements d'état |
| GET | `/admin/reservations` | Liste filtrée / recherche |
| POST | `/admin/reservations/:id/{confirm,cancel}` | Actions |
| POST | `/admin/reservations/:id/regenerate-link` | Nouveau lien de suivi (invalide l'ancien) |
| GET | `/admin/reservations.csv` | Export |
| GET/PUT | `/admin/payment-settings` | Paramètres |
| GET | `/admin/email-templates` | Modèles d'e-mails (défaut ou personnalisé) |
| PUT/DELETE | `/admin/email-templates/:kind` | Enregistrer / rétablir le texte par défaut |
| GET | `/admin/scan/events` | Événements contrôlables (hors brouillons) : `id`, `title`, `startsAt`, `status` uniquement — **rôle scanner autorisé** |
| GET | `/admin/tickets/lookup?t=` | Consulter un billet scanné (sans effet de bord) |
| POST | `/admin/tickets/check-in` | Valider l'entrée d'un billet (par jeton) — atomique |
| POST | `/admin/tickets/:id/check-in`, `/:id/undo-check-in` | Validation manuelle / annulation d'une validation |
| GET | `/admin/events/:id/tickets` | Billets de l'événement + compteur entrés/attendus |

**Rôles.** `POST /admin/session` accepte le mot de passe organisateur (`ADMIN_PASSWORD_HASH`) ou, s'il est configuré, le code d'accès du personnel d'entrée (`SCANNER_PASSWORD_HASH`) ; le code saisi fixe le rôle de la session (`admin` ou `scanner`, colonne `admin_sessions.role`). Le rôle `scanner` n'est autorisé que sur `/admin/scan/events`, `/admin/tickets/*` et `/admin/events/:id/tickets` ; toute autre route `/admin/*` répond 403 `forbidden`. Même limitation de débit à la connexion, mêmes protections CSRF/Origin.
| POST | `/admin/reservations/:id/resend-tickets` | Renvoyer l'e-mail des billets |

L'API publique ne renvoie jamais de données de participants (noms, e-mails) ; elle n'expose que des compteurs. Seules exceptions : la page de suivi (son titulaire), et la page billet qui n'affiche que le prénom du titulaire et `i / N`. Le suivi d'une réservation confirmée inclut les jetons de ses billets.

---

## 8. Sécurité

- **Validation** : Zod sur toutes les entrées côté serveur (corps, query, params) ; schémas partagés avec le front.
- **Authentification admin** : mot de passe unique dont le hash PBKDF2 (sel + itérations) est fourni en secret Worker ; session aléatoire côté serveur (hash en base), durée limitée, rotation à la connexion.
- **Cookies** : `HttpOnly; Secure; SameSite=Strict` (ou `Lax`), préfixe `__Host-`.
- **CSRF** : jeton lié à la session (en-tête) + vérification de l'en-tête `Origin` sur toutes les requêtes mutantes.
- **Rate limiting** : connexion admin (ex. 5 échecs / 15 min / IP), création de réservations (ex. 5 / heure / IP), déclaration de paiement.
- **Billets** : jeton = identifiant aléatoire + HMAC-SHA256 (comparaison en temps constant) ; l'unicité d'entrée repose sur un `UPDATE` conditionnel atomique, jamais sur un contrôle « lire puis écrire » ; la consultation d'un billet n'a aucun effet de bord (anti-préchargement de liens) ; permission caméra limitée à l'origine (`Permissions-Policy: camera=(self)`) ; le changement de `SESSION_SECRET` invalide tous les billets (à documenter).
- **Jetons** : `crypto.getRandomValues`, ≥ 128 bits, comparés en temps constant ; seuls les hashes sont stockés.
- **Données** : aucune donnée personnelle dans les URL (hors jeton opaque) ; pages de suivi en `Cache-Control: no-store` et `Referrer-Policy: no-referrer` ; `noindex` sur les pages privées.
- **Injection** : requêtes paramétrées via Drizzle ; échappement React ; export CSV neutralisé.
- **En-têtes** : CSP stricte, `X-Content-Type-Options`, `frame-ancestors 'none'`.
- **Autorisation** : middleware admin sur tout `/api/admin/*`, vérifié côté backend uniquement.
- **Secrets** : variables d'environnement Worker, jamais dans le dépôt ; `.dev.vars` ignoré par git. Billetterie : `BREVO_API_KEY`, `MAIL_FROM_EMAIL`, `MAIL_FROM_NAME` (facultatifs : sans eux, aucun e-mail n'est envoyé).
- **Vie privée** : collecte minimale ; page de politique de confidentialité ; **conservation limitée** (suppression/anonymisation des réservations 6 mois après l'événement, via le Cron Trigger) ; journaux sans données personnelles ; l'adresse e-mail n'est utilisée que pour envoyer les billets (aucun autre message), via le sous-traitant Brevo (mentionné dans la politique de confidentialité).

---

## 9. Organisation du code

```
nahe/
├── src/                    # Frontend React
│   ├── components/         # UI réutilisable
│   ├── pages/              # Pages (public/ et admin/)
│   ├── hooks/
│   ├── lib/                # client API, formatage, i18n
│   ├── types/
│   └── styles/
├── worker/                 # Backend Cloudflare Worker
│   ├── index.ts            # Point d'entrée + cron
│   ├── routes/             # public/ et admin/
│   ├── services/           # Logique métier (réservations, capacité, paiements)
│   ├── middleware/         # auth, csrf, rate-limit, headers
│   └── db/                 # schéma Drizzle, client
├── shared/                 # Schémas Zod et types partagés front/back
├── drizzle/                # Migrations SQL générées
├── public/
├── tests/                  # unitaires, intégration Worker, e2e léger
├── package.json
├── wrangler.jsonc
├── drizzle.config.ts
└── README.md
```

Règle : les routes restent minces ; la logique métier vit dans `services/` et est testable sans HTTP.

---

## 10. Déploiement

- Dépôt GitHub ; branche `main` protégée.
- `wrangler.jsonc` : Worker, assets (SPA fallback), binding D1, cron.
- Migrations Drizzle appliquées par `wrangler d1 migrations apply`.
- Déploiement automatique sur push `main` (Workers Builds ou GitHub Actions) : build → tests → migrations → deploy.
- URL publique : `https://nahe.<compte>.workers.dev`.
- README : variables d'environnement documentées (`ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, …), quotas gratuits, limites connues.

Commandes cibles (à finaliser à l'initialisation) :

```bash
npm install
npm run dev                  # Vite + Worker en local (D1 locale)
npm run db:generate          # Génère une migration Drizzle
npm run db:migrate:local     # Applique les migrations en local
npm run test                 # Vitest
npm run typecheck && npm run lint
npm run build
npx wrangler d1 create nahe-db
npm run db:migrate:remote
npx wrangler secret put ADMIN_PASSWORD_HASH
npm run deploy               # wrangler deploy
```

---

## 11. Tests et critères d'acceptation

### Tests obligatoires

- Création d'un événement (validation, slug unique).
- Calcul des places restantes (pending non expirées + confirmed).
- Réservation gratuite (directement `confirmed`) et payante (`pending`).
- Refus d'une réservation dépassant la capacité.
- **Réservations simultanées** sans surréservation.
- Expiration d'une réservation et libération des places.
- Confirmation manuelle du paiement.
- Annulation et libération des places.
- Accès admin : routes protégées, session expirée, CSRF, rate limiting de connexion.
- Protection des données : l'API publique ne divulgue aucune donnée de participant ; jeton de suivi invalide → 404.
- **Billetterie** : N places → N billets distincts ; aucun billet avant confirmation ; émission idempotente ; annulation → billets annulés ; jeton falsifié ou modifié rejeté ; **double scan simultané : une seule entrée acceptée** ; billet d'un autre événement / événement annulé refusé ; consultation sans effet de bord ; annulation d'une validation ; e-mail envoyé à la confirmation (une fois par billet émis, contenant tous les QR), sans lien de suivi ; échec du fournisseur sans effet sur la confirmation ; renvoi manuel ; plafonds anti-abus ; QR généré décodable (aller-retour encodage → décodage).
- Événement privé non listé ; événement `draft` inaccessible.

### Définition de "terminé" pour le MVP

- [ ] L'admin crée et publie un événement.
- [ ] Un invité réserve sans compte.
- [ ] Il choisit Wero, PayPal ou Revolut et voit montant, référence et instructions.
- [ ] L'organisateur confirme le paiement manuellement.
- [ ] Chaque place confirmée a son billet à QR code, reçu par e-mail et visible sur le suivi.
- [ ] L'organisateur scanne les billets à l'entrée avec son téléphone ; un billet ne passe qu'une fois.
- [ ] Le nombre de places disponibles est toujours exact.
- [ ] Le site est utilisable sur mobile.
- [ ] Le site est déployé sur une URL gratuite Cloudflare.
- [ ] Aucun abonnement payant n'est requis à petite échelle.
- [ ] Typecheck, lint et tests passent en CI.

---

## 12. Plan de développement

Progressif, une étape livrable à la fois :

1. Valider l'architecture et la compatibilité avec les offres gratuites (ce document).
2. Initialiser React/Vite/TypeScript + Worker (`@cloudflare/vite-plugin`).
3. Tailwind CSS et design system.
4. Pages publiques avec données fictives.
5. D1 et Drizzle : schéma, migrations, seed.
6. API et logique de réservation (capacité atomique, expiration).
7. Instructions de paiement Wero, PayPal et Revolut.
8. Authentification et dashboard admin.
9. Validations, sécurité et tests.
10. Déploiement Cloudflare et README.
11. Billetterie : table `tickets`, émission, QR, e-mail (Brevo), page billet, scan et contrôle d'entrée, tests.

Priorité absolue : une première version **simple, sécurisée, utilisable et sans frais fixes**.

---

## 13. Points à valider

**Décidés**

1. Expiration des réservations `pending` : **24 h**.
2. Conservation des données : **6 mois** après l'événement.
3. Lien de suivi envoyé par e-mail à la réservation (demande du propriétaire, 2026-10-30) ; l'invité est aussi invité à le **conserver**.
4. Images : pas de R2. Téléversement depuis l'admin vers D1 (table `images`, base64, 1 Mo max, JPEG/PNG/WebP vérifiés par signature, SVG refusé) ; la saisie d'un chemin `public/images/…` reste possible. Les images non référencées sont purgées par la maintenance quotidienne après 24 h.
5. Bouton « J'ai payé » (signalement sans effet sur le statut) : **inclus**.
6. Hono ajouté à la stack imposée : **accepté**.

7. **Billetterie (demande du propriétaire, 2026-10-29)** : un billet par place, QR code, envoi par e-mail à la confirmation, contrôle d'entrée par scan, un billet = une entrée : **inclus** (§4.6). Cela lève l'exclusion « e-mails transactionnels » pour ce seul usage.
8. **Fournisseur d'e-mail : Brevo** (gratuit, 300 e-mails/jour, sans carte bancaire, expéditeur vérifié par une adresse e-mail — pas de nom de domaine à acheter). Limite connue : sans domaine propre authentifié (SPF/DKIM/DMARC), l'e-mail peut arriver dans les courriers indésirables ; c'est pourquoi les billets restent aussi accessibles sur la page de suivi et renvoyables depuis l'admin. Le propriétaire doit créer le compte Brevo et fournir la clé API (secret Worker).

Aucun point ouvert côté développement ; reste à fournir la clé API Brevo avant le déploiement.
