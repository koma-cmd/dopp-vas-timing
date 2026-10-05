<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import draggable from 'vuedraggable';
import * as Tone from 'tone';
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

// =====================================================
// ■ 1. パレット定義
// =====================================================
const soundPalette = ref([
  { sound: 'A', label: 'Sound A', color: '#555555' },
  { sound: 'B', label: 'Sound B', color: '#555555' },
  { sound: 'C', label: 'Sound C', color: '#555555' },
  { sound: 'D', label: 'Sound D', color: '#555555' },
  { sound: 'E', label: 'Sound E', color: '#555555' },
  { sound: 'F', label: 'Sound F', color: '#555555' },
  { sound: 'G', label: 'Sound G', color: '#555555' },
  { sound: 'H', label: 'Sound H', color: '#555555' },
]);

// =====================================================
// ■ 2. シーケンサー初期データ
// =====================================================
const noteBlocks = ref([
  { id: 1, sound: 'A', color: '#555555', isPlaying: false },
  { id: 2, sound: 'B', color: '#555555', isPlaying: false },
  { id: 3, sound: 'C', color: '#555555', isPlaying: false },
  { id: 4, sound: 'D', color: '#555555', isPlaying: false },
  { id: 5, sound: 'E', color: '#555555', isPlaying: false },
  { id: 6, sound: 'F', color: '#555555', isPlaying: false },
  { id: 7, sound: 'G', color: '#555555', isPlaying: false },
  { id: 8, sound: 'H', color: '#555555', isPlaying: false },
]);

// 🔧 修正: nextId を ref にしてリアクティブ管理 → Undo時のID重複を防ぐ
const nextId = ref(9);

const isLoaded = ref(false);

// =====================================================
// ■ 3. Tone.Players 準備
// =====================================================
const players = new Tone.Players({
  "A": "sounds/frag_A2.wav",
  "B": "sounds/frag_B2.wav",
  "C": "sounds/frag_C2.wav",
  "D": "sounds/frag_D2.wav",
  "E": "sounds/frag_E2.wav",
  "F": "sounds/frag_F2.wav",
  "G": "sounds/frag_G2.wav",
  "H": "sounds/frag_H2.wav",
}, {
  onload: () => {
    isLoaded.value = true;
    console.log("音源の読み込み完了！");
  }
}).toDestination();

// =====================================================
// ■ 4. パレットからの複製（clone）
// 🔧 修正: パレットからの追加もUndo対象にするため、
//          cloneSound では履歴を積まず、
//          draggable の @add イベントで pushHistory する
// =====================================================
const cloneSound = (origin) => {
  return {
    ...origin,
    id: nextId.value++,
    isPlaying: false,
  };
};

// =====================================================
// ■ Undo / Redo
// =====================================================
const undoStack = ref([]);
const redoStack = ref([]);
const MAX_HISTORY = 50;

const snapshotState = () => ({
  noteBlocks: noteBlocks.value.map(b => ({
    id: b.id,
    sound: b.sound,
    color: b.color,
    isPlaying: false,
  })),
  selectionStartId: selectionStartId.value,
  selectionEndId: selectionEndId.value,
  awaitingEnd: awaitingEnd.value,
  nextId: nextId.value,  // 🔧 修正: ref の .value を保存
});

const restoreState = (s) => {
  noteBlocks.value = s.noteBlocks.map(b => ({ ...b, isPlaying: false }));
  selectionStartId.value = s.selectionStartId;
  selectionEndId.value = s.selectionEndId;
  awaitingEnd.value = s.awaitingEnd;
  nextId.value = s.nextId;  // 🔧 修正: ref の .value に復元
};

const pushHistory = () => {
  undoStack.value.push(snapshotState());
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
};

const undo = () => {
  if (undoStack.value.length === 0) return;
  stopSequence();
  const current = snapshotState();
  const prev = undoStack.value.pop();
  redoStack.value.push(current);
  restoreState(prev);
};

const redo = () => {
  if (redoStack.value.length === 0) return;
  stopSequence();
  const current = snapshotState();
  const next = redoStack.value.pop();
  undoStack.value.push(current);
  restoreState(next);
};

// キーボードショートカット
const onKeydown = (e) => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return;

  if (e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  }
};

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

// =====================================================
// ■ 範囲選択ロジック
// =====================================================
const selectionStartId = ref(null);
const selectionEndId = ref(null);
const awaitingEnd = ref(false);

