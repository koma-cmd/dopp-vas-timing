<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue';
import draggable from 'vuedraggable';
import * as Tone from 'tone';
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

// ■ 1. パレット（素材置き場）の定義
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

// ■ 2. シーケンサー初期データ（isPlaying を最初から持たせる）
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

let nextId = 9;
const isLoaded = ref(false);

// ■ 3. Tone.Players の準備 (A〜H)
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

// ■ 4. パレットからの複製処理 (Clone)
const cloneSound = (origin) => {
  return {
    ...origin,
    id: nextId++,
    isPlaying: false
  };
};

// =====================================================
// ✅ 追加: Undo / Redo（履歴）
// =====================================================
const undoStack = ref([]);
const redoStack = ref([]);
const MAX_HISTORY = 50;

const snapshotState = () => ({
  noteBlocks: noteBlocks.value.map(b => ({ ...b, isPlaying: false })), // isPlayingは復元不要
  selectionStartId: selectionStartId.value,
  selectionEndId: selectionEndId.value,
  awaitingEnd: awaitingEnd.value,
  nextId,
});

const restoreState = (s) => {
  noteBlocks.value = s.noteBlocks.map(b => ({ ...b, isPlaying: false }));
  selectionStartId.value = s.selectionStartId;
  selectionEndId.value = s.selectionEndId;
  awaitingEnd.value = s.awaitingEnd;
  nextId = s.nextId;
};

const pushHistory = () => {
  undoStack.value.push(snapshotState());
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
};

// ドラッグ開始時に取ったsnapshotをそのまま積む用
const pushHistoryFromSnapshot = (snap) => {
  if (!snap) return;
  undoStack.value.push(snap);
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
};

const undo = () => {
  if (undoStack.value.length === 0) return;
  const current = snapshotState();
  const prev = undoStack.value.pop();
  redoStack.value.push(current);
  restoreState(prev);
  stopSequence(); // 再生事故防止
};

const redo = () => {
  if (redoStack.value.length === 0) return;
  const current = snapshotState();
  const next = redoStack.value.pop();
  undoStack.value.push(current);
  restoreState(next);
  stopSequence();
};

// ✅ 追加: ショートカット（Cmd/Ctrl+Z, Cmd+Shift+Z, Ctrl+Y）
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
// ✅ 追加: 範囲選択（始点/終点）ロジック
// =====================================================
const selectionStartId = ref(null);
const selectionEndId = ref(null);
const awaitingEnd = ref(false); // true のとき「終点待ち」

const selectionInfo = computed(() => {
  if (selectionStartId.value == null) return { has: false };

  const ids = noteBlocks.value.map(b => b.id);
  const startIndexRaw = ids.indexOf(selectionStartId.value);
  if (startIndexRaw === -1) return { has: false, invalid: true };

  const endIndexRaw = (selectionEndId.value != null) ? ids.indexOf(selectionEndId.value) : startIndexRaw;
  const endIndexSafe = (endIndexRaw === -1) ? startIndexRaw : endIndexRaw;

  return {
    has: true,
    startIndex: Math.min(startIndexRaw, endIndexSafe),
    endIndex: Math.max(startIndexRaw, endIndexSafe),
    startId: selectionStartId.value,
    endId: selectionEndId.value,
    awaitingEnd: awaitingEnd.value
  };
});

const clearSelection = () => {
  selectionStartId.value = null;
  selectionEndId.value = null;
  awaitingEnd.value = false;
};

const setRangePoint = (blockId) => {
  if (selectionStartId.value == null || (selectionEndId.value != null && !awaitingEnd.value)) {
    selectionStartId.value = blockId;
    selectionEndId.value = null;
    awaitingEnd.value = true;
    return;
  }
  if (awaitingEnd.value) {
    selectionEndId.value = blockId;
    awaitingEnd.value = false;
    return;
  }
};

const getSelectBtnText = (block) => {
  if (selectionStartId.value == null || (selectionEndId.value != null && !awaitingEnd.value)) {
    if (selectionEndId.value != null && !awaitingEnd.value) {
      if (block.id === selectionStartId.value) return "始点";
      if (block.id === selectionEndId.value) return "終点";
    }
    return "選択";
  }
  if (awaitingEnd.value) {
    if (block.id === selectionStartId.value) return "始点✓";
    return "終点";
  }
  return "選択";
};

