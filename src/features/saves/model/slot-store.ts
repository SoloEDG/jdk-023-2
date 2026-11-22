import {
  type BallState,
  type ChainState,
  type FeedItem,
  type FlipperState,
  type HoldKind,
  type LiveGoals,
  type MechanismKind,
  type MechanismState,
  type NoteState,
  type NudgeState,
  type Phase,
  type PinballDocument,
  type PlungerState,
  type RunMeta,
} from '@/shared/document'
import { emptyBlob, readBlob, SLOT_COUNT, writeBlob } from '@/shared/save-blob'
import { createMechanisms, publishGates } from '@/features/table/model/mechanism-rules'

/** 槽内快照自己的格式号，与整份 blob 的版本号分开演进 */
const SNAPSHOT_FORMAT = 1

const PHASES: readonly Phase[] = ['ready', 'playing', 'paused', 'gameover']
const HOLDS: readonly HoldKind[] = ['none', 'plunger', 'hole', 'ramp', 'scoop']
const MECHANISM_KINDS: readonly MechanismKind[] = [
  'bumper',
  'sling',
  'drop',
  'spinner',
  'gate',
  'hole',
  'lane',
  'ramp',
  'scoop',
]

export interface SlotSnapshot {
  format: number
  savedAt: number
  phase: Phase
  phaseBeforePause: Phase | null
  score: number
  ballsLeft: number
  ball: BallState
  flippers: { left: FlipperState; right: FlipperState }
  plunger: PlungerState
  nudge: NudgeState
  mechanisms: MechanismState[]
  gates: { rampOpen: boolean }
  chain: ChainState
  live: LiveGoals
  feed: FeedItem[]
  feedSeq: number
  note: NoteState
  run: RunMeta
}

export interface SlotMeta {
  index: number
  occupied: boolean
  corrupt: boolean
  savedAt: number
  phase: Phase | null
  score: number | null
  ballsLeft: number | null
}

export type SlotWriteResult = 'saved' | 'unavailable' | 'refused' | 'error'
export type SlotLoadResult = 'loaded' | 'empty' | 'corrupt' | 'unavailable'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return isString(value) && (allowed as readonly string[]).includes(value)
}

function asPhaseOrNull(value: unknown): Phase | null {
  return oneOf(value, PHASES) ? value : null
}

function asHoldOrNull(value: unknown): HoldKind | null {
  return oneOf(value, HOLDS) ? value : null
}

function asKindOrNull(value: unknown): MechanismKind | null {
  return oneOf(value, MECHANISM_KINDS) ? value : null
}

/** 捕获当前局的完整快照。生涯徽章、历史与最佳分不属于“这一局”，刻意不进槽 */
export function captureSnapshot(doc: PinballDocument): SlotSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    savedAt: Date.now(),
    phase: doc.phase,
    phaseBeforePause: doc.phaseBeforePause,
    score: doc.score,
    ballsLeft: doc.ballsLeft,
    ball: { ...doc.ball },
    flippers: {
      left: { ...doc.flippers.left },
      right: { ...doc.flippers.right },
    },
    plunger: { ...doc.plunger },
    nudge: { ...doc.nudge },
    mechanisms: doc.mechanisms.map((item) => ({ ...item })),
    gates: { ...doc.gates },
    chain: { ...doc.chain },
    live: { ...doc.live },
    feed: doc.feed.map((item) => ({ ...item })),
    feedSeq: doc.feedSeq,
    note: { ...doc.note },
    run: { ...doc.run, storageWarned: false },
  }
}

function validateBall(value: unknown): value is BallState {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.vx) &&
    isFiniteNumber(value.vy) &&
    isFiniteNumber(value.radius) &&
    value.radius > 0 &&
    asHoldOrNull(value.held) !== null &&
    isFiniteNumber(value.holdMs) &&
    isFiniteNumber(value.rideMs) &&
    isFiniteNumber(value.rideDur) &&
    isFiniteNumber(value.idleMs)
  )
}

