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
  // { id: 6, sound: 'F', color: '#555555', isPlaying: false },
  // { id: 7, sound: 'G', color: '#555555', isPlaying: false },
  // { id: 8, sound: 'H', color: '#555555', isPlaying: false },
]);

// 🔧 修正: nextId を ref にしてリアクティブ管理 → Undo時のID重複を防ぐ
const nextId = ref(9);

const isLoaded = ref(false);

const isSoundEnabled = ref(false)  // 音を出せるかどうか

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

  // チュートリアルステップ8（やり直し）
  if (tutorialStep.value === 8) {
    tutorialUndoCount.value++
    if (tutorialUndoCount.value >= 1 && tutorialRedoCount.value >= 1) advanceTutorial()
  }
};

const redo = () => {
  if (redoStack.value.length === 0) return;
  stopSequence();
  const current = snapshotState();
  const next = redoStack.value.pop();
  undoStack.value.push(current);
  restoreState(next);

  // チュートリアルステップ8（やり直し）
  if (tutorialStep.value === 8) {
    tutorialRedoCount.value++
    if (tutorialUndoCount.value >= 1 && tutorialRedoCount.value >= 1) advanceTutorial()
  }
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

const totalDurationDisplay = computed(() => {
  if (!isLoaded.value) return '0.00'
  const blocks = getBlocksForPlayOrExport()
  let duration = 0
  blocks.forEach(block => {
    if (players.has(block.sound)) {
      const p = players.player(block.sound)
      duration += p.loaded ? p.buffer.duration : 0
    }
  })
  return duration.toFixed(2)
})

const playBlocksSequentially = async (blocks) => {
  if (!isSoundEnabled.value) return  // 音が無効なら再生しない
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
  if (!isSoundEnabled.value) return  // 音が無効なら何もしない
  if (players.has(block.sound)) {
    players.player(block.sound).start();
    // 🔧 修正: hasOwnProperty チェックは不要（全ブロックが isPlaying を持つ）
    block.isPlaying = true;
    setTimeout(() => { block.isPlaying = false; }, 200);
  }
};

// ブロッククリック時の挙動（色塗りモード対応）
const onBlockClick = (block) => {
  if (isPaintMode.value) {
    setBlockColor(block.id, paintColor.value)
    return
  }
  previewSound(block)
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
  // チュートリアルステップ2（素材パレット）で完了
  if (tutorialStep.value === 2) advanceTutorial()
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

  // チュートリアルステップ6（選択ボタン）で複製完了を記録
  if (tutorialStep.value === 6) {
    tutorialDuplicateDone.value = true
    noteBlocksCountAtDuplicate.value = noteBlocks.value.length
  }
};

// 選択範囲の削除
const deleteSelection = () => {
  const info = selectionInfo.value;
  if (!info?.has) return;

  pushHistory();
  noteBlocks.value.splice(info.startIndex, info.endIndex - info.startIndex + 1);
  clearSelection();

  // チュートリアルステップ6（選択ボタン）で複製→削除が完了したら進む
  if (tutorialStep.value === 6 && tutorialDuplicateDone.value) {
    advanceTutorial()
  }
};

// 音名変更（Undo対応）
const setBlockSound = (id, newSound) => {
  const b = noteBlocks.value.find(x => x.id === id);
  if (!b || b.sound === newSound) return;

  pushHistory();
  b.sound = newSound;

  // チュートリアルステップ5（セレクトボックス）で完了
  if (tutorialStep.value === 5) advanceTutorial()
};

// 色変更（Undo対応）　ブロック上のカラーピッカー

// const colorPickerBlockId = ref(null);

// const openColorPicker = (blockId) => {
//   colorPickerBlockId.value = blockId;
// };

// const closeColorPicker = () => {
//   colorPickerBlockId.value = null;
// };


// ペイントモード
const paintColor = ref(null)
const isPaintMode = ref(false)

const startPaintMode = (color) => {
  paintColor.value = color
  isPaintMode.value = true
}

const endPaintMode = () => {
  paintColor.value = null
  isPaintMode.value = false
  // チュートリアルステップ3（カラーパレット）で完了
  if (tutorialStep.value === 3) advanceTutorial()
}

const setBlockColor = (id, newColor) => {
  const b = noteBlocks.value.find(x => x.id === id);
  if (!b || b.color === newColor) return;
  pushHistory();
  b.color = newColor;
  
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
let _singleDragPreSnapshot = null  // 単体ドラッグ用のスナップショット

const onSeqDragStart = (evt) => {
  _singleDragPreSnapshot = snapshotState()

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
    // pushHistory()
    // 単体ドラッグの場合
    if (_singleDragPreSnapshot) {
      undoStack.value.push(_singleDragPreSnapshot)  // 並び替え前の状態を積む
      if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift()
      redoStack.value = []
      _singleDragPreSnapshot = null
    }
    // チュートリアルステップ4（作業スペース）で完了
    if (tutorialStep.value === 4) advanceTutorial()
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

const isSurveyMode = ref(false)

const openSurvey = () => {
  isSurveyMode.value = true
  window.open('https://docs.google.com/forms/d/e/1FAIpQLSd4lACT6GimL9OloSUs5k7LjG8LivXz6VyGZOqIcZnLq6Sguw/viewform?usp=header', '_blank')
}

const completeSurvey = () => {
  isSurveyMode.value = false
}

// const startTour = () => {
//   const tourDriver = driver({
//     showProgress: true,
//     nextBtnText: '次へ',
//     prevBtnText: '戻る',
//     doneBtnText: '完了',
    
//     steps: [
//       // {
//       //   // element: '.s',
//       //   popover: {
//       //     // title: 'ヘルプ',
//       //     description: 'DOPP Sequencer へようこそ。',
//       //     side: "bottom", align: 'start'
//       //   }
//       // },
//       // {
//       //   // element: '.s',
//       //   popover: {
//       //     // title: 'ヘルプ',
//       //     description: '今から15分間で簡単な作曲体験をします。',
//       //     side: "bottom", align: 'start'
//       //   }
//       // },
//       {
//         element: '.sidebar',
//         popover: {
//           title: '素材パレット',
//           description: 'ここにある音（A〜H）を、右側のエリアにドラッグ＆ドロップしてください。',
//           side: "right", align: 'start'
//         }
//       },
//       // パレットの説明を追加
//       {
//         element: '.sidebar-color-section',
//         popover: {
//           title: 'カラーパレット',
//           description: '色を選んでブロックをクリックすると色を塗れます。「適用終了」ボタンで色塗りモードを解除できます。',
//           side: "right", align: 'start'
//         }
//       },
//       {
//         element: '.sequencer-wrapper',
//         popover: {
//           title: '作業スペース',
//           description: 'ここに並べた順番で音が再生されます。ドラッグで配置を変更することができます。',
//           side: "left", align: 'start'
//         }
//       },
//       {
//         element: '.selectbox',
//         popover: {
//           title: 'セレクトボックス',
//           description: 'ブロックの変更ができます。',
//           side: "left", align: 'start'
//         }
//       },
//       {
//         element: '.btn-select-range',
//         popover: {
//           title: '選択ボタン',
//           description: 'ブロックの「選択」で始点→終点を指定すると範囲選択ができます。',
//           side: "left", align: 'start'
//         }
//       },
//       {
//         element: '.controls_play',
//         popover: {
//           title: '再生と停止',
//           description: '「再生」は選択範囲（無選択なら全体）を再生。「停止」はその場で再生を停止。「保存」は選択範囲（無選択なら全体）を保存できます。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         element: '.controls_group',
//         popover: {
//           title: '複数音の選択',
//           description: '「複製」は選択範囲を複製。「選択解除」は選択を解除。「選択削除」は選択範囲を削除できます。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         element: '.controls_undo-redo',
//         popover: {
//           title: 'やり直し',
//           description: '「戻る」は一つ前の操作に戻ることができます。「進む」は「戻る」を押す前の操作に戻ることができます。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         element: '.controls_help',
//         popover: {
//           title: 'ヘルプ',
//           description: '操作方法を忘れた時はいつでもここから確認できます。',
//           side: "bottom", align: 'start'
//         }
//       },
//     ],

//   });
//   tourDriver.drive();
// };

// 試聴モード処理
const isListeningMode = ref(false)   // 試聴モード中かどうか
const listeningTimeLeft = ref(300)   // 残り秒数（5分 = 300秒）
const listeningTimer = ref(null)     // タイマーID
const showListeningWarning = ref(false)  // 1分前警告

const startListeningMode = () => {
  isSoundEnabled.value = true  // 試聴フェーズで音を有効化
  isListeningMode.value = true
  listeningTimeLeft.value = 300

  listeningTimer.value = setInterval(() => {
    listeningTimeLeft.value--

    // 残り1分で警告表示
    if (listeningTimeLeft.value === 60) {
      showListeningWarning.value = true
    }

    // 5分経過で制作開始
    if (listeningTimeLeft.value <= 0) {
      clearInterval(listeningTimer.value)
      isListeningMode.value = false
      showListeningWarning.value = false
      startPhaseTimer()  // 制作タイマー開始
    }
  }, 1000)
}

// 残り時間を「分:秒」で表示するフォーマット
const formatListeningTime = computed(() => {
  const m = Math.floor(listeningTimeLeft.value / 60).toString().padStart(2, '0')
  const s = (listeningTimeLeft.value % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

// =====================================================
// ■ 制作フェーズ管理
// =====================================================
const phaseStartTime = ref(null)   // 制作開始時刻
const currentPhase = ref(0)        // 現在のフェーズ（0=未開始）
const endTime = ref(null)          // 終了予定時刻
const phaseTimer = ref(null)       // タイマーID

const formatTime = (date) => {
  const h = date.getHours().toString().padStart(2, '0')
  const m = date.getMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

const startPhaseTimer = () => {
  const start = new Date()
  phaseStartTime.value = start
  currentPhase.value = 1
  const phaseTime = 15

  // 終了時刻 = 開始から15分後
  const end = new Date(start.getTime() + phaseTime * 60 * 1000)
  endTime.value = end

  // タイマーで経過時間を監視
  phaseTimer.value = setInterval(() => {
    const now = new Date()
    const elapsed = (now - phaseStartTime.value) / 1000 / 60  // 経過分

    if (elapsed >= phaseTime && currentPhase.value !== 4) {
      // フェーズ4: 終了時刻
      currentPhase.value = 4
      clearInterval(phaseTimer.value)
      openSurvey()
    } else if (elapsed >= phaseTime*0.8 && currentPhase.value < 3) {
      // フェーズ3: 終了3分前
      currentPhase.value = 3
    } else if (elapsed >= phaseTime*0.5 && currentPhase.value < 2) {
      // フェーズ2: 折り返し
      currentPhase.value = 2
    }
  }, 1000)  // 1秒ごとに確認
}

// チュートリアルの仕様を大幅に変更

// =====================================================
// ■ 自作チュートリアル
// =====================================================
const tutorialStep = ref(-1)  // -1=未開始
const isTutorialActive = computed(() => tutorialStep.value >= 0 && tutorialStep.value < tutorialSteps.length)

const tutorialSteps = [
  { title: null,        message: 'DOPP Sequencer へようこそ。',              type: 'next' },
  { title: null,        message: '今から15分間で簡単な作曲体験をします。',    type: 'next' },
  { title: '素材パレット',  message: 'ここにある音（A〜H）を、右側のエリアにドラッグ＆ドロップしてください。', type: 'action', target: '.sidebar' },
  { title: 'カラーパレット', message: '色を選んでブロックをクリックすると色を塗れます。', type: 'action', target: '.sidebar-color-section' },
  { title: '作業スペース',  message: 'ブロックをドラッグして順番を入れ替えてみましょう。', type: 'action', target: '.sequencer-wrapper' },
  { title: 'セレクトボックス', message: 'セレクトボックスで音を変更してみましょう。', type: 'action', target: '.selectbox' },
  { title: '選択ボタン',   message: '範囲選択して複製→削除をしてみましょう。', type: 'action', target: '.btn-select-range' },
  { title: '再生と停止',   message: '再生・停止・保存ボタンの使い方です。',   type: 'next',   target: '.controls_play' },
  { title: 'やり直し',    message: '「戻る」を1回、「進む」を1回押してみましょう。', type: 'action', target: '.controls_undo-redo' },
  { title: 'ヘルプ',     message: '操作方法を忘れた時はいつでも確認できます。', type: 'done',   target: '.controls_help' },
]

// 各ステップの完了条件を管理するフラグ
const tutorialActionDone = ref(false)

// ステップごとの進行条件チェック
const tutorialUndoCount = ref(0)
const tutorialRedoCount = ref(0)
const tutorialDuplicateDone = ref(false)
const tutorialDeleteAfterDuplicateDone = ref(false)
const noteBlocksCountAtDuplicate = ref(0)

// =====================================================
// ■ チュートリアルのハイライト処理
// =====================================================

// 現在のステップのターゲット要素にクラスを付与する
watch(tutorialStep, (newStep) => {
  // 既存のハイライトを全て解除
  document.querySelectorAll('.tutorial-highlight').forEach(el => {
    el.classList.remove('tutorial-highlight')
  })

  // 新しいターゲットにハイライトを付与
  if (newStep >= 0 && tutorialSteps[newStep]?.target) {
    const target = document.querySelector(tutorialSteps[newStep].target)
    if (target) target.classList.add('tutorial-highlight')
  }
})

const advanceTutorial = () => {
  if (tutorialStep.value < tutorialSteps.length - 1) {
    tutorialStep.value++
    tutorialActionDone.value = false
  } else {
    endTutorial()
  }
}

const endTutorial = () => {
  document.querySelectorAll('.tutorial-highlight').forEach(el => {
    el.classList.remove('tutorial-highlight')
  })
  tutorialStep.value = -1
  startListeningMode()
}

const startTutorial = () => {
  tutorialStep.value = 0
  tutorialActionDone.value = false
  tutorialUndoCount.value = 0
  tutorialRedoCount.value = 0
  tutorialDuplicateDone.value = false
  tutorialDeleteAfterDuplicateDone.value = false
}

// // チュートリアル終了後にフェーズタイマーを開始
// const startTourAndPhase = () => {
//   const tourDriver = driver({ 
//     showProgress: true,
//     nextBtnText: '次へ',
//     prevBtnText: '戻る',
//     doneBtnText: '完了',
//     allowClose: false,       // オーバーレイクリックで閉じない
//     showButtons: ['next', 'prev'],  // 閉じるボタンを非表示
//     steps: [
//       {
//         // element: '.s',
//         popover: {
//           // title: 'ヘルプ',
//           description: 'DOPP Sequencer へようこそ。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         // element: '.s',
//         popover: {
//           // title: 'ヘルプ',
//           description: '今から15分間で簡単な作曲体験をします。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         element: '.sidebar',
//         popover: {
//           title: '素材パレット',
//           description: 'ここにある音（A〜H）を、右側のエリアにドラッグ＆ドロップしてください。',
//           side: "right", align: 'start'
//         }
//       },
//       // パレットの説明を追加
//       {
//         element: '.sidebar-color-section',
//         popover: {
//           title: 'カラーパレット',
//           description: '色を選んでブロックをクリックすると色を塗れます。「適用終了」ボタンで色塗りモードを解除できます。',
//           side: "right", align: 'start'
//         }
//       },
//       {
//         element: '.sequencer-wrapper',
//         popover: {
//           title: '作業スペース',
//           description: 'ここに並べた順番で音が再生されます。ドラッグで配置を変更することができます。',
//           side: "left", align: 'start'
//         }
//       },
//       {
//         element: '.selectbox',
//         popover: {
//           title: 'セレクトボックス',
//           description: 'ブロックの変更ができます。',
//           side: "left", align: 'start'
//         }
//       },
//       {
//         element: '.btn-select-range',
//         popover: {
//           title: '選択ボタン',
//           description: 'ブロックの「選択」で始点→終点を指定すると範囲選択ができます。',
//           side: "left", align: 'start'
//         }
//       },
//       {
//         element: '.controls_play',
//         popover: {
//           title: '再生と停止',
//           description: '「再生」は選択範囲（無選択なら全体）を再生。「停止」はその場で再生を停止。「保存」は選択範囲（無選択なら全体）を保存できます。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         element: '.controls_group',
//         popover: {
//           title: '複数音の選択',
//           description: '「複製」は選択範囲を複製。「選択解除」は選択を解除。「選択削除」は選択範囲を削除できます。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         element: '.controls_undo-redo',
//         popover: {
//           title: 'やり直し',
//           description: '「戻る」は一つ前の操作に戻ることができます。「進む」は「戻る」を押す前の操作に戻ることができます。',
//           side: "bottom", align: 'start'
//         }
//       },
//       {
//         element: '.controls_help',
//         popover: {
//           title: 'ヘルプ',
//           description: '操作方法を忘れた時はいつでもここから確認できます。',
//           side: "bottom", align: 'start'
//         }
//       },
//     ],
//     onDestroyed: () => {
//       // startPhaseTimer()  // チュートリアル終了後にタイマー開始
//       startListeningMode()  // タイマーではなく試聴モードを開始
//     }
//   })  // 既存のstartTour内のtourDriverをここに移す
//   tourDriver.drive()
// }

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown)
  if (phaseTimer.value) clearInterval(phaseTimer.value)  // タイマーの後片付け
  if (listeningTimer.value) clearInterval(listeningTimer.value)  // リスニングタイマー片付け
})

onMounted(() => {
  setTimeout(() => startTutorial(), 1000);
});
</script>

<template>
  <div class="app-layout">
    <!-- アンケートオーバーレイ -->
    <div v-if="isSurveyMode" class="survey-overlay">
      <div class="survey-modal">
        <p>アンケートにご回答ください。</p>
        <p class="survey-hint">別タブでアンケートが開いています。</p>
        <button @click="completeSurvey" class="btn-survey-done">
          回答完了
        </button>
      </div>
    </div>

    <!-- 自作チュートリアルポップアップ -->
    <div v-if="isTutorialActive" class="tutorial-overlay" @click.self="null">
      <div class="tutorial-popover">
        <p v-if="tutorialSteps[tutorialStep].title" class="tutorial-title">
          {{ tutorialSteps[tutorialStep].title }}
        </p>
        <p class="tutorial-message">{{ tutorialSteps[tutorialStep].message }}</p>

        <div class="tutorial-footer">
          <span class="tutorial-progress">
            {{ tutorialStep + 1 }} / {{ tutorialSteps.length }}
          </span>
          <button
            v-if="tutorialSteps[tutorialStep].type === 'next'"
            class="tutorial-btn"
            @click="advanceTutorial"
          >
            次へ →
          </button>
          <button
            v-else-if="tutorialSteps[tutorialStep].type === 'done'"
            class="tutorial-btn"
            @click="endTutorial"
          >
            完了
          </button>
          <span
            v-else
            class="tutorial-action-hint"
          >
            操作して進んでください
          </span>
        </div>
      </div>
    </div>

    <div v-if="isListeningMode" class="listening-overlay">
      <div class="listening-modal">

        <p class="listening-title">まずは音を聴いてみましょう</p>
        <!-- <p class="listening-hint">気に入った音を見つけたら制作に活かしてみてください</p> -->

        <!-- 音ブロック一覧 -->
        <div class="listening-blocks">
          <div
            v-for="item in soundPalette"
            :key="item.sound"
            class="listening-block"
            :style="{ backgroundColor: item.color }"
            @click="previewSound(item)"
          >
            <span class="listening-block-label">{{ item.sound }}</span>
          </div>
        </div>

        <!-- 警告メッセージ -->
        <p v-if="showListeningWarning" class="listening-warning">
          ⏰ 1分後に制作が始まります
        </p>

        <!-- 残り時間 -->
        <p class="listening-timer">残り {{ formatListeningTime }}</p>

      </div>
    </div>

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

            <!-- カラーパレット -->
      <div class="sidebar-color-section">
        <h3>Color</h3>
        <input
          type="color"
          class="sidebar-color-picker"
          :value="paintColor ?? '#ffffff'"
          @change="startPaintMode($event.target.value)"
        />
        <button
          v-if="isPaintMode"
          class="btn-end-paint"
          @click="endPaintMode"
        >
          適用終了
        </button>
        <p v-if="isPaintMode" class="paint-hint">
          ブロックをクリックして色を適用
        </p>
      </div>
    </div>

    <!-- ■ メインコンテンツ -->
    <div class="main-content">
      <div class="header">
        <h1>DOPP Sequencer</h1>
        <!-- フェーズインジケーター -->
        <div v-if="currentPhase > 0" class="phase-indicator" :class="`phase-${currentPhase}`">
          <!-- フェーズ1: 制作中 -->
          <div v-if="currentPhase === 1" class="phase-display">
            <span class="phase-icon">🎵</span>
            <span class="phase-text">
              フェーズ1: 制作開始
              <span class="phase-end-time">{{ formatTime(endTime) }}まで</span>
            </span>
          </div>

          <!-- フェーズ2: 折り返し -->
          <div v-else-if="currentPhase === 2" class="phase-display">
            <span class="phase-icon">🔁</span>
            <span class="phase-text">
              フェーズ2: 折り返し地点
              <span class="phase-end-time">終了 {{ formatTime(endTime) }}　</span>
            </span>
          </div>

          <!-- フェーズ3: 仕上げ -->
          <div v-else-if="currentPhase === 3" class="phase-display">
            <span class="phase-icon">⏰</span>
            <span class="phase-text">
              フェーズ3: 仕上げの時間
              <span class="phase-end-time">終了 {{ formatTime(endTime) }}　2分後にアンケートに移ります</span>
            </span>
          </div>

          <!-- フェーズ4: 終了 -->
          <div v-else-if="currentPhase === 4" class="phase-display">
            <span class="phase-icon">💾</span>
            <span class="phase-text">お疲れ様でした！ 作品を保存してください</span>
          </div>
        </div>
        
        <div class="controls">
          <!-- 再生保存系 -->
          <div class="controls_play">
            <button
              @click="playSelectedOrAll"
              class="btn-play"
              :disabled="!isLoaded || !isSoundEnabled"
              :class="{ loading: !isLoaded }"
            >
              {{ isLoaded ? (selectionInfo.has ? "▶ 選択再生" : "▶ 全体再生") : "読み込み中..." }}
            </button>

            <button @click="stopSequence" class="btn-stop">■ 停止</button>

            <button class="duration-display">作品の長さ：{{ totalDurationDisplay }}秒</button>

            <button @click="exportAudio" class="btn-export" :disabled="!isLoaded">⬇ 保存</button>

            
          </div>

          

          <!-- 選択操作系 -->
          <div class="controls_group">
            <button @click="duplicateSelection" class="btn-duplicate" :disabled="!selectionInfo.has">
              ⧉ 複製　
            </button>

            <button @click="clearSelection" class="btn-clear" :disabled="!selectionInfo.has">
              選択解除
            </button>
          
            <button @click="deleteSelection" class="btn-clear" :disabled="!selectionInfo.has">
              選択削除
            </button>
          </div>

          <!-- undoredo操作系 -->
          <div class="controls_undo-redo">
            <button @click="undo" class="btn-undo-redo" :disabled="undoStack.length === 0">
              ↩ 戻る 
              <!-- ↩ Undo -->
            </button>

            <button @click="redo" class="btn-undo-redo" :disabled="redoStack.length === 0">
              ↪ 進む
              <!-- ↪ Redo -->
            </button>
          </div>

          <!-- help -->
          <div class="controls_help">
            <button @click="startTour" class="btn-help">? 使い方</button>
          </div>


<!-- 
          <div class="controls_survey">
            <button @click="openSurvey" class="btn-survey">
              📝 アンケート
            </button>
          </div>
 -->

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
                'paint-mode': isPaintMode,
              }"
              :style="{ backgroundColor: element.color }"
              :data-id="element.id"
              @click="onBlockClick(element)"
            > <!-- @click="previewSound(element)" -->
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
                <select class="selectbox" :value="element.sound" @click.stop @change="setBlockSound(element.id, $event.target.value)">
                  <option v-for="s in ['A','B','C','D','E','F','G','H']" :key="s" :value="s">{{ s }}</option>
                </select>
                <span class="sound-name">{{ element.sound.toUpperCase() }}</span>
                
                <button class="btn-select-range" @click.stop="setRangePoint(element.id)">{{ getSelectBtnText(element) }}</button>
                <button class="btn-delete" @click.stop="removeBlock(index)">×</button>
                <!-- <button class="btn-color" @click.stop="openColorPicker(element.id)">🎨</button> --> <!-- ブロック上のパレット -->
              </template>
            </div>
          </template>
        </draggable>

        <!-- ブロック上のカラーピッカー表示 -->
        <!-- <div v-if="colorPickerBlockId !== null"
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
        </div> -->

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
.controls { display: flex; gap: 14px; flex-wrap: wrap; }

.controls_play { display: flex; gap: 10px; }
.controls_group { display: flex; gap: 10px; }
.controls_undo-redo { display: flex; gap: 10px; }
.controls_help { display: flex; gap: 10px; }

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
button:hover { filter: brightness(1.2); }
button:active { filter: brightness(0.8); transform: translateY(2px); }
button:disabled { filter: brightness(1.0); transform: translateY(0px); color: #888; }

.btn-play { background-color: rgba(76,175,80,1.0); min-width: 112px; color: white; }
/* .btn-play:active { background-color: rgba(76,175,80,0.8); color: white; } */
.btn-play:disabled { background-color: #555; cursor: wait; }

.duration-display {
  cursor: default !important;

  background-color: rgba(255, 255, 255, 0.3);
  color: rgba(255,255,255,1.0);
  font-size: 1.00rem;
  /* align-self: center; */
  filter: none !important;
  transform: none !important;
}
.duration-display:active { background-color: rgba(255, 255, 255, 0.3);}

.btn-stop { background-color: rgba(255,71,87); color: white; }
/* .btn-stop:active { transform: translateY(2px); } */

.btn-export { background-color: #9b59b6; color: white; }
.btn-export:disabled { background-color: #555; cursor: wait; }

.btn-help {
  background-color: #7f8c8d;
  color: white;
  border-radius: 50px;
  padding: 5px 15px;
  font-size: 0.9rem;
}
/* .btn-help:hover { background-color: #95a5a6; } */

.btn-duplicate { background-color: rgba(255, 255, 255, 0.3); color: #fff; }
.btn-duplicate:hover { background-color: rgba(255,255,255,0.4); }
/* .btn-duplicate:active { background-color: rgba(255,255,255,0.2); } */
.btn-duplicate:disabled { background-color: #333; cursor: not-allowed; }

.btn-clear { background-color: rgba(255,255,255,0.3); color: #fff; }
.btn-clear:hover { background-color: rgba(255,255,255,0.4); }
/* .btn-clear:active { background-color: rgba(255,255,255,0.2); } */
.btn-clear:disabled { background-color: #333; cursor: not-allowed; }

.btn-undo-redo { background-color: rgba(255,255,255,0.3); color: #fff; padding: 10px 14px; }
.btn-undo-redo:hover { background-color: rgba(255,255,255,0.4); }
.btn-undo-redo:disabled { background-color: #333; cursor: not-allowed; }

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
  position: absolute;
  font-size: 1.2rem; font-weight: 900; color: #fff;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.5);
  margin-bottom: 5px;
  /* justify-content: center; */
}

select {
  position: absolute;
  width: 17%;
  right: 6%;
  bottom: 8%;
  font-size: 0.8rem;
  background: rgba(255,255,255,0.5); color: #333;
  border: none; border-radius: 50px;
  /* margin-bottom: 15px;  */
  cursor: pointer;
}

.btn-delete {
  position: absolute; top: 2px; right: 2px;
  background: rgba(0,0,0,0.3); color: white;
  width: 20px; height: 20px; padding: 0;
  font-size: 12px; line-height: 20px; border-radius: 50%;
}
.btn-delete::after {
  content: '';
  position: absolute;
  top: -6px; bottom: -6px;
  left: -6px; right: -6px;
}
.btn-delete:hover { background: rgba(255,0,0,0.7); }

.btn-select-range {
  position: absolute; 
  /* left: 6px; */
  bottom: 6px;
  background: rgba(255,255,255,0.2);
  color: white; width: auto;
  padding: 0 8px; height: 20px;
  font-size: 10px; line-height: 20px;
  border-radius: 50px;
  /* border-radius: 4px; */
  border: 1px solid rgba(255,255,255,0.3);
}
.btn-select-range::after {
  content: '';
  position: absolute;
  top: -8px; bottom: -8px;
  left: -8px; right: -8px;
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

/* ブロック上パレットカラー */
/*
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
*/

/*　サイドバーカラー */
.sidebar-color-section {
  margin-top: 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.sidebar-color-section h3 {
  font-size: 1.0rem;
  margin: 0;
  text-align: center;
}

.sidebar-color-picker {
  width: 60px;
  height: 60px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: none;
  padding: 0;
}

.btn-end-paint {
  background: #e74c3c;
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.75rem;
  width: 80px;
}
.btn-end-paint:hover {
  background: #c0392b;
}

.paint-hint {
  font-size: 0.65rem;
  color: #aaa;
  text-align: center;
  margin: 0;
}

/* ペイントモード中 */
.music-block.paint-mode {
  cursor: crosshair;
}

.survey-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.85);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.survey-modal {
  background: #333;
  padding: 40px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}

.survey-modal p {
  margin: 0;
  font-size: 1.1rem;
  color: white;
  font-weight: bold;
}

.survey-hint {
  font-size: 0.85rem;
  color: #aaa;
  font-weight: normal !important;
}

.btn-survey-done {
  background: #4caf50;
  color: white;
  padding: 10px 30px;
  border-radius: 4px;
}

.btn-survey {
  background: #3498db;
  color: white;
  padding: 10px 20px;
  border-radius: 4px;
}

.phase-indicator {
  display: inline-flex;
  flex-direction: row;
  align-items: center;
  font-size: 0.9rem;
  font-weight: bold;
  gap: 8px;
  padding: 8px 16px;
  margin: 16px 0px;
  border-radius: 8px;
  transition: background-color 0.5s;
}

.phase-display {
  display: flex;
  flex-direction: row;     /* アイコンとテキストを横並び */
  align-items: center;
  gap: 8px;
}

.phase-1 { background: rgba(76, 175, 80, 0.3); border: 1px solid rgba(76, 175, 80, 0.6); }
.phase-2 { background: rgba(255, 193, 7, 0.3); border: 1px solid rgba(255, 193, 7, 0.6); }
.phase-3 { background: rgba(255, 87, 34, 0.3); border: 1px solid rgba(255, 87, 34, 0.6); }
.phase-4 { background: rgba(156, 39, 176, 0.3); border: 1px solid rgba(156, 39, 176, 0.6); }

.phase-icon { 
  margin-right: 4px;
  font-size: 1.1rem;
}

.phase-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.phase-end-time {
  font-size: 0.75rem;
  color: rgba(255,255,255,0.7);
  font-weight: normal;
}

/* リスニングモード */
.listening-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.9);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.listening-modal {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  padding: 40px;
}

.listening-title {
  font-size: 1.6rem;
  font-weight: bold;
  color: white;
  margin: 0;
}

.listening-hint {
  font-size: 0.95rem;
  color: rgba(255,255,255,0.6);
  margin: 0;
}

.listening-blocks {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  justify-content: center;
}

.listening-block {
  width: 80px;
  height: 80px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 2px solid rgba(255,255,255,0.2);
  transition: transform 0.1s, filter 0.1s;
}

.listening-block:hover {
  filter: brightness(1.3);
  transform: scale(1.05);
}

.listening-block:active {
  transform: scale(0.95);
}

.listening-block-label {
  font-size: 1.8rem;
  font-weight: 900;
  color: white;
  text-shadow: 1px 1px 0 rgba(0,0,0,0.5);
}

.listening-warning {
  font-size: 1.1rem;
  color: #ff6b6b;
  font-weight: bold;
  margin: 0;
  animation: blink 1s ease-in-out infinite;
}

.listening-timer {
  font-size: 1.2rem;
  color: rgba(255,255,255,0.5);
  margin: 0;
  font-weight: bold;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* 自作チュートリアル */
.tutorial-overlay {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  z-index: 900;
  pointer-events: none;  /* オーバーレイ自体はクリックを透過 */
}

.tutorial-popover {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%);
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 12px;
  padding: 20px 24px;
  min-width: 320px;
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  pointer-events: all;  /* ポップアップ内はクリック可能 */
  z-index: 901;
}

.tutorial-title {
  font-size: 1.0rem;
  font-weight: bold;
  color: #7eb8f7;
  margin: 0 0 8px 0;
}

.tutorial-message {
  font-size: 0.95rem;
  color: white;
  margin: 0 0 16px 0;
  line-height: 1.5;
}

.tutorial-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tutorial-progress {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.4);
}

.tutorial-btn {
  background: #3498db;
  color: white;
  padding: 8px 20px;
  border-radius: 6px;
  font-size: 0.9rem;
  pointer-events: all;
}

.tutorial-btn:hover {
  background: #2980b9;
}

.tutorial-action-hint {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.5);
  font-style: italic;
}

/* ハイライト対象要素 */
.tutorial-highlight {
  position: relative;
  z-index: 950 !important;
  box-shadow: 0 0 0 4px rgba(52, 152, 219, 0.8),
              0 0 0 9999px rgba(0, 0, 0, 0.7) !important;
  border-radius: 4px;
  pointer-events: all !important;
}
</style>