<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { flashNote, type Phase, type PinballDocument } from '@/shared/document'
import {
  listSlots,
  loadFromSlot,
  saveToSlot,
  type SlotMeta,
} from '@/features/saves/model/slot-store'

const props = defineProps<{ doc: PinballDocument }>()

const slots = ref<SlotMeta[]>([])

function refresh(): void {
  slots.value = listSlots()
}

onMounted(refresh)

const PHASE_LABEL: Record<Phase, string> = {
  ready: '待发射',
  playing: '进行中',
  paused: '已暂停',
  gameover: '已结束',
}

function formatTime(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => value.toString().padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function describe(meta: SlotMeta): string {
  if (!meta.occupied) return '空槽'
  if (meta.corrupt) return '存档损坏或版本对不上'
  const phase = meta.phase ? PHASE_LABEL[meta.phase] : ''
  const balls = meta.ballsLeft !== null ? ` · 剩 ${meta.ballsLeft} 球` : ''
  return `${formatTime(meta.savedAt)} · ${phase} · ${meta.score} 分${balls}`
}

function onSave(meta: SlotMeta): void {
  if (props.doc.phase === 'gameover') {
    flashNote(props.doc, '这一局已经结束，没有可存的局面')
    return
  }
  const result = saveToSlot(props.doc, meta.index)
  if (result === 'saved') {
    flashNote(props.doc, `当前这一局已存入槽 ${meta.index + 1}`)
  } else if (result === 'refused') {
    flashNote(props.doc, '旧存档读不懂，为保住它没有写入')
  } else {
    flashNote(props.doc, '这台浏览器没能写下存档')
  }
  refresh()
}

function onLoad(meta: SlotMeta): void {
  const result = loadFromSlot(props.doc, meta.index)
  if (result === 'loaded') {
    flashNote(props.doc, `槽 ${meta.index + 1} 的局面已读回`)
  } else if (result === 'empty') {
    flashNote(props.doc, `槽 ${meta.index + 1} 还是空的`)
  } else if (result === 'corrupt') {
    flashNote(props.doc, '存档损坏或版本对不上，当前这一局原样保留')
  } else {
    flashNote(props.doc, '旧存档读不懂，当前这一局原样保留')
  }
  refresh()
}
</script>

<template>
  <section class="slip" aria-label="存档槽">
    <header class="slip-head">
      <p class="eyebrow">快照</p>
      <h2>存档槽</h2>
    </header>
    <p class="slip-copy">存入的是当前局面的完整快照，读回只替换正在打的这一局；生涯徽章与对局记录不受影响。</p>
    <ul class="slot-list">
      <li v-for="meta in slots" :key="meta.index">
        <div class="slot-text">
          <strong>槽 {{ meta.index + 1 }}</strong>
          <span :class="{ 'slot-bad': meta.corrupt }">{{ describe(meta) }}</span>
        </div>
        <div class="slot-actions">
          <button
            type="button"
            class="slot-key"
            :disabled="doc.phase === 'gameover'"
            @click="onSave(meta)"
          >
            存入
          </button>
          <button
            type="button"
            class="slot-key"
            :disabled="!meta.occupied || meta.corrupt"
            @click="onLoad(meta)"
          >
            读回
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>
