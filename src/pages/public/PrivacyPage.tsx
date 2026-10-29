import type { ReactNode } from 'react'
import { useDocumentTitle } from '../../hooks/usePage'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="space-y-2 leading-relaxed text-ink-soft">{children}</div>
    </section>
  )
}

export default function PrivacyPage() {
  useDocumentTitle('Confidentialité')
  return (
    <article className="mx-auto max-w-2xl space-y-8 px-4 pb-8 sm:px-6">
      <header>
        <h1 className="text-3xl font-extrabold sm:text-4xl">Politique de confidentialité</h1>
        <p className="mt-2 text-ink-soft">Nahe? est un petit site privé entre amis. Nous collectons le strict minimum, et voici exactement quoi.</p>
      </header>

      <Section title="Données collectées">
        <p>Lorsque vous réservez, nous enregistrons :</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>votre prénom et votre nom ;</li>
          <li>votre adresse e-mail ;</li>
          <li>votre numéro de téléphone, uniquement si vous le renseignez (facultatif) ;</li>
          <li>le nombre de places réservées et le montant correspondant ;</li>
          <li>le moyen de paiement choisi (Wero ou PayPal) ;</li>
          <li>pour chaque place confirmée, un billet : un identifiant signé, son état (valide, utilisé, annulé) et l'heure d'entrée le cas échéant.</li>
        </ul>
      </Section>

      <Section title="Pourquoi ces données">
        <p>Elles servent uniquement à organiser l'événement : savoir qui vient, combien de places sont prises et vérifier les paiements.</p>
        <p>
          Nous n'utilisons aucune API de paiement : vous payez directement l'organisateur via Wero ou PayPal, et il vérifie lui-même la réception.
          Aucune donnée bancaire ne transite par ce site.
        </p>
        <p>
          Une fois votre paiement confirmé, nous vous envoyons <strong>un seul e-mail</strong> contenant vos billets (un QR code par place).
          Nous n'envoyons aucun autre e-mail : ni promotion, ni rappel, ni newsletter.
        </p>
      </Section>

      <Section title="Vos billets et QR codes">
        <p>
          Le QR code de chaque billet ne contient <strong>aucune donnée personnelle</strong> : seulement un identifiant aléatoire signé,
          qui n'a de sens que pour l'organisateur lors du contrôle à l'entrée. Un billet ne permet qu'une seule entrée.
        </p>
        <p>
          Les billets sont conservés avec la réservation : 6 mois après l'événement, ils sont rendus inutilisables.
        </p>
      </Section>

      <Section title="Votre lien de suivi">
        <p>
          Après réservation, vous recevez un lien de suivi unique. Il joue le rôle de clé : toute personne qui le possède peut consulter votre réservation.
          Gardez-le pour vous.
        </p>
      </Section>

      <Section title="Durée de conservation">
        <p>
          Vos données sont conservées jusqu'à 6 mois après la date de l'événement. Elles sont ensuite anonymisées automatiquement :
          nom, e-mail et téléphone sont effacés, le lien de suivi cesse de fonctionner et les billets sont rendus inutilisables.
        </p>
      </Section>

      <Section title="Cookies et suivi">
        <p>
          Ce site n'utilise ni cookie publicitaire, ni outil d'analyse, ni traceur. Le seul cookie existant sert à la session de l'organisateur
          lorsqu'il se connecte ; il n'est pas déposé pour les invités.
        </p>
      </Section>

      <Section title="Qui voit vos données">
        <p>
          Seul l'organisateur y a accès. Les pages publiques n'affichent jamais le nom ou l'e-mail des participants, seulement le nombre de places restantes.
        </p>
      </Section>

      <Section title="Hébergement et sous-traitants">
        <p>Le site est hébergé par Cloudflare (Workers et base de données D1), qui traite les données techniquement pour le compte de l'organisateur.</p>
        <p>
          L'e-mail contenant vos billets est transmis par <strong>Brevo</strong> (hébergé dans l'Union européenne), qui agit comme sous-traitant
          pour la seule transmission de cet e-mail (votre nom, votre adresse e-mail et le contenu des billets).
        </p>
      </Section>

      <Section title="Vos droits">
        <p>
          Vous pouvez demander à l'organisateur d'accéder à vos données, de les corriger ou de les supprimer à tout moment :
          il dispose des outils pour le faire (annulation de réservation, régénération ou invalidation du lien de suivi).
        </p>
      </Section>
    </article>
  )
}