const selectionInfo = computed(() => {
  if (selectionStartId.value == null) return { has: false };

  const ids = noteBlocks.value.map(b => b.id);
  const startIndexRaw = ids.indexOf(selectionStartId.value);
  if (startIndexRaw === -1) return { has: false };

  const endIndexRaw = selectionEndId.value != null ? ids.indexOf(selectionEndId.value) : startIndexRaw;
  const endIndexSafe = endIndexRaw === -1 ? startIndexRaw : endIndexRaw;

  return {
    has: true,
    startIndex: Math.min(startIndexRaw, endIndexSafe),
    endIndex: Math.max(startIndexRaw, endIndexSafe),
    startId: selectionStartId.value,
    endId: selectionEndId.value,
    awaitingEnd: awaitingEnd.value,
  };
});

const clearSelection = () => {
  selectionStartId.value = null;
  selectionEndId.value = null;
  awaitingEnd.value = false;
};

const setRangePoint = (blockId) => {
  // 未選択 or 選択確定済み → 始点として新規設定
  if (selectionStartId.value == null || (selectionEndId.value != null && !awaitingEnd.value)) {
    selectionStartId.value = blockId;
    selectionEndId.value = null;
    awaitingEnd.value = true;
    return;
  }
  // 終点待ち → 終点を設定
  if (awaitingEnd.value) {
    selectionEndId.value = blockId;
    awaitingEnd.value = false;
  }
};

const getSelectBtnText = (block) => {
  if (selectionEndId.value != null && !awaitingEnd.value) {
    const info = selectionInfo.value;
    const ids = noteBlocks.value.map(b => b.id);
    const idx = ids.indexOf(block.id);
    if (idx === info.startIndex) return "始点";  // 実際の始点側
    if (idx === info.endIndex) return "終点";    // 実際の終点側
  }
  if (awaitingEnd.value && block.id === selectionStartId.value) return "始点✓";
  return "選択";
};

/*
const getSelectBtnText = (block) => {
  if (selectionEndId.value != null && !awaitingEnd.value) {
    if (selectionStartId.value === selectionEndId.value) return "選択";
    if (block.id === selectionStartId.value) return "始点";
    if (block.id === selectionEndId.value) return "終点";
  }
  if (awaitingEnd.value && block.id === selectionStartId.value) return "始点✓";
  return "選択";
};
*/

const isBlockSelected = (blockId) => {
  const info = selectionInfo.value;
  if (!info.has) return false;
  const ids = noteBlocks.value.map(b => b.id);
  const idx = ids.indexOf(blockId);
  return idx >= info.startIndex && idx <= info.endIndex;
};

const isStartAnchor = (blockId) => selectionStartId.value === blockId && blockId != null;
const isEndAnchor = (blockId) => selectionEndId.value === blockId && blockId != null;

// アンカーが消えたら自動解除（グループドラッグ中は除く）
watch(
  () => noteBlocks.value.map(b => b.id),
  (ids) => {
    if (groupDragActive.value) return;
    if (selectionStartId.value != null && !ids.includes(selectionStartId.value)) {
      clearSelection();
      return;
    }
    if (selectionEndId.value != null && !ids.includes(selectionEndId.value)) {
      selectionEndId.value = null;
      awaitingEnd.value = true;
    }
  }
);

// =====================================================
// ■ 再生 / 停止 / 書き出し
// =====================================================
const getBlocksForPlayOrExport = () => {
  const info = selectionInfo.value;
  return info.has
    ? noteBlocks.value.slice(info.startIndex, info.endIndex + 1)
    : noteBlocks.value;
};

const playBlocksSequentially = async (blocks) => {
  await Tone.start();
  if (!isLoaded.value) return;

  const now = Tone.now();
  let timeOffset = 0;

  blocks.forEach((block) => {
    // if (players.has(block.sound)) {                // ← いらない気がする？
      const player = players.player(block.sound);
      const fileDuration = player.buffer.duration; 
      // const fileDuration = player.loaded ? player.buffer.duration : 0; // player.loaded は不必要？

      player.start(now + timeOffset);

      Tone.Draw.schedule(() => { block.isPlaying = true; }, now + timeOffset);
      Tone.Draw.schedule(() => { block.isPlaying = false; }, now + timeOffset + fileDuration);

      timeOffset += fileDuration;
    // }
  });
};

