import { STORAGE_KEY } from '@/shared/ids'
import { defaultCareer, type CareerState, type HistoryEntry } from '@/shared/document'

export const SAVE_VERSION = 2
export const SLOT_COUNT = 3

/**
 * 磁盘上的总存档。生涯徽章、历史对局与三个局内快照槽互相独立：
 * 写某个槽位时只会替换 slots 中的对应下标，其余槽位与生涯记录原样保留。
 */
export interface SaveBlobV2 {
  version: typeof SAVE_VERSION
  bestScore: number
  career: CareerState
  history: HistoryEntry[]
  slots: (unknown | null)[]
}

export interface RawBin {
  /** false 表示磁盘内容读不出来或版本对不上，调用方不得覆写这份数据 */
  ok: boolean
  /** null 表示浏览器没有存储能力，或该键本来就是空的 */
  blob: SaveBlobV2 | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function emptyBlob(): SaveBlobV2 {
  return {
    version: SAVE_VERSION,
    bestScore: 0,
    career: defaultCareer(),
    history: [],
    slots: Array.from({ length: SLOT_COUNT }, () => null),
  }
}

function sanitizeCareer(value: unknown): CareerState {
  const career = defaultCareer()
  if (!isObject(value)) return career
  career.score10k = value.score10k === true
  career.bonusOnce = value.bonusOnce === true
  career.bankTwice = value.bankTwice === true
  career.cleanFinish = value.cleanFinish === true
  return career
}

function sanitizeEntry(value: unknown): HistoryEntry | null {
  if (!isObject(value)) return null
  if (typeof value.id !== 'string' || typeof value.score !== 'number' || !Number.isFinite(value.score)) return null
  return {
    id: value.id,
    endedAt: typeof value.endedAt === 'number' ? value.endedAt : 0,
    score: value.score,
    playMs: typeof value.playMs === 'number' ? value.playMs : 0,
    abandoned: value.abandoned === true,
    tilted: value.tilted === true,
    bonusEntries: typeof value.bonusEntries === 'number' ? value.bonusEntries : 0,
    bankClears: typeof value.bankClears === 'number' ? value.bankClears : 0,
    cleanFinish: value.cleanFinish === true,
  }
}

function sanitizeHistory(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.map(sanitizeEntry).filter((item): item is HistoryEntry => item !== null)
}

function sanitizeSlots(value: unknown): (unknown | null)[] {
  const raw = Array.isArray(value) ? value : []
  const slots: (unknown | null)[] = []
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const entry = raw[index]
    slots[index] = entry === undefined ? null : entry
  }
  return slots
}

function migrateV1(parsed: Record<string, unknown>): SaveBlobV2 {
  return {
    ...emptyBlob(),
    bestScore:
      typeof parsed.bestScore === 'number' && parsed.bestScore > 0 ? parsed.bestScore : 0,
    career: sanitizeCareer(parsed.career),
    history: sanitizeHistory(parsed.history),
  }
}

export function readBlob(): RawBin {
  const bin = storage()
  if (!bin) return { ok: true, blob: null }
  let text: string | null
  try {
    text = bin.getItem(STORAGE_KEY)
  } catch {
    return { ok: false, blob: null }
  }
  if (!text) return { ok: true, blob: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // JSON 损坏：保留磁盘原文，绝不覆写
    return { ok: false, blob: null }
  }
  if (!isObject(parsed)) return { ok: false, blob: null }
  if (parsed.version === 1) return { ok: true, blob: migrateV1(parsed) }
  if (parsed.version !== SAVE_VERSION) return { ok: false, blob: null }
  return {
    ok: true,
    blob: {
      version: SAVE_VERSION,
      bestScore:
        typeof parsed.bestScore === 'number' && parsed.bestScore > 0 ? parsed.bestScore : 0,
      career: sanitizeCareer(parsed.career),
      history: sanitizeHistory(parsed.history),
      slots: sanitizeSlots(parsed.slots),
    },
  }
}

export function writeBlob(blob: SaveBlobV2): boolean {
  const bin = storage()
  if (!bin) return false
  try {
    bin.setItem(STORAGE_KEY, JSON.stringify(blob))
    return true
  } catch {
    return false
  }
}
