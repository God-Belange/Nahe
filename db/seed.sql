-- Données de démonstration pour le développement local uniquement.
-- Usage : npm run db:seed:local   (ne jamais exécuter en production)
INSERT OR IGNORE INTO payment_settings (id, wero_instructions, wero_qr_image_url, paypal_me_url, pending_ttl_hours, updated_at)
VALUES (1, 'Ouvrez Wero, choisissez « Envoyer de l''argent » puis saisissez le numéro 06 00 00 00 00 (Sam). Indiquez la référence de réservation en motif.', NULL, 'https://paypal.me/nahe-demo', 24, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO events (id, slug, invite_token, visibility, title, description, cover_image_url, location, address, starts_at, ends_at, price_cents, capacity, booking_deadline, extra_info, max_per_booking, status, created_at, updated_at) VALUES
('seed-bbq', 'barbecue-de-la-rentree', 'seedtoken-bbq-0000000000000000', 'public', 'Barbecue de la rentrée',
 'On rallume les braises ! Viandes, légumes grillés, desserts maison et playlist d''été pour se retrouver autour du feu. Apportez votre bonne humeur, on s''occupe du reste.',
 '/images/barbecue.svg', 'Chez Sam', '12 rue des Lilas, 59000 Lille',
 strftime('%Y-%m-%dT18:00:00.000Z', 'now', '+21 days'), strftime('%Y-%m-%dT23:30:00.000Z', 'now', '+21 days'),
 1800, 24, strftime('%Y-%m-%dT18:00:00.000Z', 'now', '+18 days'),
 'Prévoyez de quoi vous couvrir pour la soirée. Boissons sans alcool et végétariennes disponibles.', 6, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('seed-soiree', 'soiree-blanche', 'seedtoken-soiree-00000000000000', 'public', 'Soirée blanche',
 'Dress code blanc, lumières tamisées et DJ set jusqu''au bout de la nuit.',
 '/images/soiree.svg', 'Le Loft', '4 quai des Arts, 59000 Lille',
 strftime('%Y-%m-%dT21:00:00.000Z', 'now', '+45 days'), NULL,
 2500, 60, NULL, '', 10, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
('seed-anniv', 'anniversaire-de-lea', 'seedtoken-anniv-00000000000000', 'private', 'Anniversaire de Léa (privé)',
 'Surprise ! Gâteau, bougies et fous rires. Merci de ne pas en parler à Léa.',
 '/images/anniversaire.svg', 'Chez Léa', '8 avenue Foch, 59100 Roubaix',
 strftime('%Y-%m-%dT19:30:00.000Z', 'now', '+30 days'), NULL,
 0, 15, NULL, 'Amenez un petit mot ou une anecdote à partager.', 4, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
