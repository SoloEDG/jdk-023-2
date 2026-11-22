import { createServer } from 'vite'
import { createDocument } from '@/shared/document'
import { mountFresh } from '@/features/table/model/mechanism-rules'
import { readSave, persist, commitSession } from '@/features/records/model/history-store'
import {
  captureSnapshot,
  listSlots,
  loadFromSlot,
  saveToSlot,
  validateSnapshot,
} from '@/features/saves/model/slot-store'
import { readBlob, writeBlob, emptyBlob, SLOT_COUNT } from '@/shared/save-blob'
import { STORAGE_KEY } from '@/shared/ids'

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败: ${label}`)
  console.log(`  ✓ ${label}`)
}

function makeDoc(): ReturnType<typeof createDocument> {
  const doc = createDocument()
  mountFresh(doc, { career: doc.career, history: doc.history, bestScore: 0 })
  return doc
}

function makeLiveDoc(): ReturnType<typeof createDocument> {
  const doc = makeDoc()
  doc.phase = 'playing'
  doc.run.launched = true
  doc.score = 1234
  doc.ballsLeft = 2
  doc.ball.x = 201
  doc.ball.y = 333
  doc.ball.vx = -127.5
  doc.ball.vy = 488.25
  doc.ball.held = 'none'
  doc.nudge.warnings = 2
  doc.chain.count = 3
  doc.chain.remainMs = 1700
  doc.chain.bonusMs = 9000
  doc.chain.multiplier = 2
  doc.plunger.power = 0.6
  const drop = doc.mechanisms.find((m) => m.id === 'drop-a')
  if (drop) {
    drop.up = false
    drop.lamp = 1
  }
  const gate = doc.mechanisms.find((m) => m.id === 'ramp-gate')
  if (gate) gate.openMs = 5400
  doc.run.playMs = 81200
  return doc
}

async function main(): Promise<void> {
  // --- 1. 存取往返：球的位置/速度与全部局内状态一致 ---
  console.log('场景 1：快照存读往返，状态完全一致')
  const doc = makeLiveDoc()
  const saved = captureSnapshot(doc)
  assert(saveToSlot(doc, 0) === 'saved', '写入槽 1 成功')
  const metas = listSlots()
  assert(metas.length === SLOT_COUNT, '总是暴露三个槽')
  assert(metas[0].occupied && !metas[0].corrupt, '槽 1 显示为有效占用')
  assert(metas[1].occupied === false, '槽 2 仍为空')

  const fresh = makeDoc()
  assert(fresh.ball.x !== 201, '读档前是另一个局面')
  assert(loadFromSlot(fresh, 0) === 'loaded', '从槽 1 读回成功')
  assert(fresh.ball.x === 201 && fresh.ball.y === 333, '球位置一致')
  assert(fresh.ball.vx === -127.5 && fresh.ball.vy === 488.25, '球速度一致')
  assert(fresh.nudge.warnings === 2, '轻推次数一致')
  assert(fresh.ballsLeft === 2, '剩余球数一致')
  assert(fresh.chain.remainMs === 1700 && fresh.chain.bonusMs === 9000, '连锁/奖励剩余时间一致')
  assert(fresh.chain.multiplier === 2 && fresh.chain.count === 3, '连锁倍率与计数一致')
  assert(fresh.plunger.power === 0.6, '蓄力值一致')
  assert(fresh.score === 1234, '局内得分一致')
  assert(fresh.run.playMs === 81200, '本局用时一致')
  const restoredDrop = fresh.mechanisms.find((m) => m.id === 'drop-a')
  assert(restoredDrop?.up === false && restoredDrop?.lamp === 1, '落靶开合状态一致')
  const restoredGate = fresh.mechanisms.find((m) => m.id === 'ramp-gate')
  assert(restoredGate?.openMs === 5400, '闸门剩余开启时间一致')
  assert(fresh.gates.rampOpen === true, '坡道开合一致（奖励或闸门顶开）')
  assert(fresh.phase === 'playing', '游玩阶段一致')

  // --- 2. 读档只替换当前局，不碰生涯徽章 / 历史 / 最佳分 ---
  console.log('场景 2：读档不覆盖另一槽的生涯徽章')
  fresh.career.score10k = true
  fresh.career.bankTwice = true
  fresh.bestScore = 50000
  fresh.history.unshift({
    id: 'career-record',
    endedAt: 9,
    score: 50000,
    playMs: 1000,
    abandoned: false,
    tilted: false,
    bonusEntries: 0,
    bankClears: 0,
    cleanFinish: true,
  })
  const other = makeDoc()
  other.score = 777
  other.phase = 'playing'
  other.run.launched = true
  persist(fresh)
  assert(saveToSlot(other, 1) === 'saved', '另一局写入槽 2')
  assert(loadFromSlot(fresh, 1) === 'loaded', '槽 2 读回当前局')
  assert(fresh.score === 777, '当前局分数被槽 2 替换')
  assert(fresh.career.score10k === true && fresh.career.bankTwice === true, '生涯徽章原样保留')
  assert(fresh.bestScore === 50000, '最佳分原样保留')
  assert(fresh.history[0]?.id === 'career-record', '对局历史原样保留')
  const blob = readBlob().blob
  assert(blob?.career.score10k === true && blob.bestScore === 50000, '磁盘上的生涯数据未被槽位写入覆盖')

  // --- 3. 损坏快照：当前局原样保留，不写坏磁盘 ---
  console.log('场景 3：槽内快照损坏或格式不对，当前局原样保留')
  const corruptBlob = readBlob().blob ?? emptyBlob()
  corruptBlob.slots = corruptBlob.slots.slice()
  corruptBlob.slots[2] = { format: 999, phase: 'playing' }
  assert(writeBlob(corruptBlob), '在槽 3 放入格式对不上的快照')
  const guard = makeLiveDoc()
  const beforeX = guard.ball.x
  const beforeScore = guard.score
  const result = loadFromSlot(guard, 2)
  assert(result === 'corrupt', '损坏槽返回 corrupt')
  assert(guard.ball.x === beforeX && guard.score === beforeScore, '当前局一个字段都没被改动')
  const corruptMetas = listSlots()
  assert(corruptMetas[2].corrupt && corruptMetas[2].occupied, '槽 3 标记为损坏但不影响其他槽')
  assert(corruptMetas[0].corrupt === false && corruptMetas[1].corrupt === false, '槽 1/槽 2 仍然有效')

  // JSON 整个坏掉
  localStorage.setItem(STORAGE_KEY, '{不是合法 JSON')
  const untouched = makeLiveDoc()
  const untouchedX = untouched.ball.x
  assert(loadFromSlot(untouched, 0) === 'unavailable', '整份存档读不懂时返回 unavailable')
  assert(untouched.ball.x === untouchedX, '当前局原样保留')
  assert(saveToSlot(untouched, 0) === 'refused', '拒绝把新快照盖到读不懂的旧数据上')
  assert(localStorage.getItem(STORAGE_KEY) === '{不是合法 JSON', '磁盘上的坏数据原封不动')
  persist(untouched)
  assert(localStorage.getItem(STORAGE_KEY) === '{不是合法 JSON', '记录持久化同样拒绝覆盖坏数据')

  // --- 4. 旧快照缺少后来新增的机关：缺的按关闭处理，不整份作废 ---
  console.log('场景 4：旧版快照缺少机关，按默认关闭态补齐')
  const oldSnap = captureSnapshot(makeLiveDoc())
  // 模拟旧版本：移除一个机关（相当于后来才加入的新机关）
  const trimmed = { ...oldSnap, mechanisms: oldSnap.mechanisms.filter((m) => m.id !== 'drop-b') }
  assert(validateSnapshot(trimmed), '缺机关的旧快照结构仍然合法')
  const legacyBlob = emptyBlob()
  legacyBlob.slots[0] = trimmed
  assert(writeBlob(legacyBlob), '写入带缺失机关的旧快照')
  const legacyDoc = makeDoc()
  assert(loadFromSlot(legacyDoc, 0) === 'loaded', '旧快照可以接着玩，没有整份作废')
  const added = legacyDoc.mechanisms.find((m) => m.id === 'drop-b')
  assert(Boolean(added), '缺失机关被补齐')
  assert(added?.up === true, '补齐的落靶按关闭（立起、挡球）处理')
  assert(added?.openMs === 0 && added?.lit === false && added?.cooldownMs === 0, '补齐机关为干净的默认态')
  const keptDrop = legacyDoc.mechanisms.find((m) => m.id === 'drop-a')
  assert(keptDrop?.up === false, '旧快照里已有的机关状态仍然生效')
  assert(legacyDoc.ball.x === 201, '旧快照的球状态照常恢复')

  // --- 5. 槽间互相独立 ---
  console.log('场景 5：三个槽互相独立')
  const clean = emptyBlob()
  assert(writeBlob(clean), '清空磁盘准备独立槽测试')
  const d1 = makeLiveDoc()
  d1.score = 111
  const d2 = makeLiveDoc()
  d2.score = 222
  d2.nudge.warnings = 1
  const d3 = makeLiveDoc()
  d3.score = 333
  assert(saveToSlot(d1, 0) === 'saved', '槽 1 写入')
  assert(saveToSlot(d2, 1) === 'saved', '槽 2 写入')
  assert(saveToSlot(d3, 2) === 'saved', '槽 3 写入')
  const target = makeDoc()
  assert(loadFromSlot(target, 1) === 'loaded' && target.score === 222, '读槽 2 得到槽 2 的局')
  assert(target.nudge.warnings === 1, '槽 2 的轻推次数独立')
  assert(loadFromSlot(target, 0) === 'loaded' && target.score === 111, '再读槽 1 得到槽 1 的局')
  assert(loadFromSlot(target, 2) === 'loaded' && target.score === 333, '读槽 3 得到槽 3 的局')

  // --- 6. v1 旧总存档迁移：生涯保留，槽位为空 ---
  console.log('场景 6：v1 存档迁移')
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      bestScore: 8800,
      career: { score10k: false, bonusOnce: true, bankTwice: false, cleanFinish: false },
      history: [{ id: 'h1', endedAt: 1, score: 8800, playMs: 5000, abandoned: false, tilted: false, bonusEntries: 1, bankClears: 0, cleanFinish: false }],
    }),
  )
  const kept = readSave()
  assert(kept.bestScore === 8800 && kept.history.length === 1 && kept.career.bonusOnce === true, 'v1 生涯与历史迁移成功')
  const migrated = listSlots()
  assert(migrated.every((m) => !m.occupied && !m.corrupt), '迁移后三个槽均为空且未损坏')
  assert(saveToSlot(makeLiveDoc(), 0) === 'saved', '迁移后可以正常写槽')
  const afterMigrate = readBlob().blob
  assert(afterMigrate?.bestScore === 8800 && afterMigrate.career.bonusOnce === true, '写槽没有冲掉迁移来的生涯数据')

  // --- 7. 结束的局不允许存；提交历史不影响槽位 ---
  console.log('场景 7：结束局与记录提交')
  const over = makeDoc()
  over.phase = 'gameover'
  over.run.launched = true
  commitSession(over, false)
  const slotsAfterCommit = listSlots()
  assert(slotsAfterCommit[0].occupied === true, '提交对局记录不会清掉已有槽位')

  console.log('\n全部断言通过')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