const isBlockSelected = (blockId) => {
  const info = selectionInfo.value;
  if (!info.has) return false;
  const ids = noteBlocks.value.map(b => b.id);
  const idx = ids.indexOf(blockId);
  if (idx === -1) return false;
  return idx >= info.startIndex && idx <= info.endIndex;
};

const isStartAnchor = (blockId) => selectionStartId.value === blockId && selectionStartId.value != null;
const isEndAnchor = (blockId) => selectionEndId.value === blockId && selectionEndId.value != null;

// 並べ替え/削除でアンカーが消えたら選択を自動解除（事故防止）
watch(
  () => noteBlocks.value.map(b => b.id),
  (ids) => {
    // ✅追加：グループ代理ドラッグ中は、アンカーが一時的に消えるので解除しない
    if (groupProxyActive.value) return;

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
// ✅ 再生：選択範囲優先、無選択なら全体
// =====================================================
const getBlocksForPlayOrExport = () => {
  const info = selectionInfo.value;
  if (info.has) {
    return noteBlocks.value.slice(info.startIndex, info.endIndex + 1);
  }
  return noteBlocks.value;
};

const playBlocksSequentially = async (blocks) => {
  await Tone.start();
  if (!isLoaded.value) return;

  const now = Tone.now();
  let timeOffset = 0;

  blocks.forEach((block) => {
    if (players.has(block.sound)) {
      const player = players.player(block.sound);
      const fileDuration = player.loaded ? player.buffer.duration : 0;

      player.start(now + timeOffset);

      Tone.Draw.schedule(() => { block.isPlaying = true; }, now + timeOffset);
      Tone.Draw.schedule(() => { block.isPlaying = false; }, now + timeOffset + fileDuration);

      timeOffset += fileDuration;
    }
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
  noteBlocks.value.forEach(block => { block.isPlaying = false; });
};

// 試聴（単発）
const previewSound = (block) => {
  if (players.has(block.sound)) {
    players.player(block.sound).start();
    if (block.hasOwnProperty('isPlaying')) {
      block.isPlaying = true;
      setTimeout(() => { block.isPlaying = false; }, 100);
    }
  }
};

// =====================================================
// ✅ Undo対象：単発削除
// =====================================================
const removeBlock = (index) => {
  pushHistory(); // ✅ 追加
  noteBlocks.value.splice(index, 1);
};

// =====================================================
// ✅ 追加: 選択範囲の複製（Undo対応）
// =====================================================
const duplicateSelection = () => {
  const info = selectionInfo.value;
  if (!info.has) return;

  pushHistory(); // ✅ 追加

  const segment = noteBlocks.value.slice(info.startIndex, info.endIndex + 1);
  const clones = segment.map(b => ({
    ...b,
    id: nextId++,
    isPlaying: false
  }));

  noteBlocks.value.splice(info.endIndex + 1, 0, ...clones);
};

// =====================================================
// ✅ 追加: 選択範囲の削除（Undo対応）
// =====================================================
const deleteSelection = () => {
  const info = selectionInfo.value;
  if (!info?.has) return;

  pushHistory(); // ✅ 追加
  noteBlocks.value.splice(info.startIndex, info.endIndex - info.startIndex + 1);
  clearSelection();
};

// =====================================================
// ✅ 追加: 音名変更もUndo対象にする（v-modelをやめて関数経由）
// =====================================================
const setBlockSound = (id, newSound) => {
  const b = noteBlocks.value.find(x => x.id === id);
  if (!b) return;
  if (b.sound === newSound) return;

  pushHistory(); // ✅ 追加
  b.sound = newSound;
};

// =====================================================
// 保存（書き出し）も「選択範囲優先」に変更
// =====================================================
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

  console.log("書き出し開始: 長さ", totalDuration, "秒");

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

// WAV変換＆ダウンロード
const downloadWav = (audioBuffer) => {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i;
  let sample;
  let offset = 0;
  let pos = 0;

  setUint32(0x46464952);
  setUint32(length - 8);
  setUint32(0x45564157);
  setUint32(0x20746d66);
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  setUint32(0x61746164);
  setUint32(length - pos - 4);

  for (i = 0; i < audioBuffer.numberOfChannels; i++)
    channels.push(audioBuffer.getChannelData(i));

  while (pos < audioBuffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
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
// ✅ 追加: 選択範囲を「まとめて」ドラッグ移動（ドロップ時に一括移動）
// =====================================================
const groupDragActive = ref(false);
const seqDragSnapshot = ref([]);
const seqDragMeta = ref(null);
// =====================================================
// ✅ 追加: 選択範囲ドラッグを「1要素の代理」に変換して見せる（塊ゴースト無し）
// =====================================================
const groupProxyActive = ref(false);
const groupProxyMeta = ref(null);
/*
groupProxyMeta = {
  proxyId: number,
  segment: Array<block>,
  startId: number,
  endId: number
}
*/

// ✅ 追加：ドラッグ中に使う情報
const dragSelectedIds = ref([]);
const dragDraggedId = ref(null);
const dragHistorySnapshot = ref(null);

const onSeqDragStart = (evt) => {
  // sequencer 内ソート以外は無視
  if (!evt || evt.from !== evt.to) return;

  const info = selectionInfo.value;
  if (!info?.has) return;

  const oldIndex = evt.oldIndex;
  if (typeof oldIndex !== "number") return;

  // ドラッグ開始地点が選択範囲内なら「範囲移動」扱い
  if (oldIndex < info.startIndex || oldIndex > info.endIndex) return;

  // ✅ 選択範囲のスナップショット
  const snapshot = noteBlocks.value.slice();
  const segment = snapshot.slice(info.startIndex, info.endIndex + 1);

  // ✅ Undo があるならここで積む（あなたがUndo実装している場合）
  // pushHistory();

  // ✅ 「ドラッグしている1要素」を代理（グループ表示）に変身させる
  const proxy = noteBlocks.value[oldIndex];
  proxy.__isGroupProxy = true;
  proxy.__groupItems = segment.map(b => ({ id: b.id, sound: b.sound, color: b.color }));

  // ✅ 選択範囲の他要素（proxy以外）を一時的にリストから外す
  //   ※後ろから消す（indexずれ防止）
  for (let i = info.endIndex; i >= info.startIndex; i--) {
    if (i === oldIndex) continue;
    noteBlocks.value.splice(i, 1);
  }

  groupProxyActive.value = true;
  groupProxyMeta.value = {
    proxyId: proxy.id,
    segment: segment.map(b => ({ ...b, isPlaying: false })), // 復元用（必要ならdeepでも）
    startId: segment[0]?.id ?? null,
    endId: segment[segment.length - 1]?.id ?? null,
  };

  // 選択はドラッグ中に一時的に“崩れる”ので固定
  awaitingEnd.value = false;
};

const onSeqDragEnd = (evt) => {
  if (!groupProxyActive.value || !groupProxyMeta.value) return;

  const { proxyId, segment, startId, endId } = groupProxyMeta.value;

  // ✅ 今の配列の中で「代理要素」がどこに移動したかを探す
  const proxyIndex = noteBlocks.value.findIndex(b => b.id === proxyId);
  if (proxyIndex === -1) {
    // 万一見つからない場合は復旧だけして終了
    groupProxyActive.value = false;
    groupProxyMeta.value = null;
    return;
  }

  // ✅ 代理要素を取り出し（代理フラグを消す）
  const proxy = noteBlocks.value[proxyIndex];
  delete proxy.__isGroupProxy;
  delete proxy.__groupItems;

  // ✅ 代理要素を消して、そこに選択範囲（segment）を展開して挿入
  noteBlocks.value.splice(proxyIndex, 1, ...segment.map(b => ({ ...b, isPlaying: false })));

  // ✅ アンカーを復元
  selectionStartId.value = startId;
  selectionEndId.value = endId;
  awaitingEnd.value = false;

  groupProxyActive.value = false;
  groupProxyMeta.value = null;
};

/*
const onSeqDragStart = (evt) => {
  if (!evt || evt.from !== evt.to) return;

  const info = selectionInfo.value;
  if (!info?.has) return;

  const oldIndex = evt.oldIndex;
  if (typeof oldIndex !== "number") return;

  // ドラッグ開始地点が選択範囲内なら「範囲移動」扱い
  if (oldIndex < info.startIndex || oldIndex > info.endIndex) return;

  groupDragActive.value = true;
  seqDragSnapshot.value = noteBlocks.value.slice();
  seqDragMeta.value = {
    startIndex: info.startIndex,
    endIndex: info.endIndex,
    offset: oldIndex - info.startIndex,
  };

  // ✅ 追加：選択範囲のID一覧（固定）と、ドラッグ対象IDを保存
  const segment = seqDragSnapshot.value.slice(info.startIndex, info.endIndex + 1);
  dragSelectedIds.value = segment.map(b => b.id);
  dragDraggedId.value = segment[seqDragMeta.value.offset]?.id ?? segment[0]?.id ?? null;

  // ✅ 追加：Undo用に開始前状態を保存
  dragHistorySnapshot.value = snapshotState();

  // ✅ 既存：見た目用ゴースト（選択範囲全体）をカーソルに追従表示
  enableDragGroupGhost(evt, segment);
};
*/

/*
const onSeqDragEnd = (evt) => {
  disableDragGroupGhost();

  if (!groupDragActive.value || !evt || evt.from !== evt.to) {
    groupDragActive.value = false;
    return;
  }

  const snapshot = seqDragSnapshot.value;
  const meta = seqDragMeta.value;
  if (!snapshot?.length || !meta) {
    groupDragActive.value = false;
    return;
  }

  const selectedIds = new Set(dragSelectedIds.value);
  const draggedId = dragDraggedId.value;

  const { startIndex, endIndex } = meta;
  const segment = snapshot.slice(startIndex, endIndex + 1);

  // ✅ Undo：ドラッグ開始前の状態を積む
  pushHistoryFromSnapshot(dragHistorySnapshot.value);

  // ★重要：vuedraggableが既に「1要素だけ」動かした後の配列（現状）
  const mutated = noteBlocks.value.slice();
  const draggedIndexNow = (draggedId != null) ? mutated.findIndex(b => b.id === draggedId) : -1;

  // 選択範囲を除いた rest を snapshot から作る（確実）
  const rest = snapshot.filter(b => !selectedIds.has(b.id));

  // 挿入位置：mutated内でドラッグ要素の直前にある「非選択要素」を探す
  let insertAt = 0;
  if (draggedIndexNow > 0) {
    let beforeId = null;
    for (let i = draggedIndexNow - 1; i >= 0; i--) {
      const id = mutated[i]?.id;
      if (id != null && !selectedIds.has(id)) {
        beforeId = id;
        break;
      }
    }
    if (beforeId == null) {
      insertAt = 0;
    } else {
      const idxInRest = rest.findIndex(b => b.id === beforeId);
      insertAt = (idxInRest === -1) ? 0 : (idxInRest + 1);
    }
  }

  // 範囲を挿入（まとめて移動）
  rest.splice(insertAt, 0, ...segment);
  noteBlocks.value = rest;

  // 選択アンカーを移動後の位置に維持
  selectionStartId.value = segment[0]?.id ?? null;
  selectionEndId.value = segment[segment.length - 1]?.id ?? null;
  awaitingEnd.value = false;

  groupDragActive.value = false;
  seqDragSnapshot.value = [];
  seqDragMeta.value = null;
  dragSelectedIds.value = [];
  dragDraggedId.value = null;
  dragHistorySnapshot.value = null;

  disableDragGroupGhost();
};
*/

// =====================================================
// ✅ 追加: 選択範囲ドラッグ中の「まとまり表示」ゴースト
// =====================================================
/*
const dragGroupGhost = ref({
  active: false,
  x: 0,
  y: 0,
  offsetX: 0,
  offsetY: 0,
  items: []
});
*/

/*
let _onWindowDragOver = null;
*/

/*
const enableDragGroupGhost = (evt, segment) => {
  const e = evt?.originalEvent;
  const rect = evt?.item?.getBoundingClientRect?.();
  const cx = e?.clientX ?? rect?.left ?? 0;
  const cy = e?.clientY ?? rect?.top ?? 0;
  const ox = rect ? (cx - rect.left) : 0;
  const oy = rect ? (cy - rect.top) : 0;

  dragGroupGhost.value = {
    active: true,
    x: cx - ox,
    y: cy - oy,
    offsetX: ox,
    offsetY: oy,
    items: segment.map(b => ({ sound: b.sound, color: b.color }))
  };

  _onWindowDragOver = (ev) => {
    if (!dragGroupGhost.value.active) return;
    ev.preventDefault?.();
    dragGroupGhost.value.x = ev.clientX - dragGroupGhost.value.offsetX;
    dragGroupGhost.value.y = ev.clientY - dragGroupGhost.value.offsetY;
  };
  window.addEventListener("dragover", _onWindowDragOver, { passive: false });
};
*/

/*
const disableDragGroupGhost = () => {
  dragGroupGhost.value.active = false;
  dragGroupGhost.value.items = [];
  if (_onWindowDragOver) {
    window.removeEventListener("dragover", _onWindowDragOver);
    _onWindowDragOver = null;
  }
};
*/

// ■ チュートリアル
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
          side: "right",
          align: 'start'
        }
      },
      {
        element: '.sequencer-wrapper',
        popover: {
          title: '作業スペース',
          description: 'ここに並べた順番で音が再生されます。ブロックの「選択」で始点→終点を指定すると範囲再生できます。',
          side: "left",
          align: 'start'
        }
      },
      {
        element: '.controls',
        popover: {
          title: 'コントロール',
          description: '「再生」は選択範囲を再生（無選択なら全体）。「複製」で選択範囲を増やせます。',
          side: "bottom",
          align: 'start'
        }
      }
    ]
  });

  tourDriver.drive();
};