const playSelectedOrAll = async () => {
  stopSequence();
  const blocks = getBlocksForPlayOrExport();
  if (!blocks.length) return;
  await playBlocksSequentially(blocks);
};

const stopSequence = () => {
  players.stopAll();
  Tone.Draw.cancel();
  // 🔧 修正: stopAll後に全ブロックの isPlaying を確実にリセット
  noteBlocks.value.forEach(block => { block.isPlaying = false; });
};

// 試聴（単発）
const previewSound = (block) => {
  if (players.has(block.sound)) {
    players.player(block.sound).start();
    // 🔧 修正: hasOwnProperty チェックは不要（全ブロックが isPlaying を持つ）
    block.isPlaying = true;
    setTimeout(() => { block.isPlaying = false; }, 200);
  }
};

// =====================================================
// ■ ブロック操作（すべてUndo対応）
// =====================================================

// 🔧 修正: パレットからの追加を Undo 対象にする
const onPaletteAdd = () => {
  // draggable の @add は追加後に発火するため、
  // 追加前の状態を積むために「追加直前」のスナップショットが必要。
  // そのため onPaletteDragStart で事前スナップショットを取る。
  pushHistoryFromPreSnapshot();
};

// パレットのドラッグ開始前にスナップショットを保存
const palettePreSnapshot = ref(null);

const onPaletteDragStart = () => {
  palettePreSnapshot.value = snapshotState();
};

const pushHistoryFromPreSnapshot = () => {
  if (!palettePreSnapshot.value) return;
  undoStack.value.push(palettePreSnapshot.value);
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
  palettePreSnapshot.value = null;
};

// 単発削除
const removeBlock = (index) => {
  pushHistory();
  noteBlocks.value.splice(index, 1);
};

// 選択範囲の複製
const duplicateSelection = () => {
  const info = selectionInfo.value;
  if (!info.has) return;

  pushHistory();
  const segment = noteBlocks.value.slice(info.startIndex, info.endIndex + 1);
  const clones = segment.map(b => ({
    ...b,
    id: nextId.value++,  // 🔧 修正: ref の .value を使用
    isPlaying: false,
  }));
  noteBlocks.value.splice(info.endIndex + 1, 0, ...clones);
};

// 選択範囲の削除
const deleteSelection = () => {
  const info = selectionInfo.value;
  if (!info?.has) return;

  pushHistory();
  noteBlocks.value.splice(info.startIndex, info.endIndex - info.startIndex + 1);
  clearSelection();
};

// 音名変更（Undo対応）
const setBlockSound = (id, newSound) => {
  const b = noteBlocks.value.find(x => x.id === id);
  if (!b || b.sound === newSound) return;

  pushHistory();
  b.sound = newSound;
};

// 色変更（Undo対応）
const colorPickerBlockId = ref(null);

const setBlockColor = (id, newColor) => {
  const b = noteBlocks.value.find(x => x.id === id);
  if (!b || b.color === newColor) return;
  pushHistory();
  b.color = newColor;
};

const openColorPicker = (blockId) => {
  colorPickerBlockId.value = blockId;
};

const closeColorPicker = () => {
  colorPickerBlockId.value = null;
};

// WAV書き出し
const exportAudio = async () => {
  const blocks = getBlocksForPlayOrExport();
  if (blocks.length === 0) return alert("ブロックがありません");

  let totalDuration = 0;
  blocks.forEach(block => {
    if (players.has(block.sound)) {
      const p = players.player(block.sound);
      totalDuration += p.loaded ? p.buffer.duration : 0;
    }
  });
  totalDuration += 1.0;

  const buffer = await Tone.Offline(() => {
    let timeOffset = 0;
    blocks.forEach(block => {
      if (players.has(block.sound)) {
        const originalBuffer = players.player(block.sound).buffer;
        const source = new Tone.BufferSource(originalBuffer).toDestination();
        source.start(timeOffset);
        timeOffset += originalBuffer.duration;
      }
    });
  }, totalDuration);

  downloadWav(buffer);
};

