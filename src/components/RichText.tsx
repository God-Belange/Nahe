import { parseBold } from '../../shared/rich-text'

/** Affiche un texte en mettant en gras ce qui est entouré de `**`. Les retours à la ligne sont à gérer par le parent. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {parseBold(text).map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>))}
    </>
  )
}
