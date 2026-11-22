export {
  captureSnapshot,
  listSlots,
  loadFromSlot,
  saveToSlot,
  validateSnapshot,
} from '@/features/saves/model/slot-store'
export type { SlotMeta, SlotSnapshot, SlotLoadResult, SlotWriteResult } from '@/features/saves/model/slot-store'
export { default as SaveSlotPanel } from '@/features/saves/ui/SaveSlotPanel.vue'