const downloadWav = (audioBuffer) => {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i, sample, offset = 0, pos = 0;

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1);
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16);
  setUint32(0x61746164); setUint32(length - pos - 4);

  for (i = 0; i < numOfChan; i++)
    channels.push(audioBuffer.getChannelData(i));

  while (pos < audioBuffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (sample < 0 ? sample * 32768 : sample * 32767) | 0;
      // sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;  // 何のために 0.5 + sample < 0 としているのか不明
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  const blob = new Blob([buffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  document.body.appendChild(anchor);
  anchor.style = "display: none";
  anchor.href = url;
  anchor.download = "my_sequence.wav";
  anchor.click();
  window.URL.revokeObjectURL(url);

  function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
};

// =====================================================
// ■ グループドラッグ（選択範囲の一括移動）
//
// 設計：
//   @start では配列を触らない（vuedraggable の DOM 参照を壊さないため）。
//   setTimeout(0) で vuedraggable の内部処理完了後に代理ブロックへ圧縮する。
//   @end で DOM の previousElementSibling から挿入位置を決定し展開する。
// =====================================================
// Group drag
//
// 設計方針：
//   ドラッグ中は配列を変更しない（vuedraggableのDOM参照を壊さないため）。
//   GROUP表示はVueのリアクティブな ref で制御する：
//     groupDragActive: ドラッグ中フラグ
//     groupSegmentIds: セグメントのID一覧（テンプレートの :class で参照）
//     groupDraggedId:  つかんだブロックのID（このブロックだけGROUP表示）
//   ・つかんだブロック(draggedId)のDOM: Vue テンプレートで GROUP 表示に切り替え
//   ・他のセグメントブロック: display:none で非表示
//   ・@end 後: 配列を組み直し → Vue が DOM を再描画 → 全て元通り
// =====================================================
const groupDragActive = ref(false);
const groupSegmentIds = ref([]);
const groupDraggedId = ref(null); // このブロックをGROUP表示にする
let _gState = null;

const onSeqDragStart = (evt) => {
  if (!evt || evt.from !== evt.to) return;
  const info = selectionInfo.value;
  if (!info?.has) return;
  const draggedId = Number(evt.item?.dataset?.id);
  if (!draggedId) return;
  const draggedIdx = noteBlocks.value.findIndex(b => b.id === draggedId);
  if (draggedIdx === -1 || draggedIdx < info.startIndex || draggedIdx > info.endIndex) return;

  const segment = noteBlocks.value.slice(info.startIndex, info.endIndex + 1);
  const segmentIds = segment.map(b => b.id);

  _gState = { draggedId, segmentIds, segmentData: segment.map(b => ({ sound: b.sound, color: b.color })), preSnapshot: snapshotState() };
  groupDragActive.value = true;
  groupSegmentIds.value = segmentIds;
  groupDraggedId.value = draggedId;
  awaitingEnd.value = false;

  // Vue が DOM を更新するのを待ってから他メンバーを非表示にする
  nextTick(() => {
    const segSet = new Set(segmentIds);
    evt.from.querySelectorAll('[data-id]').forEach(el => {
      const bid = Number(el.dataset.id);
      if (segSet.has(bid) && bid !== draggedId && !el.classList.contains('seq-ghost')) {
        el.style.display = 'none';
        el.dataset.hiddenByGroup = '1';
      }
    });
  });
};

const onSeqDragEnd = async (evt) => {
  // 非表示ブロックを先に戻す（nextTick前に）
  document.querySelectorAll('[data-hidden-by-group]').forEach(el => {
    el.style.display = '';
    delete el.dataset.hiddenByGroup;
  });

  if (!_gState) {
    groupDragActive.value = false;
    groupSegmentIds.value = [];
    groupDraggedId.value = null;
    return;
  }

  const { segmentIds, preSnapshot } = _gState;
  const segmentSet = new Set(segmentIds);

  // DOM参照はnextTick前に確定する
  let prevId = null;
  let sib = evt.item?.previousElementSibling;
  while (sib) {
    const sid = Number(sib.dataset?.id);
    if (sid && !segmentSet.has(sid)) { prevId = sid; break; }
    sib = sib.previousElementSibling;
  }

  _gState = null;
  groupDragActive.value = false;
  groupSegmentIds.value = [];
  groupDraggedId.value = null;

  await nextTick();

  undoStack.value.push(preSnapshot);
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];

  const snap = preSnapshot.noteBlocks;
  const base = snap.filter(b => !segmentSet.has(b.id)).map(b => ({ ...b, isPlaying: false }));
  const segs = segmentIds.map(id => snap.find(b => b.id === id)).filter(Boolean).map(b => ({ ...b, isPlaying: false }));
  const insertAt = prevId === null ? 0 : (() => {
    const idx = base.findIndex(b => b.id === prevId);
    return idx === -1 ? base.length : idx + 1;
  })();
  base.splice(insertAt, 0, ...segs);
  noteBlocks.value = base;

  selectionStartId.value = segmentIds[0] ?? null;
  selectionEndId.value = segmentIds[segmentIds.length - 1] ?? null;
  awaitingEnd.value = false;
};


const startTour = () => {
  const tourDriver = driver({
    showProgress: true,
    nextBtnText: '次へ',
    prevBtnText: '戻る',
    doneBtnText: '完了',
    steps: [
      {
        element: '.sidebar',
        popover: {
          title: '素材パレット',
          description: 'ここにある音（A〜H）を、右側のエリアにドラッグ＆ドロップしてください。',
          side: "right", align: 'start'
        }
      },
      {
        element: '.sequencer-wrapper',
        popover: {
          title: '作業スペース',
          description: 'ここに並べた順番で音が再生されます。ブロックの「選択」で始点→終点を指定すると範囲再生できます。',
          side: "left", align: 'start'
        }
      },
      {
        element: '.controls',
        popover: {
          title: 'コントロール',
          description: '「再生」は選択範囲を再生（無選択なら全体）。「複製」で選択範囲を増やせます。',
          side: "bottom", align: 'start'
        }
      }
    ]
  });
  tourDriver.drive();
};

onMounted(() => {
  setTimeout(() => startTour(), 1000);
});
</script>

<template>
  <div class="app-layout">
    <!-- ■ サイドバー（パレット） -->
    <div class="sidebar">
      <h2>Palette</h2>
      <p class="hint">Drag to right area 👉</p>

      <draggable
        v-model="soundPalette"
        item-key="sound"
        class="palette-list"
        :group="{ name: 'music', pull: 'clone', put: false }"
        :clone="cloneSound"
        :sort="false"
        @start="onPaletteDragStart"
      >
        <template #item="{ element }">
          <div class="palette-item" @click="previewSound(element)">
            <span class="palette-icon">♪</span>
            <span class="palette-label">{{ element.sound }}</span>
          </div>
        </template>
      </draggable>
    </div>

    <!-- ■ メインコンテンツ -->
    <div class="main-content">
      <div class="header">
        <h1>DOPP Sequencer</h1>

        <div class="controls">
          <button
            @click="playSelectedOrAll"
            class="btn-play"
            :disabled="!isLoaded"
            :class="{ loading: !isLoaded }"
          >
            {{ isLoaded ? (selectionInfo.has ? "▶ 選択再生" : "▶ 全再生") : "読み込み中..." }}
          </button>

          <button @click="stopSequence" class="btn-stop">■ 停止</button>

          <button @click="exportAudio" class="btn-export" :disabled="!isLoaded">⬇ 保存</button>

          <button @click="duplicateSelection" class="btn-duplicate" :disabled="!selectionInfo.has">
            ⧉ 複製
          </button>

          <button @click="clearSelection" class="btn-clear" :disabled="!selectionInfo.has">
            選択解除
          </button>

          <button @click="deleteSelection" class="btn-clear" :disabled="!selectionInfo.has">
            選択削除
          </button>

          <button @click="undo" class="btn-clear" :disabled="undoStack.length === 0">
            ↩ Undo
          </button>
          <button @click="redo" class="btn-clear" :disabled="redoStack.length === 0">
            ↪ Redo
          </button>

          <button @click="startTour" class="btn-help">? 使い方</button>
        </div>
      </div>

      <div class="sequencer-wrapper">
        <draggable
          v-model="noteBlocks"
          item-key="id"
          class="block-list"
          animation="200"
          group="music"
          ghost-class="seq-ghost"
          chosen-class="seq-chosen"
          drag-class="seq-drag"
          @start="onSeqDragStart"
          @end="onSeqDragEnd"
          @add="onPaletteAdd"
        >
          <template #item="{ element, index }">
            <div
              class="music-block"
              :class="{
                active:         element.isPlaying,
                selected:       isBlockSelected(element.id),
                'anchor-start': isStartAnchor(element.id),
                'anchor-end':   isEndAnchor(element.id),
                'group-member': groupDragActive && groupSegmentIds.includes(element.id),
                'is-group-proxy': groupDragActive && groupDraggedId === element.id,
              }"
              :style="{ backgroundColor: element.color }"
              :data-id="element.id"
              @click="previewSound(element)"
            >
              <span class="step-number">{{ index + 1 }}</span>
              <template v-if="groupDragActive && groupDraggedId === element.id">
                <span class="sound-name">GROUP</span>
                <div class="proxy-chips">
                  <div v-for="seg in noteBlocks.filter(b => groupSegmentIds.includes(b.id))"
                       :key="seg.id" class="proxy-chip" :style="{ backgroundColor: seg.color }">
                    <span>{{ seg.sound }}</span>
                  </div>
                </div>
              </template>
              <template v-else>
                <span class="sound-name">{{ element.sound.toUpperCase() }}</span>
                <select :value="element.sound" @click.stop @change="setBlockSound(element.id, $event.target.value)">
                  <option v-for="s in ['A','B','C','D','E','F','G','H']" :key="s" :value="s">{{ s }}</option>
                </select>
                <button class="btn-select-range" @click.stop="setRangePoint(element.id)">{{ getSelectBtnText(element) }}</button>
                <button class="btn-delete" @click.stop="removeBlock(index)">×</button>
                <button class="btn-color" @click.stop="openColorPicker(element.id)">🎨</button>
              </template>
            </div>
          </template>
        </draggable>

        <div v-if="colorPickerBlockId !== null"
            class="color-popup-overlay"
            @click="closeColorPicker">
          <div class="color-popup" @click.stop>
            <p>色を選択</p>
            <input
              type="color"
              :value="noteBlocks.find(b => b.id === colorPickerBlockId)?.color"
              @change="setBlockColor(colorPickerBlockId, $event.target.value)"
            />
            <button @click="closeColorPicker">閉じる</button>
          </div>
        </div>

        <div v-if="noteBlocks.length === 0" class="empty-state">
          左のパレットから音を置いてみよう
        </div>
      </div>
    </div>
  </div>