onMounted(() => {
  setTimeout(() => {
    startTour();
  }, 1000);
});
</script>

<template>
  <div class="app-layout">
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
      >
        <template #item="{ element }">
          <div class="palette-item" @click="previewSound(element)">
            <span class="palette-icon">♪</span>
            <span class="palette-label">{{ element.sound }}</span>
          </div>
        </template>
      </draggable>
    </div>

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
            {{
              isLoaded
                ? (selectionInfo.has ? "▶ 選択再生" : "▶ 全再生")
                : "読み込み中..."
            }}
          </button>

          <button @click="stopSequence" class="btn-stop">
            ■ 停止
          </button>

          <button @click="exportAudio" class="btn-export" :disabled="!isLoaded">
            ⬇ 保存
          </button>

          <!-- ✅ 追加：複製＆解除 -->
          <button @click="duplicateSelection" class="btn-duplicate" :disabled="!selectionInfo.has">
            ⧉ 複製
          </button>

          <button @click="clearSelection" class="btn-clear" :disabled="!selectionInfo.has">
            選択解除
          </button>

          <!-- ✅ 追加：選択削除 -->
          <button @click="deleteSelection" class="btn-clear" :disabled="!selectionInfo.has">
            選択削除
          </button>

          <!-- ✅ 追加：Undo / Redo -->
          <button @click="undo" class="btn-clear" :disabled="undoStack.length === 0">
            ↩ Undo
          </button>
          <button @click="redo" class="btn-clear" :disabled="redoStack.length === 0">
            ↪ Redo
          </button>

          <button @click="startTour" class="btn-help">
            ? 使い方
          </button>
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
        >
          
          <template #item="{ element, index }">
            <div
              v-if="element.__isGroupProxy"
              class="music-block group-proxy"
              :class="{ active: element.isPlaying }"
              @click.stop
            >
              <span class="step-number">{{ index + 1 }}</span>
              <span class="sound-name">GROUP</span>
              <div class="group-proxy-grid">
                <div
                  v-for="it in element.__groupItems"
                  :key="it.id"
                  class="group-proxy-item"
                  :style="{ backgroundColor: it.color }"
                >
                  <span class="group-proxy-sound">{{ it.sound }}</span>
                </div>
              </div>
            </div>

            <div
              v-else
              class="music-block"
              :style="{ backgroundColor: element.color }"
              :class="{
                active: element.isPlaying,
                selected: isBlockSelected(element.id),
                'anchor-start': isStartAnchor(element.id),
                'anchor-end': isEndAnchor(element.id)
              }"
              @click="previewSound(element)"
            >
              <span class="step-number">{{ index + 1 }}</span>
              <span class="sound-name">{{ element.sound.toUpperCase() }}</span>
              <select
                :value="element.sound"
                @click.stop
                @change="setBlockSound(element.id, $event.target.value)"
              >
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="E">E</option>
                <option value="F">F</option>
                <option value="G">G</option>
                <option value="H">H</option>
              </select>
              <button class="btn-select-range" @click.stop="setRangePoint(element.id)">
                {{ getSelectBtnText(element) }}
              </button>
              <button class="btn-delete" @click.stop="removeBlock(index)">×</button>
            </div>
          </template>
        </draggable>

        <div v-if="noteBlocks.length === 0" class="empty-state">
          左のパレットから音を置いてみよう
        </div>
      </div>
    </div>


    <!-- ------------- 旧：カーソル追従の塊ゴースト（不要なのでコメントアウトで残す） -------------
    <div
      v-if="dragGroupGhost.active"
      class="drag-group-ghost"
      :style="{ left: dragGroupGhost.x + 'px', top: dragGroupGhost.y + 'px' }"
    >
      <div
        v-for="(it, i) in dragGroupGhost.items"
        :key="i"
        class="drag-group-ghost-item"
        :style="{ backgroundColor: it.color }"
      >
        <span class="drag-group-ghost-sound">{{ it.sound }}</span>
      </div>
    </div>
    ----------------------------------------------------------------------------------------------- -->
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
  gap: 10px;
  flex: 1;
  align-content: flex-start;
  width: 100%;
  min-height: 100%;
}

