import {
  flashNote,
  type PinballDocument,
} from '@/shared/document'
import { emptyBlob, readBlob, writeBlob, type SaveBlobV2 } from '@/shared/save-blob'
import type { KeptRecords } from '@/features/table'
import { latchCareer } from '@/features/records/model/challenge-rules'

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function emptyKept(): KeptRecords {
  const blob = emptyBlob()
  return { career: blob.career, history: blob.history, bestScore: blob.bestScore }
}

export function readSave(): KeptRecords {
  const { blob } = readBlob()
  if (!blob) return emptyKept()
  return { career: blob.career, history: blob.history, bestScore: blob.bestScore }
}

function writeThrough(doc: PinballDocument, blob: SaveBlobV2): void {
  if (writeBlob(blob)) return
  if (!doc.run.storageWarned) {
    doc.run.storageWarned = true
    flashNote(doc, '这台浏览器没能写下记录')
  }
}

export function persist(doc: PinballDocument): void {
  const raw = readBlob()
  // 磁盘上的数据读不懂或版本对不上时，不能用我们的新结构把它整份盖掉
  if (!raw.ok) {
    if (!doc.run.storageWarned) {
      doc.run.storageWarned = true
      flashNote(doc, '存档读不出来，拒绝覆盖旧记录')
    }
    return
  }
  const blob = raw.blob ?? emptyBlob()
  blob.bestScore = Math.max(doc.bestScore, doc.score)
  blob.career = { ...doc.career }
  blob.history = doc.history.map((entry) => ({ ...entry }))
  writeThrough(doc, blob)
}

export function commitSession(doc: PinballDocument, abandoned: boolean): void {
  if (!doc.run.launched || doc.run.committed) return
  const clean = !abandoned && doc.phase === 'gameover' && !doc.live.tilted
  if (clean) doc.career.cleanFinish = true
  if (doc.score > doc.bestScore) doc.bestScore = doc.score
  doc.history.unshift({
    id: makeId(),
    endedAt: Date.now(),
    score: doc.score,
    playMs: doc.run.playMs,
    abandoned,
    tilted: doc.live.tilted,
    bonusEntries: doc.live.bonusEntries,
    bankClears: doc.live.bankClears,
    cleanFinish: clean,
  })
  if (doc.history.length > 20) doc.history.length = 20
  doc.run.committed = true
  doc.run.storedScore = doc.score
  persist(doc)
}

export function syncRecords(doc: PinballDocument): void {
  const careerChanged = latchCareer(doc)
  const scoreChanged = doc.score !== doc.run.storedScore
  if (doc.score > doc.bestScore) doc.bestScore = doc.score
  if (!careerChanged && !scoreChanged) return
  doc.run.storedScore = doc.score
  persist(doc)
}

export function formatPlay(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}