</template>

<style scoped>
.app-layout {
  display: flex;
  height: 100vh;
  background-color: #222;
  color: white;
  font-family: sans-serif;
  overflow: hidden;
}

.sidebar {
  width: 120px;
  background-color: #2d2d2d;
  padding: 20px 10px;
  border-right: 1px solid #444;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar h2 { font-size: 1.2rem; margin-bottom: 5px; text-align: center; }
.hint { font-size: 0.7rem; color: #aaa; text-align: center; margin-bottom: 20px; }

.palette-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}

.palette-item {
  width: 80px;
  height: 60px;
  background-color: #444;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: grab;
  border: 1px solid #555;
  transition: transform 0.1s, background-color 0.1s;
}
.palette-item:hover { background-color: #555; }
.palette-item:active { cursor: grabbing; transform: scale(0.95); }

.palette-icon { font-size: 1.2rem; margin-bottom: 2px; }
.palette-label { font-size: 1.0rem; font-weight: bold; }

.main-content {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.header { margin-bottom: 20px; }
.controls { display: flex; gap: 10px; flex-wrap: wrap; }

.sequencer-wrapper {
  background-color: #333;
  padding: 20px;
  border-radius: 8px;
  flex: 1;
  min-height: 300px;
  display: flex;
  flex-direction: column;
  position: relative;
}

.block-list {
  display: flex;
  flex-wrap: wrap;
  gap: 30px 10px;
  flex: 1;
  align-content: flex-start;
  width: 100%;
  min-height: 100%;
}

.empty-state {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  font-weight: bold;
  border: 2px dashed #444;
  border-radius: 8px;
  box-sizing: border-box;
  pointer-events: none;
}

button { cursor: pointer; border: none; padding: 10px 20px; border-radius: 4px; font-weight: bold; }

.btn-play { background-color: #4caf50; color: white; }
.btn-play:disabled { background-color: #555; cursor: wait; }

.btn-stop { background-color: #ff4757; color: white; }
.btn-stop:hover { background-color: #ff6b81; }
.btn-stop:active { transform: translateY(2px); }

.btn-export { background-color: #9b59b6; color: white; }
.btn-export:hover { background-color: #8e44ad; }
.btn-export:disabled { background-color: #555; cursor: wait; }

.btn-help {
  background-color: #7f8c8d;
  color: white;
  border-radius: 50px;
  padding: 5px 15px;
  font-size: 0.9rem;
}
.btn-help:hover { background-color: #95a5a6; }

.btn-duplicate { background-color: rgba(255,255,255,0.15); color: #fff; }
.btn-duplicate:hover { background-color: rgba(255,255,255,0.3); }
.btn-duplicate:disabled { background-color: #555; cursor: not-allowed; }

.btn-clear { background-color: rgba(255,255,255,0.08); color: #fff; }
.btn-clear:hover { background-color: rgba(255,255,255,0.2); }
.btn-clear:disabled { background-color: #555; cursor: not-allowed; }

.seq-chosen,
.seq-drag,
.seq-ghost { transform: scale(0.85); }
.seq-ghost { opacity: 0.4; }
.seq-ghost.group-ghost { opacity: 1 !important; transform: none !important; }

.music-block {
  width: 90px; height: 90px;
  border-radius: 4px;
  display: flex; flex-direction: column;
  justify-content: center; align-items: center;
  cursor: grab; position: relative;
  box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  border: 2px solid rgba(255,255,255,0.1);
  transition: transform 0.1s, filter 0.1s, box-shadow 0.1s, outline 0.1s;
}

.music-block.active {
  filter: brightness(1.5);
  box-shadow: 0 0 15px #ffffff;
  border-color: #ffffff;
  transform: scale(1.05);
  z-index: 10;
}

.music-block.selected {
  outline: 2px solid rgba(255,255,255,0.8);
  outline-offset: 2px;
}
.music-block.anchor-start,
.music-block.anchor-end { border-color: rgba(255,255,255,0.9); }

.step-number {
  position: absolute; top: 4px; left: 6px;
  font-size: 0.8rem; font-weight: bold;
  color: rgba(255,255,255,0.5);
}

.sound-name {
  font-size: 1.2rem; font-weight: 900; color: #fff;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.5);
  margin-bottom: 5px;
}

select {
  width: 80%; font-size: 0.8rem;
  background: rgba(255,255,255,0.9); color: #333;
  border: none; border-radius: 2px;
  margin-bottom: 15px; cursor: pointer;
}

.btn-delete {
  position: absolute; top: 2px; right: 2px;
  background: rgba(0,0,0,0.3); color: white;
  width: 20px; height: 20px; padding: 0;
  font-size: 12px; line-height: 20px; border-radius: 50%;
}
.btn-delete:hover { background: rgba(255,0,0,0.7); }

.btn-select-range {
  position: absolute; bottom: 2px;
  background: rgba(255,255,255,0.2);
  color: white; width: auto;
  padding: 0 8px; height: 20px;
  font-size: 10px; line-height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.3);
}
.btn-select-range:hover {
  background: rgba(255,255,255,0.9);
  color: #333;
}

/* グループドラッグ中：選択範囲の全ブロックを半透明化（setDragImageのゴーストが動く） */
.music-block.group-dragging {
  opacity: 0.2;
  pointer-events: none;
}

/* ドラッグ中：セグメントメンバーを半透明+ゴールドアウトラインで示す */
.music-block.group-member {
  outline: 2px solid rgba(255, 200, 0, 0.85);
  outline-offset: 2px;
  opacity: 0.35;
  pointer-events: none;
}
.music-block.is-group-proxy {
  background: #3a3a3a !important;
  border: 2px dashed rgba(255,255,255,0.7) !important;
  justify-content: center;
}
.proxy-chips {
  display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; padding: 2px;
}
.proxy-chip {
  width: 20px; height: 20px; border-radius: 3px;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255,255,255,0.35);
}
.proxy-chip span { font-weight: 900; font-size: 0.6rem; color: #fff; }

.btn-color {
  position: absolute;
  bottom: 2px;
  left: 2px;
  background: rgba(0,0,0,0.3);
  color: white;
  width: 20px;
  height: 20px;
  padding: 0;
  font-size: 10px;
  line-height: 20px;
  border-radius: 50%;
}
.btn-color:hover {
  background: rgba(255,255,255,0.3);
}

.color-popup-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 100;
  background: rgba(0,0,0,0.3);
}

.color-popup {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  background: #444;
  padding: 20px;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}

.color-popup p {
  margin: 0;
  font-weight: bold;
  color: white;
}

.color-popup input[type="color"] {
  width: 80px;
  height: 80px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  background: none;
}

.color-popup button {
  background: rgba(255,255,255,0.15);
  color: white;
  padding: 6px 16px;
  border-radius: 4px;
}
.color-popup button:hover {
  background: rgba(255,255,255,0.3);
}
</style>