import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import test from 'node:test'

const composePath = new URL('../src/layout/write/index.vue', import.meta.url)
const draftPath = new URL('../src/views/draft/index.vue', import.meta.url)
const contentPath = new URL('../src/views/content/index.vue', import.meta.url)
const workerPath = new URL('../../mail-worker/src/service/email-service.js', import.meta.url)

const read = path => readFile(path, 'utf8')

test('web compose exposes cc/bcc and carries them in draft state', async () => {
  const source = await read(composePath)
  assert.match(source, /v-model="form\.cc"/)
  assert.match(source, /v-model="form\.bcc"/)
  assert.match(source, /cc:\s*\[\]/)
  assert.match(source, /bcc:\s*\[\]/)
  assert.match(source, /toDraftRecipientList\(draft\.cc\)/)
  assert.match(source, /toDraftRecipientList\(draft\.bcc\)/)
  assert.match(source, /form\.cc\.length > 0/)
  assert.match(source, /form\.bcc\.length > 0/)
})

test('draft deletion logic treats cc/bcc-only drafts as non-empty', async () => {
  const source = await read(draftPath)
  assert.match(source, /draft\.cc\?\.length > 0/)
  assert.match(source, /draft\.bcc\?\.length > 0/)
})

test('message detail renders cc/bcc when present', async () => {
  const source = await read(contentPath)
  assert.match(source, /hasRecipients\(email\.cc\)/)
  assert.match(source, /hasRecipients\(email\.bcc\)/)
})

test('worker normalizes and sends cc/bcc to providers', async () => {
  const source = await read(workerPath)
  assert.match(source, /normalizeEmailList\(params\.cc/)
  assert.match(source, /normalizeEmailList\(params\.bcc/)
  assert.match(source, /sendForm\.cc = \[\.\.\.params\.cc\]/)
  assert.match(source, /sendForm\.bcc = \[\.\.\.params\.bcc\]/)
})
