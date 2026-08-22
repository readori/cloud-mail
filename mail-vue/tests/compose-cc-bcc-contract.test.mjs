import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const writerPath = new URL('../src/layout/write/index.vue', import.meta.url)
const draftPath = new URL('../src/views/draft/index.vue', import.meta.url)
const contentPath = new URL('../src/views/content/index.vue', import.meta.url)

test('web compose exposes cc/bcc and carries them in draft state', async () => {
  const source = await readFile(writerPath, 'utf8')
  assert.match(source, /v-model="form\.cc"/)
  assert.match(source, /v-model="form\.bcc"/)
  assert.match(source, /cc:\s*\[\]/)
  assert.match(source, /bcc:\s*\[\]/)
  assert.match(source, /form\.cc\s*=\s*\[\]/)
  assert.match(source, /form\.bcc\s*=\s*\[\]/)
  assert.match(source, /form\.cc\.length > 0/)
  assert.match(source, /form\.bcc\.length > 0/)
})

test('draft deletion logic treats cc/bcc-only drafts as non-empty', async () => {
  const source = await readFile(draftPath, 'utf8')
  assert.match(source, /draft\.cc\?\.length > 0/)
  assert.match(source, /draft\.bcc\?\.length > 0/)
})

test('message detail renders cc/bcc when present', async () => {
  const source = await readFile(contentPath, 'utf8')
  assert.match(source, /hasRecipients\(email\.cc\)/)
  assert.match(source, /hasRecipients\(email\.bcc\)/)
  assert.match(source, /formateReceive\(email\.cc\)/)
  assert.match(source, /formateReceive\(email\.bcc\)/)
})