function validateFlipper(value: unknown): value is FlipperState {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.angle) &&
    isFiniteNumber(value.omega) &&
    isBoolean(value.held)
  )
}

function validatePlunger(value: unknown): value is PlungerState {
  return isObject(value) && isFiniteNumber(value.power) && isBoolean(value.charging)
}

function validateNudge(value: unknown): value is NudgeState {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.warnings) &&
    isBoolean(value.tilted) &&
    isFiniteNumber(value.flashMs) &&
    (value.flashDir === -1 || value.flashDir === 0 || value.flashDir === 1)
  )
}

function validateMechanism(value: unknown): value is MechanismState {
  if (!isObject(value)) return false
  return (
    isString(value.id) &&
    asKindOrNull(value.kind) !== null &&
    isString(value.label) &&
    isFiniteNumber(value.cooldownMs) &&
    isFiniteNumber(value.lamp) &&
    isBoolean(value.up) &&
    isFiniteNumber(value.openMs) &&
    isBoolean(value.lit) &&
    isFiniteNumber(value.spin) &&
    isFiniteNumber(value.spinOmega)
  )
}

function validateChain(value: unknown): value is ChainState {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.count) &&
    (value.lastZone === null || isString(value.lastZone)) &&
    isFiniteNumber(value.remainMs) &&
    isFiniteNumber(value.bonusMs) &&
    isFiniteNumber(value.multiplier)
  )
}

function validateLive(value: unknown): value is LiveGoals {
  if (!isObject(value)) return false
  return (
    isFiniteNumber(value.bonusEntries) &&
    isFiniteNumber(value.bankClears) &&
    isBoolean(value.tilted) &&
    isBoolean(value.bankPending) &&
    isFiniteNumber(value.bankResetMs)
  )
}

function validateFeed(value: unknown): value is FeedItem[] {
  if (!Array.isArray(value)) return false
  return value.every(
    (item) =>
      isObject(item) &&
      isFiniteNumber(item.uid) &&
      isString(item.text) &&
      isFiniteNumber(item.points),
  )
}

function validateNote(value: unknown): value is NoteState {
  return isObject(value) && isString(value.text) && isFiniteNumber(value.ms)
}

function validateRun(value: unknown): value is RunMeta {
  if (!isObject(value)) return false
  return (
    isBoolean(value.launched) &&
    isBoolean(value.committed) &&
    isFiniteNumber(value.playMs) &&
    isFiniteNumber(value.storedScore) &&
    isBoolean(value.storageWarned)
  )
}

/**
 * 严格校验整份快照。任何顶层关键字段缺失或类型不对都判损坏，
 * 让调用方原样保留当前局，而不是半读半用。
 */
export function validateSnapshot(value: unknown): value is SlotSnapshot {
  if (!isObject(value)) return false
  return (
    value.format === SNAPSHOT_FORMAT &&
    isFiniteNumber(value.savedAt) &&
    asPhaseOrNull(value.phase) !== null &&
    (value.phaseBeforePause === null || asPhaseOrNull(value.phaseBeforePause) !== null) &&
    isFiniteNumber(value.score) &&
    isFiniteNumber(value.ballsLeft) &&
    validateBall(value.ball) &&
    isObject(value.flippers) &&
    validateFlipper(value.flippers.left) &&
    validateFlipper(value.flippers.right) &&
    validatePlunger(value.plunger) &&
    validateNudge(value.nudge) &&
    Array.isArray(value.mechanisms) &&
    value.mechanisms.every(validateMechanism) &&
    isObject(value.gates) &&
    isBoolean(value.gates.rampOpen) &&
    validateChain(value.chain) &&
    validateLive(value.live) &&
    validateFeed(value.feed) &&
    isFiniteNumber(value.feedSeq) &&
    validateNote(value.note) &&
    validateRun(value.run)
  )
}

