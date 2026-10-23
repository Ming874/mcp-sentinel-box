// Copies the security profiles and the semantic-feedback mapping from the repo
// root into src/data so the site always shows what the sandbox actually enforces.
//   node scripts/sync-data.mjs          copy
//   node scripts/sync-data.mjs --check  fail if src/data is out of date
// The copies are committed because Zeabur builds website/ on its own.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const out = join(here, '..', 'src', 'data')

const sources = {
  'profile-strict.json': join(repo, 'profiles', 'strict.json'),
  'profile-web.json': join(repo, 'profiles', 'web.json'),
  'profile-datascience.json': join(repo, 'profiles', 'datascience.json'),
  'syscall-feedback.json': join(repo, 'mappings', 'syscall_feedback.json'),
}

const check = process.argv.includes('--check')
let stale = 0

for (const [name, src] of Object.entries(sources)) {
  const dest = join(out, name)
  if (!existsSync(src)) {
    // Building website/ alone (e.g. Zeabur with a root directory): trust the committed copy.
    if (check) continue
    throw new Error(`missing source ${src}`)
  }
  const content = JSON.stringify(JSON.parse(readFileSync(src, 'utf8')), null, 2) + '\n'
  const current = existsSync(dest) ? readFileSync(dest, 'utf8') : ''
  if (current === content) continue
  if (check) {
    console.error(`[sync-data] ${name} is out of date with ${src}; run npm run sync-data`)
    stale++
  } else {
    writeFileSync(dest, content)
    console.log(`[sync-data] wrote ${name}`)
  }
}

if (stale) process.exit(1)