.empty-state {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
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

/* ✅ 追加：複製/解除ボタン */
.btn-duplicate { background-color: rgba(255,255,255,0.15); color: #fff; }
.btn-duplicate:hover { background-color: rgba(255,255,255,0.3); }
.btn-duplicate:disabled { background-color: #555; cursor: not-allowed; }

.btn-clear { background-color: rgba(255,255,255,0.08); color: #fff; }
.btn-clear:hover { background-color: rgba(255,255,255,0.2); }
.btn-clear:disabled { background-color: #555; cursor: not-allowed; }

/* ✅ 追加: シーケンサー上でもドラッグ中は縮小表示 */
.seq-chosen,
.seq-drag,
.seq-ghost {
  transform: scale(0.85);
}
.seq-ghost {
  opacity: 0.4;
}

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

/* 変更前：opacityが残って“一緒に動いてない感”が出やすい
.music-block.group-moving {
  transform: scale(0.85);
  opacity: 0.35;
}
*/

/* ✅ 変更後：ほぼ透明にして「ゴーストが一緒に動いている」印象を強める */
/*
.music-block.group-moving {
  transform: scale(0.85);
  opacity: 0.05;
  pointer-events: none;
}
*/

.drag-group-ghost {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  transform: scale(0.85);
  transform-origin: top left;
}

.drag-group-ghost-item {
  width: 90px;
  height: 90px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 6px rgba(0,0,0,0.35);
  border: 2px solid rgba(255,255,255,0.25);
}

.drag-group-ghost-sound {
  font-weight: 900;
  font-size: 1.2rem;
  color: #fff;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.5);
}

.music-block.active {
  filter: brightness(1.5);
  box-shadow: 0 0 15px #ffffff;
  border-color: #ffffff;
  transform: scale(1.05);
  z-index: 10;
}

/* ✅ 追加：選択範囲の見た目 */
.music-block.selected {
  outline: 2px solid rgba(255,255,255,0.8);
  outline-offset: 2px;
}
.music-block.anchor-start { border-color: rgba(255,255,255,0.9); }
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

/* ✅ 範囲選択ボタン */
.btn-select-range {
  position: absolute;
  bottom: 2px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  width: auto;
  padding: 0 8px;
  height: 20px;
  font-size: 10px;
  line-height: 20px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.3);
}
.btn-select-range:hover {
  background: rgba(255, 255, 255, 0.9);
  color: #333;
}

/* =====================================================
✅ 追加：選択範囲ドラッグ用「代理要素」表示
===================================================== */
.group-proxy {
  cursor: grab;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  padding-top: 6px;
  gap: 6px;
}

.group-proxy-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 6px 6px;
}

.group-proxy-item {
  width: 26px;
  height: 26px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255,255,255,0.25);
}

.group-proxy-sound {
  font-weight: 900;
  font-size: 0.75rem;
  color: #fff;
}


.item-root {
  display: inline-block; /* または display: block */
}
</style>