/**
 * 把旧快照里的机关与当前台面定义对齐：
 * 旧快照没有的机关按默认关闭态补齐；已废弃的旧机关被忽略，不影响其余状态。
 */
function reconcileMechanisms(stored: MechanismState[]): MechanismState[] {
  const byId = new Map(stored.map((item) => [item.id, item]))
  return createMechanisms().map((fresh) => {
    const old = byId.get(fresh.id)
    if (!old) return fresh
    return {
      ...fresh,
      cooldownMs: Math.max(0, old.cooldownMs),
      lamp: old.lamp,
      up: old.up,
      openMs: Math.max(0, old.openMs),
      lit: old.lit,
      spin: old.spin,
      spinOmega: old.spinOmega,
    }
  })
}

export function saveToSlot(doc: PinballDocument, index: number): SlotWriteResult {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return 'error'
  const raw = readBlob()
  // 磁盘读不出来或版本对不上时，保住原有数据，绝不拿新 blob 整份盖掉
  if (!raw.ok) return 'refused'
  const blob = raw.blob ?? emptyBlob()
  const slots = blob.slots.slice()
  while (slots.length < SLOT_COUNT) slots.push(null)
  slots[index] = captureSnapshot(doc)
  blob.slots = slots
  return writeBlob(blob) ? 'saved' : 'unavailable'
}

export function loadFromSlot(doc: PinballDocument, index: number): SlotLoadResult {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) return 'corrupt'
  const raw = readBlob()
  if (!raw.ok) return 'unavailable'
  const entry = raw.blob?.slots[index] ?? null
  if (!entry) return 'empty'
  if (!validateSnapshot(entry)) return 'corrupt'
  restoreSnapshot(doc, entry)
  return 'loaded'
}

/**
 * 只替换局内字段；career / history / bestScore 是槽间共享的生涯数据，
 * 读档时原样保留，不会被另一个槽的内容覆盖。
 */
function restoreSnapshot(doc: PinballDocument, snap: SlotSnapshot): void {
  const mechanisms = reconcileMechanisms(snap.mechanisms)
  doc.phase = snap.phase
  doc.phaseBeforePause = snap.phaseBeforePause
  doc.score = snap.score
  doc.ballsLeft = snap.ballsLeft
  doc.ball = { ...snap.ball }
  doc.flippers = {
    left: { ...snap.flippers.left },
    right: { ...snap.flippers.right },
  }
  doc.plunger = { ...snap.plunger }
  doc.nudge = { ...snap.nudge }
  doc.mechanisms = mechanisms
  doc.gates = { ...snap.gates }
  doc.chain = { ...snap.chain }
  doc.live = { ...snap.live }
  doc.feed = snap.feed.map((item) => ({ ...item }))
  doc.feedSeq = snap.feedSeq
  doc.note = { ...snap.note }
  doc.run = { ...snap.run, storageWarned: false }
  doc.signals = { drain: false }
  // 闸门灯与坡道开合以机关/连锁的当前值为准，重新发布一次避免显示漂移
  publishGates(doc)
}

export function listSlots(): SlotMeta[] {
  const raw = readBlob()
  const metas: SlotMeta[] = []
  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const entry = raw.ok ? (raw.blob?.slots[index] ?? null) : null
    if (!entry) {
      metas.push({ index, occupied: false, corrupt: !raw.ok, savedAt: 0, phase: null, score: null, ballsLeft: null })
      continue
    }
    if (!validateSnapshot(entry)) {
      metas.push({ index, occupied: true, corrupt: true, savedAt: 0, phase: null, score: null, ballsLeft: null })
      continue
    }
    metas.push({
      index,
      occupied: true,
      corrupt: false,
      savedAt: entry.savedAt,
      phase: entry.phase,
      score: entry.score,
      ballsLeft: entry.ballsLeft,
    })
  }
  return metas
}
