// Usage : npm run admin:hash -- "votre mot de passe"
// Génère la valeur du secret ADMIN_PASSWORD_HASH (PBKDF2-SHA256, 100 000 itérations : maximum accepté par Workers).
import { pbkdf2Sync, randomBytes } from 'node:crypto'

const password = process.argv[2]
if (!password) {
  console.error('Usage : npm run admin:hash -- "votre mot de passe"')
  process.exit(1)
}
if (password.length < 12) {
  console.error('Mot de passe trop court : 12 caractères minimum.')
  process.exit(1)
}
const iterations = 100_000
const salt = randomBytes(16)
const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256')
console.log(`pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`)
