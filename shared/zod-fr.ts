import { z } from 'zod'

z.config({
  ...z.locales.fr(),
  customError: (issue) => {
    switch (issue.code) {
      case 'invalid_type':
        return issue.input === undefined || issue.input === null
          ? 'Ce champ est obligatoire'
          : 'Valeur invalide'
      case 'too_small': {
        const min = Number(issue.minimum)
        if (issue.origin === 'string') {
          return min <= 1 ? 'Ce champ est obligatoire' : `Au moins ${min} caractères`
        }
        return `Valeur minimale : ${min}`
      }
      case 'too_big': {
        const max = Number(issue.maximum)
        return issue.origin === 'string' ? `${max} caractères maximum` : `Valeur maximale : ${max}`
      }
      case 'invalid_format':
        return issue.format === 'email' ? 'Adresse e-mail invalide' : 'Format invalide'
      case 'invalid_value':
        return 'Valeur non autorisée'
      default:
        return undefined
    }
  },
})
