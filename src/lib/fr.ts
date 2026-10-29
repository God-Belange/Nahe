/** Textes de l'interface, centralisés pour une éventuelle i18n. */
export const fr = {
  brand: { slogan: 'Le prochain rendez-vous est ici.' },
  nav: { events: 'Événements', privacy: 'Confidentialité', admin: 'Organisateur' },
  common: {
    loading: 'Chargement…',
    retry: 'Réessayer',
    back: 'Retour',
    save: 'Enregistrer',
    cancel: 'Annuler',
    close: 'Fermer',
    confirm: 'Confirmer',
    copy: 'Copier',
    copied: 'Copié !',
    free: 'Gratuit',
    required: 'obligatoire',
    optional: 'facultatif',
    genericError: 'Une erreur est survenue. Réessayez dans un instant.',
    networkError: 'Connexion impossible. Vérifiez votre réseau.',
    notFoundTitle: 'Page introuvable',
    notFoundText: "Ce lien ne mène nulle part. Il est peut-être périmé ou mal copié.",
    home: "Retour à l'accueil",
  },
  status: {
    reservation: {
      pending: 'En attente de paiement',
      confirmed: 'Confirmée',
      cancelled: 'Annulée',
      expired: 'Expirée',
    },
    event: {
      draft: 'Brouillon',
      published: 'Publié',
      closed: 'Réservations fermées',
      cancelled: 'Annulé',
    },
  },
  event: {
    reserve: 'Je réserve ma place',
    see: "Voir l'événement",
    full: 'Complet',
    closed: 'Réservations fermées',
    shareWhatsapp: 'Partager sur WhatsApp',
    notFoundTitle: 'Événement introuvable',
    notFoundText: "Cet événement n'existe pas ou n'est plus accessible. Vérifiez le lien reçu.",
  },
  payment: {
    wero: 'Wero',
    paypal: 'PayPal',
    reminder:
      "Les virements entre proches ne doivent être utilisés que lorsque l'opération est éligible selon les conditions de Wero et de PayPal.",
  },
} as const

export const API_ERROR_MESSAGES: Record<string, string> = {
  rate_limited: 'Trop de tentatives. Patientez un moment avant de réessayer.',
  unauthenticated: 'Votre session a expiré. Reconnectez-vous.',
  bad_csrf: 'Session invalide. Rechargez la page.',
  bad_origin: 'Requête non autorisée.',
}
