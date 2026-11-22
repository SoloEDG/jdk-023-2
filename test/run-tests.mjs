import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

class MemoryStorage {
  #map = new Map()

  get length() {
    return this.#map.size
  }

  clear() {
    this.#map.clear()
  }

  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null
  }

  key(index) {
    return [...this.#map.keys()][index] ?? null
  }

  removeItem(key) {
    this.#map.delete(key)
  }

  setItem(key, value) {
    this.#map.set(key, String(value))
  }
}

globalThis.localStorage = new MemoryStorage()

const root = process.cwd()
const outfile = path.join(root, 'node_modules', '.tmp-slot-test.mjs')

try {
  await build({
    entryPoints: [path.join(root, 'test', 'slot-store.test.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    alias: { '@': path.join(root, 'src') },
    logLevel: 'silent',
  })
  await import(pathToFileURL(outfile).href)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await rm(outfile, { force: true })
}
