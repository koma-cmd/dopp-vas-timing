<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue';
import { useLogger } from './useLogger';
import draggable from 'vuedraggable';
import * as Tone from 'tone';
import { storage } from './firebase';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { EXPERIMENT_CONFIG } from './config';

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

const noteBlocks = ref([
  { id: 1, sound: 'A', color: '#555555', isPlaying: false },
  { id: 2, sound: 'B', color: '#555555', isPlaying: false },
  { id: 3, sound: 'C', color: '#555555', isPlaying: false },
  { id: 4, sound: 'D', color: '#555555', isPlaying: false },
  { id: 5, sound: 'E', color: '#555555', isPlaying: false },
]);

const nextId = ref(9);
const isLoaded = ref(false);
const isSoundEnabled = ref(false);

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
  onload: () => { isLoaded.value = true; }
}).toDestination();

const cloneSound = (origin) => ({ ...origin, id: nextId.value++, isPlaying: false });

// =====================================================
// ■ Undo / Redo
// =====================================================
const undoStack = ref([]);
const redoStack = ref([]);
const MAX_HISTORY = EXPERIMENT_CONFIG.maxUndoHistory;

const snapshotState = () => ({
  noteBlocks: noteBlocks.value.map(b => ({ id: b.id, sound: b.sound, color: b.color, isPlaying: false })),
  selectionStartId: selectionStartId.value,
  selectionEndId: selectionEndId.value,
  awaitingEnd: awaitingEnd.value,
  nextId: nextId.value,
});

const restoreState = (s) => {
  noteBlocks.value = s.noteBlocks.map(b => ({ ...b, isPlaying: false }));
  selectionStartId.value = s.selectionStartId;
  selectionEndId.value = s.selectionEndId;
  awaitingEnd.value = s.awaitingEnd;
  nextId.value = s.nextId;
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
  if (currentTutorial.value?.id === 'undo') advanceTutorial();
  logUndoRedo('undo'); incrementOps();  // ★追加
};

const redo = () => {
  if (redoStack.value.length === 0) return;
  stopSequence();
  const current = snapshotState();
  const next = redoStack.value.pop();
  undoStack.value.push(current);
  restoreState(next);
  if (currentTutorial.value?.id === 'redo') advanceTutorial();
  logUndoRedo('redo'); incrementOps();  // ★追加
};

const onKeydown = (e) => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod) return;
  if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
};

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

const clearSelection = () => { selectionStartId.value = null; selectionEndId.value = null; awaitingEnd.value = false; };

const setRangePoint = (blockId) => {
  if (
    awaitingEnd.value && selectionStartId.value === blockId && selectionEndId.value == null) {
    clearSelection(); return;
  }
  if (selectionStartId.value == null || (selectionEndId.value != null && !awaitingEnd.value)) {
    selectionStartId.value = blockId; selectionEndId.value = null; awaitingEnd.value = true; return;
  }
  if (awaitingEnd.value) { selectionEndId.value = blockId; awaitingEnd.value = false; }
};

const getSelectBtnText = (block) => {
  if (selectionEndId.value != null && !awaitingEnd.value) {
    const info = selectionInfo.value;
    const ids = noteBlocks.value.map(b => b.id);
    const idx = ids.indexOf(block.id);
    if (idx === info.startIndex) return "始点";
    if (idx === info.endIndex) return "終点";
  }
  if (awaitingEnd.value && block.id === selectionStartId.value) return "始点✓";
  return "選択";
};

const isBlockSelected = (blockId) => {
  const info = selectionInfo.value;
  if (!info.has) return false;
  const ids = noteBlocks.value.map(b => b.id);
  const idx = ids.indexOf(blockId);
  return idx >= info.startIndex && idx <= info.endIndex;
};

const isStartAnchor = (blockId) => selectionStartId.value === blockId && blockId != null;
const isEndAnchor   = (blockId) => selectionEndId.value   === blockId && blockId != null;

watch(
  () => noteBlocks.value.map(b => b.id),
  (ids) => {
    if (groupDragActive.value) return;
    if (selectionStartId.value != null && !ids.includes(selectionStartId.value)) { clearSelection(); return; }
    if (selectionEndId.value   != null && !ids.includes(selectionEndId.value))   { selectionEndId.value = null; awaitingEnd.value = true; }
  }
);

// =====================================================
// ■ 再生 / 停止 / 書き出し
// =====================================================
const getBlocksForPlayOrExport = () => {
  const info = selectionInfo.value;
  return info.has ? noteBlocks.value.slice(info.startIndex, info.endIndex + 1) : noteBlocks.value;
};

const totalDurationDisplay = computed(() => {
  if (!isLoaded.value) return '0.00';
  const blocks = getBlocksForPlayOrExport();
  let duration = 0;
  blocks.forEach(block => {
    if (players.has(block.sound)) {
      const p = players.player(block.sound);
      duration += p.loaded ? p.buffer.duration : 0;
    }
  });
  return duration.toFixed(2);
});

const playBlocksSequentially = async (blocks) => {
  if (!isSoundEnabled.value) return;
  await Tone.start();
  if (!isLoaded.value) return;
  const now = Tone.now();
  let timeOffset = 0;
  blocks.forEach((block) => {
    const player = players.player(block.sound);
    const fileDuration = player.buffer.duration;
    player.start(now + timeOffset);
    Tone.Draw.schedule(() => { block.isPlaying = true; },  now + timeOffset);
    Tone.Draw.schedule(() => { block.isPlaying = false; }, now + timeOffset + fileDuration);
    timeOffset += fileDuration;
  });
};

const playSelectedOrAll = async () => {
  stopSequence();
  const blocks = getBlocksForPlayOrExport();
  if (!blocks.length) return;
  await playBlocksSequentially(blocks);
  const scope = selectionInfo.value.has ? 'selection' : 'all';
  logPlay(scope, blocks.map(b => b.sound));
  playCount.value++;
  // 再生時にスナップショット保存（編集なし連続再生はスキップ）
  logSequenceSnapshot(false);
  incrementOps();
};
// const playSelectedOrAll = async () => {
//   stopSequence();
//   const blocks = getBlocksForPlayOrExport();
//   if (!blocks.length) return;
//   await playBlocksSequentially(blocks);
// };

const stopSequence = () => {
  players.stopAll();
  Tone.Draw.cancel();
  noteBlocks.value.forEach(block => { block.isPlaying = false; });
  if (currentPhase.value > 0) logStop();
};
// const stopSequence = () => {
//   players.stopAll();
//   Tone.Draw.cancel();
//   noteBlocks.value.forEach(block => { block.isPlaying = false; });
// };

const previewSound = (block, source = 'block') => {
  if (!isSoundEnabled.value) return;
  Tone.start(); // リロード直後はAudioContextがsuspendedのため、クリック時に再開させる
  if (players.has(block.sound)) {
    players.player(block.sound).start();
    block.isPlaying = true;
    setTimeout(() => { block.isPlaying = false; }, 200);
  }
  if (isListeningMode.value && vasEnabled.value) openVasModal(block.sound);
  // 制作フェーズ中のみログ（試聴フェーズは除外）
  if (currentPhase.value > 0) logSoundPreview(block.sound, source);
};
// パレットアイテムのクリックは source='palette' で呼ぶ:
// template側: @click="previewSound(element, 'palette')"
// const previewSound = (block) => {
//   if (!isSoundEnabled.value) return;
//   if (players.has(block.sound)) {
//     players.player(block.sound).start();
//     block.isPlaying = true;
//     setTimeout(() => { block.isPlaying = false; }, 200);
//   }
//   if (isListeningMode.value && vasEnabled.value) openVasModal(block.sound);
// };

const onBlockClick = (block, event) => {
  // ボタン・セレクト系要素からのクリックは無視
  const ignored = event?.target?.closest(
    'button, select, .selectbox-wrapper, .selectbox-dropdown, .selectbox-trigger, .selectbox-option'
  );
  if (ignored) return;
  if (isPaintMode.value) { setBlockColor(block.id, paintColor.value); return; }
  previewSound(block);
};

// =====================================================
// ■ ブロック操作
// =====================================================
const onPaletteAdd = (evt) => {
  pushHistoryFromPreSnapshot();
  if (currentTutorial.value?.id === 'sound_palette') advanceTutorial();
  // 追加されたブロックの情報を取得
  const newIndex = evt.newIndex;
  const newBlock = noteBlocks.value[newIndex];
  if (newBlock) logBlockAdd(newBlock.id, newBlock.sound);
  incrementOps();
};

// const onPaletteAdd = () => {
//   pushHistoryFromPreSnapshot();
//   if (currentTutorial.value?.id === 'sound_palette') advanceTutorial();
// };

const palettePreSnapshot = ref(null);
const onPaletteDragStart = () => { palettePreSnapshot.value = snapshotState(); };

const pushHistoryFromPreSnapshot = () => {
  if (!palettePreSnapshot.value) return;
  undoStack.value.push(palettePreSnapshot.value);
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
  palettePreSnapshot.value = null;
};

const removeBlock = (index) => {
  const blockId = noteBlocks.value[index]?.id;
  pushHistory();
  noteBlocks.value.splice(index, 1);
  if (blockId != null) logBlockDelete([blockId]);
  incrementOps();
};
// const removeBlock = (index) => { pushHistory(); noteBlocks.value.splice(index, 1); };

const duplicateSelection = () => {
  const info = selectionInfo.value;
  if (!info.has) return;
  pushHistory();
  const segment = noteBlocks.value.slice(info.startIndex, info.endIndex + 1);
  const originalIds = segment.map(b => b.id);
  const clones = segment.map(b => ({ ...b, id: nextId.value++, isPlaying: false }));
  noteBlocks.value.splice(info.endIndex + 1, 0, ...clones);
  const newIds = clones.map(b => b.id);
  if (currentTutorial.value?.id === 'select_button') {
    tutorialDuplicateDone.value = true;
    noteBlocksCountAtDuplicate.value = noteBlocks.value.length;
  }
  logBlockDuplicate(originalIds, newIds);
  incrementOps();
};
// const duplicateSelection = () => {
//   const info = selectionInfo.value;
//   if (!info.has) return;
//   pushHistory();
//   const segment = noteBlocks.value.slice(info.startIndex, info.endIndex + 1);
//   const clones = segment.map(b => ({ ...b, id: nextId.value++, isPlaying: false }));
//   noteBlocks.value.splice(info.endIndex + 1, 0, ...clones);
//   if (currentTutorial.value?.id === 'select_button') {
//     tutorialDuplicateDone.value = true;
//     noteBlocksCountAtDuplicate.value = noteBlocks.value.length;
//   }
// };

const deleteSelection = () => {
  const info = selectionInfo.value;
  if (!info?.has) return;
  const ids = noteBlocks.value.slice(info.startIndex, info.endIndex + 1).map(b => b.id);
  pushHistory();
  noteBlocks.value.splice(info.startIndex, info.endIndex - info.startIndex + 1);
  clearSelection();
  if (currentTutorial.value?.id === 'select_button' && tutorialDuplicateDone.value) advanceTutorial();
  logBlockDelete(ids);
  incrementOps();
};
// const deleteSelection = () => {
//   const info = selectionInfo.value;
//   if (!info?.has) return;
//   pushHistory();
//   noteBlocks.value.splice(info.startIndex, info.endIndex - info.startIndex + 1);
//   clearSelection();
//   if (currentTutorial.value?.id === 'select_button' && tutorialDuplicateDone.value) advanceTutorial();
// };


const setBlockSound = (id, newSound) => {
  const b = noteBlocks.value.find(x => x.id === id);
  if (!b || b.sound === newSound) return;
  const fromSound = b.sound;
  pushHistory();
  b.sound = newSound;
  if (currentTutorial.value?.id === 'select_box') advanceTutorial();
  logSoundChange(id, fromSound, newSound);
  incrementOps();
};
// const setBlockSound = (id, newSound) => {
//   const b = noteBlocks.value.find(x => x.id === id);
//   if (!b || b.sound === newSound) return;
//   pushHistory();
//   b.sound = newSound;
//   if (currentTutorial.value?.id === 'select_box') advanceTutorial();
// };

const paintColor = ref(null);
const isPaintMode = ref(false);

const startPaintMode = (color) => {
  paintColor.value = color; isPaintMode.value = true;
  if (currentTutorial.value?.id === 'color_select') advanceTutorial();
};

const endPaintMode = () => {
  paintColor.value = null; isPaintMode.value = false;
  if (currentTutorial.value?.id === 'color_palette') advanceTutorial();
};


// =====================================================
// ■ パレット色変更モーダル（制作フェーズ）
// =====================================================
const paletteColorModalTarget = ref(null); // { sound, color }

const openPaletteColorModal = (item) => {
  // if (currentPhase.value < 1) return; // 制作フェーズ以外は無効
  paletteColorModalTarget.value = { sound: item.sound, color: item.color };
};

const closePaletteColorModal = () => {
  paletteColorModalTarget.value = null;
  if (currentTutorial.value?.id === 'closePaletteColorModal') advanceTutorial();
};

const applyPaletteColor = (color) => {
  if (!paletteColorModalTarget.value) return;
  const sound = paletteColorModalTarget.value.sound;
  // パレット自体の色を更新
  const paletteItem = soundPalette.value.find(p => p.sound === sound);
  if (paletteItem) paletteItem.color = color;
  // 作業スペース内の同じ音のブロックにも反映
  noteBlocks.value
    .filter(b => b.sound === sound && !b.colorOverridden)
    .forEach(b => { b.color = color; });
  paletteColorModalTarget.value.color = color;
};

const confirmPaletteColor = () => {
  closePaletteColorModal();
};


const setBlockColor = (id, newColor) => {
  const b = noteBlocks.value.find(x => x.id === id);
  if (!b || b.color === newColor) return;
  pushHistory();
  b.color = newColor;
  b.colorOverridden = true; // 個別上書きフラグ
};

const exportAudio = async () => {
  const blocks = getBlocksForPlayOrExport();
  if (blocks.length === 0) return alert("ブロックがありません");
  let totalDuration = 0;
  blocks.forEach(block => {
    if (players.has(block.sound)) { const p = players.player(block.sound); totalDuration += p.loaded ? p.buffer.duration : 0; }
  });
  totalDuration += 1.0;
  const buffer = await Tone.Offline(() => {
    let timeOffset = 0;
    blocks.forEach(block => {
      if (players.has(block.sound)) {
        const originalBuffer = players.player(block.sound).buffer;
        const source = new Tone.BufferSource(originalBuffer).toDestination();
        source.start(timeOffset); timeOffset += originalBuffer.duration;
      }
    });
  }, totalDuration);
  downloadWav(buffer);
};

// AudioBufferをWAV形式のBlobに変換する（ローカル保存・クラウド保存で共通利用）
const encodeWavBlob = (audioBuffer) => {
  const numOfChan = audioBuffer.numberOfChannels;
  const length = audioBuffer.length * numOfChan * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  const channels = [];
  let i, sample, offset = 0, pos = 0;
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1);
  setUint16(numOfChan); setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16);
  setUint32(0x61746164); setUint32(length - pos - 4);
  for (i = 0; i < numOfChan; i++) channels.push(audioBuffer.getChannelData(i));
  while (pos < audioBuffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos]));
      sample = (sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(44 + offset, sample, true); offset += 2;
    }
    pos++;
  }
  function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
  return new Blob([buffer], { type: "audio/wav" });
};

// 「⬇ 保存」ボタン用：参加者自身のPCにローカル保存するだけ（クラウドには送らない）
const downloadWav = (audioBuffer) => {
  const blob = encodeWavBlob(audioBuffer);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  document.body.appendChild(anchor); anchor.style = "display: none";
  anchor.href = url; anchor.download = "my_sequence.wav"; anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
};

// アンケート開始時の自動保存用：管理者のFirebase Storageへアップロードし、
// 保存先パスをFirestoreの sessions/{sessionId} ドキュメントにも記録する。
// パスは sessionId 単位で固定する（Date.now() を入れない）。
//
// 【Storageセキュリティルールとの関係】
//   ・read  : 禁止 → getDownloadURL / getMetadata はクライアントから使えない（呼ぶと unauthorized）。
//             そのため URL は取得せず、パスだけを Firestore に記録する。
//   ・update: 禁止 → 同じパスへの2回目以降のアップロードは storage/unauthorized で拒否される（先勝ち）。
//   ・create: 20MB未満 かつ contentType が audio/* のときのみ許可。
//
// 戻り値：保存済みになったら true、そうでなければ false（呼び出し側の recordingUploaded フラグ管理に使う）。
const MAX_RECORDING_BYTES = 20 * 1024 * 1024; // Storageルールの create 条件と揃える
const uploadRecordingToCloud = async (audioBuffer) => {
  const blob = encodeWavBlob(audioBuffer);
  const sid = sessionId || 'unknown_session';
  const path = `recordings/${sid}.wav`;

  // ルールの上限を超えると「unauthorized」になり、既存ファイルとの区別がつかなくなるため、事前に検出する
  if (blob.size >= MAX_RECORDING_BYTES) {
    console.error(`録音が上限(20MB)を超えているためアップロードできません: ${(blob.size / 1024 / 1024).toFixed(1)}MB`);
    return false;
  }

  try {
    await uploadBytes(storageRef(storage, path), blob, { contentType: 'audio/wav' });
  } catch (e) {
    // 上書き禁止ルールで拒否された場合：以前のアップロードが成功済みなら「保存済み」とみなす
    if (e?.code === 'storage/unauthorized' && await hasRecordingRecord()) {
      console.info('録音は保存済みのため、再送をスキップしました:', path);
      return true;
    }
    console.error('録音のクラウド保存に失敗しました:', e);
    return false;
  }

  // ここに来た時点でファイルは保存済み。Firestoreへの記録に失敗しても、ファイルは残っている。
  try {
    await logRecordingUploaded(null, path);
  } catch (e) {
    console.error('録音パスのFirestore記録に失敗しました（ファイル自体は保存済み）:', e);
  }
  return true;
};

// =====================================================
// ■ グループドラッグ
// =====================================================
const groupDragActive = ref(false);
const groupSegmentIds = ref([]);
const groupDraggedId  = ref(null);
let _gState = null;
let _singleDragPreSnapshot = null;

const onSeqDragStart = (evt) => {
  _singleDragPreSnapshot = snapshotState();
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
  groupDragActive.value = true; groupSegmentIds.value = segmentIds; groupDraggedId.value = draggedId; awaitingEnd.value = false;
  nextTick(() => {
    const segSet = new Set(segmentIds);
    evt.from.querySelectorAll('[data-id]').forEach(el => {
      const bid = Number(el.dataset.id);
      if (segSet.has(bid) && bid !== draggedId && !el.classList.contains('seq-ghost')) { el.style.display = 'none'; el.dataset.hiddenByGroup = '1'; }
    });
  });
};

const onSeqDragEnd = async (evt) => {
  document.querySelectorAll('[data-hidden-by-group]').forEach(el => { el.style.display = ''; delete el.dataset.hiddenByGroup; });
  if (!_gState) {
    if (_singleDragPreSnapshot) {
      undoStack.value.push(_singleDragPreSnapshot);
      if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
      redoStack.value = []; _singleDragPreSnapshot = null;
    }
    if (currentTutorial.value?.id === 'work_space') advanceTutorial();
    // ★ 単体移動ログ
    const draggedId = Number(evt.item?.dataset?.id);
    if (draggedId) { logBlockMove([draggedId], evt.newIndex); incrementOps(); }
    groupDragActive.value = false; groupSegmentIds.value = []; groupDraggedId.value = null;
    return;
  }
  const { segmentIds, preSnapshot } = _gState;
  const segmentSet = new Set(segmentIds);
  let prevId = null;
  let sib = evt.item?.previousElementSibling;
  while (sib) { const sid = Number(sib.dataset?.id); if (sid && !segmentSet.has(sid)) { prevId = sid; break; } sib = sib.previousElementSibling; }
  _gState = null; groupDragActive.value = false; groupSegmentIds.value = []; groupDraggedId.value = null;
  await nextTick();
  undoStack.value.push(preSnapshot);
  if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
  redoStack.value = [];
  const snap = preSnapshot.noteBlocks;
  const base = snap.filter(b => !segmentSet.has(b.id)).map(b => ({ ...b, isPlaying: false }));
  const segs = segmentIds.map(id => snap.find(b => b.id === id)).filter(Boolean).map(b => ({ ...b, isPlaying: false }));
  const insertAt = prevId === null ? 0 : (() => { const idx = base.findIndex(b => b.id === prevId); return idx === -1 ? base.length : idx + 1; })();
  base.splice(insertAt, 0, ...segs);
  noteBlocks.value = base;
  selectionStartId.value = segmentIds[0] ?? null;
  selectionEndId.value   = segmentIds[segmentIds.length - 1] ?? null;
  awaitingEnd.value = false;
  // ★ グループ移動ログ
  logBlockMove(segmentIds, insertAt); incrementOps();
};
// const onSeqDragEnd = async (evt) => {
//   document.querySelectorAll('[data-hidden-by-group]').forEach(el => { el.style.display = ''; delete el.dataset.hiddenByGroup; });
//   if (!_gState) {
//     if (_singleDragPreSnapshot) {
//       undoStack.value.push(_singleDragPreSnapshot);
//       if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
//       redoStack.value = []; _singleDragPreSnapshot = null;
//     }
//     if (currentTutorial.value?.id === 'work_space') advanceTutorial();
//     groupDragActive.value = false; groupSegmentIds.value = []; groupDraggedId.value = null;
//     return;
//   }
//   const { segmentIds, preSnapshot } = _gState;
//   const segmentSet = new Set(segmentIds);
//   let prevId = null;
//   let sib = evt.item?.previousElementSibling;
//   while (sib) { const sid = Number(sib.dataset?.id); if (sid && !segmentSet.has(sid)) { prevId = sid; break; } sib = sib.previousElementSibling; }
//   _gState = null; groupDragActive.value = false; groupSegmentIds.value = []; groupDraggedId.value = null;
//   await nextTick();
//   undoStack.value.push(preSnapshot);
//   if (undoStack.value.length > MAX_HISTORY) undoStack.value.shift();
//   redoStack.value = [];
//   const snap = preSnapshot.noteBlocks;
//   const base = snap.filter(b => !segmentSet.has(b.id)).map(b => ({ ...b, isPlaying: false }));
//   const segs = segmentIds.map(id => snap.find(b => b.id === id)).filter(Boolean).map(b => ({ ...b, isPlaying: false }));
//   const insertAt = prevId === null ? 0 : (() => { const idx = base.findIndex(b => b.id === prevId); return idx === -1 ? base.length : idx + 1; })();
//   base.splice(insertAt, 0, ...segs);
//   noteBlocks.value = base;
//   selectionStartId.value = segmentIds[0] ?? null;
//   selectionEndId.value   = segmentIds[segmentIds.length - 1] ?? null;
//   awaitingEnd.value = false;
// };

// =====================================================
// ■ カスタムドロップダウン
// =====================================================
const openDropdownId = ref(null);
const toggleDropdown = (id) => { openDropdownId.value = openDropdownId.value === id ? null : id; };
const selectSound    = (id, sound) => { setBlockSound(id, sound); openDropdownId.value = null; };
const onDocClick     = () => { openDropdownId.value = null; };

// =====================================================
// ■ VAS データ
// =====================================================
const vasLabels = [
  { key: 'high_low',     left: '軽い',     right: '重い'   },
  { key: 'strong_weak',   left: '強い',     right: '弱い'   },
  { key: 'bright_dark',    left: '明るい',  right: '暗い'  },
  { key: 'activity_temporal',     left: '動的',     right: '静的' },
  { key: 'rough_smooth', left: '粗い',     right: '滑らか' },
];

const defaultVas = () => ({ high_low: 50, strong_weak: 50, bright_dark: 50, activity_temporal: 50, rough_smooth: 50 });

const vasData = ref(
  Object.fromEntries(['A','B','C','D','E','F','G','H'].map(s => [s, defaultVas()]))
);

// VAS値（0〜100）をフォントサイズ（px）に変換するヘルパー
// left側: 値が小さいほど大きく（100-value）
// right側: 値が大きいほど大きく（value）
const vasLabelStyle = (sound, key, side) => {
  const value = vasData.value[sound]?.[key] ?? 50;
  const MIN_SIZE = 9; //9;   // 最小フォントサイズ (px)
  const MAX_SIZE = 14; //16;  // 最大フォントサイズ (px)
  
  const ratio = side === 'left'
    ? (100 - value) / 100   // 左: 値が低いほど大きい
    : value / 100;           // 右: 値が高いほど大きい
  
  const size = MIN_SIZE + ratio * (MAX_SIZE - MIN_SIZE);
  const opacity = 0.4 + ratio * 0.6; // 透明度も連動させると視認性UP

  return {
    fontSize: `${size.toFixed(1)}px`,
    opacity: opacity.toFixed(2),
    transition: 'font-size 0.2s, opacity 0.2s',
  };
};

// =====================================================
// ■ 実験条件・事前/事後アンケート
// =====================================================

// const preSurveyOpenedAt  = ref(null);
// const postSurveyOpenedAt = ref(null);

const experimentCondition = ref(null); // 'vas' | 'no_vas'
const assignedStratum = ref(null);
const vasEnabled = computed(() => experimentCondition.value === 'vas');

const isPreSurveyMode = ref(true);
const isAssigningCondition = ref(false);
const preSurveyError = ref('');
const preSurvey = ref({
  musicExperience: '', // 'yes' | 'no'
  musicExperienceTypes: [],     // ★追加: Q1-a 複数選択
  musicExperienceOther: '',     // ★追加: 「その他」の自由記述
  musicExperienceDetails: {},
  // musicExperienceYears: '', // 経験年数（任意）
  // knewElectroacoustic: null, // 1〜7
  agreeTerms: '',
});

const musicExperienceOptions = [
  { value: 'pops&rock', label: 'POPS・ロック・歌もの等' },
  { value: 'classic', label: 'クラシック・現代音楽等' },
  { value: 'dtm',         label: 'DTM(DAWを用いた制作)' },
  { value: 'eam',        label: '電子音響音楽等' },
  { value: 'ambients',      label: '録音した音・環境音などを素材とした作品制作' },
  { value: 'other',       label: 'その他' },
];

const musicExperienceCategory = [
  { value: 'individual', label: '個人' },
  { value: 'lesson', label: '授業・講義' },
  { value: 'course', label: '講座' },
  { value: 'workshop', label: 'ワークショップ' },
  { value: 'other', label: 'その他' },
];

const musicExperienceTimes = [
  { value: 'once',       label: '1回' },
  { value: 'multiple',   label: '複数回' },
  { value: 'continuous', label: '継続的' },
];

const stratum = computed(() => {
  if (preSurvey.value.musicExperience === 'yes') return 'music_experience_yes';
  if (preSurvey.value.musicExperience === 'no') return 'music_experience_no';
  return null;
});

watch(() => preSurvey.value.musicExperience, (v) => {
  if (v !== 'yes') {
    preSurvey.value.musicExperienceTypes = [];
    preSurvey.value.musicExperienceOther = '';
  }
});

watch(() => preSurvey.value.musicExperienceTypes, (types) => {
  const details = preSurvey.value.musicExperienceDetails;
  for (const g of types) {
    if (!details[g]) details[g] = { category: '', times: '' };
  }
}, { deep: true });

// const musicGenreOptions = ['ポップス', 'ロック', 'クラシック', 'EDM', 'ジャズ', 'その他'];
const postSurvey = ref({
  noRightAnswer: null,
  ownWork: null,
  selfMotivated: null,
  feltConstrained: null,
  choseToLookGood: null,
  triedVariations: null,
  fixedAfterListening: null,
  differentFromPrevious: null,
  revisedUntilEnd: null,
  soundsAsImages: null,
  shortSoundsHaveMeaning: null,
  foundPatterns: null,
  feltLikeMusic: null,
  otherSoundsAsMusic: null,
  doppExperience: null,
  workIngenuity: '',
  // VASありのみ
  usedMetaphors: null,
  metaphorsHelped: null,
  freeFormDescription: '',
});
const postSurveyItemsBase = [
  { key: 'noRightAnswer',           label: '正解を気にせずに制作できた' },
  { key: 'ownWork',                 label: '自分の作品として作っている感覚があった' },
  { key: 'selfMotivated',           label: '自分から取り組んでいる感覚があった' },
  { key: 'feltConstrained',         label: 'やり方が決まっているように感じた' },
  { key: 'choseToLookGood',         label: 'うまく作るために、良い作品に見えるようなやり方を選んだ' },
  { key: 'triedVariations',         label: '並び方を変えて、違いを確かめた' },
  { key: 'fixedAfterListening',     label: '一度聴いてみて、気になるところを直した' },
  { key: 'differentFromPrevious',   label: '直前の並びをもとにせず、別の流れになるように並び替えた' },
  { key: 'revisedUntilEnd',         label: '最後まで並べ方を見直しながら進めた' },
  { key: 'soundsAsImages',          label: '音を、イメージや意味をもつものとして捉えるようになった' },
  { key: 'shortSoundsHaveMeaning',  label: '短い音でも、作品の中で意味や役割をもつものとして捉えられるようになったと感じた' },
  { key: 'foundPatterns',           label: '作っていく中で、音の並びに自分なりのまとまりや規則性を見出した' },
  { key: 'feltLikeMusic',           label: '今回の作品を、音楽として捉えられると感じた' },
  { key: 'otherSoundsAsMusic',      label: '今回の体験を通して、さまざまな音の組み合わせも音楽として捉えられるかもしれないと感じた' },
  { key: 'doppExperience',          label: '過去に「造形デザイン演習」または「電子音響ピープルプロジェクト」などで"比喩"を用いた作品制作の指導を受けたことがありますか？', type: 'yesno' },
  { key: 'workIngenuity',           label: '作品の動きを生み出すためにどのような工夫をしましたか？', type: 'freeform', optional: true },
  { key: 'freeFormDescription',     label: 'その他、ご要望や気づいた点などご自由にご記入ください', type: 'freeform', optional: true },
];

const postSurveyItemsVas = [
  { key: 'usedMetaphors',    label: '提示された言葉（比喩）を手がかりにして制作した' },
  { key: 'metaphorsHelped',  label: '提示された言葉がアイデアを考える助けになった' },
];

const postSurveyItems = computed(() => {
  const base = postSurveyItemsBase.filter(i => i.key !== 'freeFormDescription');
  const freeForm = postSurveyItemsBase.find(i => i.key === 'freeFormDescription');
  const vas = vasEnabled.value ? postSurveyItemsVas : [];
  return [...base, ...vas, freeForm];

  // vasEnabled.value
  //   ? [...postSurveyItemsBase, ...postSurveyItemsVas]
  //   : postSurveyItemsBase
});
const postSurveyError = ref('');
const isSubmittingPostSurvey = ref(false);
const postSurveySubmitted = ref(false);

// ★ リロードを跨いで保持する「実験の進行フラグ」（localStorageの進行状態に含める）
//   surveyOpened      : 事後アンケートを開いた際のログ送信（open時刻・最終スナップショット）を開始済みか
//   recordingUploaded : 完成音源のアップロードが成功済みか
// これらが true のとき、リロード後に openSurvey の中身（ログ送信・録音生成）を再実行しない。
const surveyOpened = ref(false);
const recordingUploaded = ref(false);

const {
  sessionId,
  userId,
  totalOperations,
  incrementOps,
  touchAction,
  tutorialEndedAt,
  restoreTimers,
  setLoggingEnabled,
  assignConditionByStratum,
  logPreSurvey,
  logPostSurvey,
  logPreSurveyOpen,
  logPostSurveyOpen,
  logSessionStart,
  logTutorialEnd,
  logBlockAdd,
  logBlockMove,
  logBlockDelete,
  logSoundChange,
  logBlockDuplicate,
  logSoundPreview,
  logPlay,
  logStop,
  logUndoRedo,
  logHelpOpen,
  logSequenceSnapshot,
  logRecordingUploaded,
  hasRecordingRecord,
} = useLogger({ vasEnabled, noteBlocks, players });

const submitPreSurvey = async () => {
  preSurveyError.value = '';

  if (!preSurvey.value.musicExperience) {
    preSurveyError.value = '楽曲制作経験の有無を選択してください。';
    return;
  }
  if (preSurvey.value.musicExperience === 'yes'
      && preSurvey.value.musicExperienceTypes.length === 0) {
    preSurveyError.value = 'Q1-aで経験した内容を1つ以上選択してください。';
    return;
  }

  if (preSurvey.value.musicExperience === 'yes') {
    for (const g of preSurvey.value.musicExperienceTypes) {
      const d = preSurvey.value.musicExperienceDetails[g];
      const label = musicExperienceOptions.find(o => o.value === g)?.label;
      if (!d.category || !d.times) {
        preSurveyError.value = `Q1-a「${label}」の追加設問にも回答してください。`;
        return;
      }
    }
  }

  // if (preSurvey.value.knewElectroacoustic == null) {
  //   preSurveyError.value = '電子音響音楽の認知度を選択してください。';
  //   return;
  // }
  if (preSurvey.value.agreeTerms == 'no') {
    preSurveyError.value = '利用規約に同意してください。';
    return;
  }

    try {
    isAssigningCondition.value = true;

    // ★ 3つのフィールドをまとめて定義
    const preSurveyData = {
      musicExperience:      preSurvey.value.musicExperience,
      musicExperienceTypes: preSurvey.value.musicExperience === 'yes'
        ? [...preSurvey.value.musicExperienceTypes]
        : [],
      musicExperienceOther: preSurvey.value.musicExperienceTypes.includes('other')
        ? preSurvey.value.musicExperienceOther.trim()
        : '',
      musicExperienceDetails: preSurvey.value.musicExperience === 'yes'
        ? preSurvey.value.musicExperienceTypes.map(g => ({
            genre:     g,
            category:  preSurvey.value.musicExperienceDetails[g].category,
            frequency: preSurvey.value.musicExperienceDetails[g].times,
          }))
        : [],
      // musicExperienceYears: preSurvey.value.musicExperience === 'yes'
      //   ? (preSurvey.value.musicExperienceYears !== '' ? Number(preSurvey.value.musicExperienceYears) : null)
      //   : null,
      // knewElectroacoustic:  preSurvey.value.knewElectroacoustic,
      agreeTerms:           preSurvey.value.agreeTerms,
    };

    // ★ preSurveyData をそのまま渡す（経験年数・認知度も含む）
    const assignment = await assignConditionByStratum(stratum.value, preSurveyData);

    experimentCondition.value = assignment.condition;
    assignedStratum.value = assignment.stratum;

    // ★ logPreSurvey にも全フィールドを渡す
    await logPreSurvey({
      ...preSurveyData,
      stratum:    assignment.stratum,
      condition:  assignment.condition,
      vasEnabled: assignment.condition === 'vas',
      // response_time_ms:  Date.now() - preSurveyOpenedAt.value, 
    });

    isPreSurveyMode.value = false;
    setTimeout(() => startTutorial(), 500);
  } catch (error) {
    console.error(error);
    preSurveyError.value = '割付処理に失敗しました。通信状況を確認してもう一度お試しください。';
  } finally {
    isAssigningCondition.value = false;
  }
};

const vasModalTarget = ref(null);
const openVasModal   = (sound) => { if (vasEnabled.value) vasModalTarget.value = sound; };
const closeVasModal  = () => { vasModalTarget.value = null; };

// =====================================================
// ■ VAS 表示モード（制作フェーズ・全ブロック一括）
// =====================================================
const isVasMode   = ref(false);
const toggleVasMode = () => {
  if (!vasEnabled.value) return;
  isVasMode.value = !isVasMode.value;
};

// =====================================================
// ■ アンケート
// =====================================================
const isSurveyMode  = ref(false);

// playFrequency は再生イベントのカウントを別途 ref で持って渡してください
const playCount = ref(0);  // ← script setup に追加


// playSelectedOrAll 内でインクリメント
// playCount.value++;

// 読み込み完了(isLoaded)まで待つ。リロード直後は音声素材の読み込み前に呼ばれうるため。
const waitUntilLoaded = () => new Promise((resolve) => {
  if (isLoaded.value) { resolve(); return; }
  const stop = watch(isLoaded, (loaded) => { if (loaded) { stop(); resolve(); } });
});

// 完成音源を書き出してアップロードする。アップロード成功済みなら何もしない（冪等）。
// リロード復元時の「アンケート中に途切れたアップロードのやり直し」にも使う。
let isUploadingRecording = false;
const ensureRecordingUploaded = async () => {
  if (recordingUploaded.value || isUploadingRecording) return;
  if (noteBlocks.value.length === 0) return;
  isUploadingRecording = true;
  try {
    await waitUntilLoaded();
    const allBlocks = noteBlocks.value.slice();
    let totalDuration = 0;
    allBlocks.forEach(block => {
      if (players.has(block.sound)) {
        const p = players.player(block.sound);
        totalDuration += p.loaded ? p.buffer.duration : 0;
      }
    });
    if (totalDuration <= 0) return;
    totalDuration += 1.0;
    // 第3引数に1を指定し、素材がモノラルなことに合わせてモノラルで書き出す
    // （省略するとTone.jsの既定値であるステレオ(2ch)になり、保存容量が倍になる）
    const buffer = await Tone.Offline(() => {
      let timeOffset = 0;
      allBlocks.forEach(block => {
        if (players.has(block.sound)) {
          const originalBuffer = players.player(block.sound).buffer;
          const source = new Tone.BufferSource(originalBuffer).toDestination();
          source.start(timeOffset);
          timeOffset += originalBuffer.duration;
        }
      });
    }, totalDuration, 1);
    const ok = await uploadRecordingToCloud(buffer);
    if (ok) {
      recordingUploaded.value = true;
      persistProductionState(true);
    }
  } catch (error) {
    console.error('録音の書き出し/アップロードに失敗しました:', error);
  } finally {
    isUploadingRecording = false;
  }
};

const openSurvey = async () => {
  // メモリ上のフラグに加え、リロードを跨いで残る surveyOpened でも二重実行を防ぐ
  if (isSurveyMode.value || surveyOpened.value || postSurveySubmitted.value) return;

  // ★ 重い処理・通信より先にフラグを立て、即座にlocalStorageへ保存する。
  //   これ以降にリロードされても、ログの再送は起きない。
  surveyOpened.value = true;
  isSurveyMode.value = true;
  stopSequence();
  persistProductionState(true);

  await logPostSurveyOpen();

  // ★ 最終作品スナップショット
  await logSequenceSnapshot(true, playCount.value);

  // ★ 音声ファイルも保存（成功時のみ recordingUploaded が true になる）
  await ensureRecordingUploaded();
};

// const openSurvey    = async () => {
//   isSurveyMode.value = true;
//   window.open('https://docs.google.com/forms/d/e/1FAIpQLSd4lACT6GimL9OloSUs5k7LjG8LivXz6VyGZOqIcZnLq6Sguw/viewform?usp=header', '_blank');
//   // 全体を自動保存（選択範囲を無視して全ブロック対象）
//   if (noteBlocks.value.length > 0 && isLoaded.value) {
//     const allBlocks = noteBlocks.value;
//     let totalDuration = 0;
//     allBlocks.forEach(block => {
//       if (players.has(block.sound)) {
//         const p = players.player(block.sound);
//         totalDuration += p.loaded ? p.buffer.duration : 0;
//       }
//     });
//     if (totalDuration > 0) {
//       totalDuration += 1.0;
//       const buffer = await Tone.Offline(() => {
//         let timeOffset = 0;
//         allBlocks.forEach(block => {
//           if (players.has(block.sound)) {
//             const originalBuffer = players.player(block.sound).buffer;
//             const source = new Tone.BufferSource(originalBuffer).toDestination();
//             source.start(timeOffset);
//             timeOffset += originalBuffer.duration;
//           }
//         });
//       }, totalDuration);
//       downloadWav(buffer);
//     }
//   }
// };
const submitPostSurvey = async () => {
  postSurveyError.value = '';


  const unanswered = postSurveyItems.value.some(item => {
    if (item.optional) return false;
    const val = postSurvey.value[item.key];
    return val == null || val === '';
  });
  // const unanswered = postSurveyItems.value.some(item =>
  //   item.key !== 'freeFormDescription' && postSurvey.value[item.key] == null
  // );
  if (unanswered) {
    postSurveyError.value = '全ての項目に回答してください。';
    return;
  }

  try {
    isSubmittingPostSurvey.value = true;
    await logPostSurvey({
      ...Object.fromEntries(postSurveyItems.value.map(i => [i.key, postSurvey.value[i.key]])),
      condition: experimentCondition.value,
      vasEnabled: vasEnabled.value,
      stratum: assignedStratum.value ?? stratum.value,
      playCount: playCount.value,
      totalOperations: totalOperations.value,
      // response_time_ms:  Date.now() - postSurveyOpenedAt.value,
    });
    postSurveySubmitted.value = true;
    isSurveyMode.value = false;
    // ★ フェーズ5（自由制作）へ。ログ送信の停止は currentPhase の watch が行う。
    //   進行状態は消さず、フェーズ5として保存する → リロードしてもメイン画面が再開される。
    currentPhase.value = 5;
    persistProductionState(true);
  } catch (error) {
    console.error(error);
    postSurveyError.value = '回答の保存に失敗しました。通信状況を確認してもう一度お試しください。';
  } finally {
    isSubmittingPostSurvey.value = false;
  }
};

// =====================================================
// ■ 試聴モード
// =====================================================
const isListeningMode     = ref(false);
const listeningTimeLeft   = ref(EXPERIMENT_CONFIG.listeningTimeSeconds);
const listeningTimer      = ref(null);
const showListeningWarning = ref(false);

const startListeningMode = () => {
  isSoundEnabled.value = true; isListeningMode.value = true; listeningTimeLeft.value = EXPERIMENT_CONFIG.listeningTimeSeconds;
  listeningTimer.value = setInterval(() => {
    listeningTimeLeft.value--;
    if (listeningTimeLeft.value === EXPERIMENT_CONFIG.listeningWarningAtSeconds) showListeningWarning.value = true;
    if (listeningTimeLeft.value <= 0) { clearInterval(listeningTimer.value); isListeningMode.value = false; showListeningWarning.value = false; startPhaseTimer(); }
  }, 1000);
};

const endListeningEarly = () => {
  if (listeningTimeLeft.value > EXPERIMENT_CONFIG.listeningWarningAtSeconds && !confirm('まだ時間があります。制作フェーズに移りますか？')) return;
  clearInterval(listeningTimer.value);
  isListeningMode.value = false;
  showListeningWarning.value = false;
  // ログを残したい場合はここに追加
  // logListeningEnd?.('early');
  startPhaseTimer();
};

const formatListeningTime = computed(() => {
  const m = Math.floor(listeningTimeLeft.value / 60).toString().padStart(2, '0');
  const s = (listeningTimeLeft.value % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
});

// 試聴フェーズで設定した色をパレットに保存
const setPaletteColor = (sound, color) => {
  const item = soundPalette.value.find(p => p.sound === sound);
  if (item) item.color = color;
};

// =====================================================
// ■ 制作フェーズ管理
// =====================================================
const phaseStartTime = ref(null);
const currentPhase   = ref(0);
const endTime        = ref(null);
const phaseTimer     = ref(null);

// 制作フェーズの長さ（分）。startPhaseTimer（新規開始）とresumePhaseTimer（リロード復元）の
// 両方から参照するため、ここで一箇所にまとめておく。値自体は config.js（EXPERIMENT_CONFIG）で管理する。
const PHASE_TIME_MINUTES = EXPERIMENT_CONFIG.phaseTimeMinutes;

const formatTime = (date) => {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
};

// 経過時間に応じてフェーズ(1〜4)を進める。新規開始時・リロード復元時の両方から呼ばれる。
const runPhaseTick = () => {
  const now = new Date();
  const elapsed = (now - phaseStartTime.value) / 1000 / 60;
  if (elapsed >= PHASE_TIME_MINUTES && currentPhase.value !== 4) {
    currentPhase.value = 4; clearInterval(phaseTimer.value); openSurvey();
  } else if (elapsed >= PHASE_TIME_MINUTES * 0.8 && currentPhase.value < 3) {
    currentPhase.value = 3;
  } else if (elapsed >= PHASE_TIME_MINUTES * 0.5 && currentPhase.value < 2) {
    currentPhase.value = 2;
  }
};

const startPhaseTimer = () => {
  // ★ 試聴フェーズで設定した色を初期ブロックに反映
  noteBlocks.value.forEach(block => {
    if (block.colorOverridden) return; // 個別設定済みはスキップ
    const palette = soundPalette.value.find(p => p.sound === block.sound);
    if (palette) block.color = palette.color;
  });

  const start = new Date(); phaseStartTime.value = start; currentPhase.value = 1;
  const end = new Date(start.getTime() + PHASE_TIME_MINUTES * 60 * 1000); endTime.value = end;
  logSessionStart(vasData.value);  // ★追加
  phaseTimer.value = setInterval(runPhaseTick, 1000);
  persistProductionState(true);
};

/**
 * リロード後に制作フェーズを再開する。startPhaseTimerと違い、
 * ・Firestoreへの新規書き込み（logSessionStart等）は行わない（元セッションで記録済みのため）
 * ・phaseStartTime/endTimeは元セッションの値をそのまま引き継ぐ（時計は止めない＝経過時間は実時間ベースのまま）
 * ・オフラインだった間に持ち時間を超えていた場合は、即座にアンケート画面へ遷移する
 */
const resumePhaseTimer = (savedPhaseStartTimeMs, savedEndTimeMs) => {
  phaseStartTime.value = new Date(savedPhaseStartTimeMs);
  endTime.value = new Date(savedEndTimeMs);
  currentPhase.value = 1;
  runPhaseTick(); // 経過時間に応じて即座にフェーズを補正（すでに時間切れならここでopenSurveyへ）
  if (currentPhase.value !== 4) {
    phaseTimer.value = setInterval(runPhaseTick, 1000);
  }
};

// =====================================================
// ■ リロード復元（制作フェーズの状態をローカル保存）
//
// 対象は「制作フェーズ開始後（currentPhase >= 1）」のみ。
// 事前アンケート・チュートリアル・試聴フェーズの最中にリロードされた場合は、
// 従来通り最初（事前アンケート）からのやり直しになる（対応範囲外）。
// =====================================================
const STATE_STORAGE_KEY = `dopp_state_${sessionId}`;
let persistStateTimer = null;

const buildStateSnapshot = () => ({
  noteBlocks:          noteBlocks.value.map(b => ({ ...b, isPlaying: false })),
  soundPalette:        soundPalette.value,
  nextId:              nextId.value,
  currentPhase:        currentPhase.value,
  phaseStartTime:      phaseStartTime.value ? phaseStartTime.value.getTime() : null,
  endTime:             endTime.value ? endTime.value.getTime() : null,
  experimentCondition: experimentCondition.value,
  assignedStratum:     assignedStratum.value,
  vasData:             vasData.value,
  playCount:           playCount.value,
  totalOperations:     totalOperations.value,
  tutorialEndedAt:     tutorialEndedAt.value,
  // 実験の進行フラグ（リロード時のログ・録音の重複送信防止に使う）
  surveyOpened:        surveyOpened.value,
  recordingUploaded:   recordingUploaded.value,
  postSurveySubmitted: postSurveySubmitted.value,
  postSurvey:          postSurvey.value, // 回答途中でリロードしても入力を失わないように
  savedAt:             Date.now(),
});

/**
 * 制作フェーズの状態をlocalStorageへ保存する。
 * @param {boolean} immediate - trueの場合デバウンスせず即座に保存する（フェーズ開始直後など）
 */
const persistProductionState = (immediate = false) => {
  if (currentPhase.value < 1) return; // 制作フェーズ開始前は保存しない
  const save = () => {
    try {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(buildStateSnapshot()));
    } catch (error) {
      console.warn('進行状態のローカル保存に失敗しました:', error);
    }
  };
  clearTimeout(persistStateTimer);
  if (immediate) { save(); return; }
  persistStateTimer = setTimeout(save, 500);
};

/** 実験が完了した際、保存していた進行状態を消す（次にこのsessionIdで開いても復元させないため） */
const clearPersistedState = () => {
  try { localStorage.removeItem(STATE_STORAGE_KEY); } catch (error) { /* noop */ }
};

/**
 * 起動時に呼ぶ。保存済みの制作フェーズ状態が見つかれば復元してtrueを返す。
 * 見つからなければ何もせずfalseを返す（＝通常通り事前アンケートから開始）。
 */
const restoreProductionStateIfAny = () => {
  let saved;
  try {
    const raw = localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return false;
    saved = JSON.parse(raw);
  } catch (error) {
    console.warn('進行状態の読み込みに失敗しました:', error);
    return false;
  }
  if (!saved || !saved.currentPhase || saved.currentPhase < 1 || !saved.phaseStartTime || !saved.endTime) return false;

  // 事前アンケート・チュートリアル・試聴フェーズは通過済みとしてスキップし、制作フェーズから再開する
  isPreSurveyMode.value = false;

  if (Array.isArray(saved.noteBlocks))   noteBlocks.value   = saved.noteBlocks.map(b => ({ ...b, isPlaying: false }));
  if (Array.isArray(saved.soundPalette)) soundPalette.value = saved.soundPalette;
  if (typeof saved.nextId === 'number')  nextId.value       = saved.nextId;
  if (saved.experimentCondition)         experimentCondition.value = saved.experimentCondition;
  if (saved.assignedStratum)             assignedStratum.value     = saved.assignedStratum;
  if (saved.vasData)                     vasData.value      = saved.vasData;
  if (typeof saved.playCount === 'number')       playCount.value       = saved.playCount;
  if (typeof saved.totalOperations === 'number') totalOperations.value = saved.totalOperations;

  // useLogger内部の経過時間計算も、元セッションの時刻に合わせ直す（Firestoreへは書き込まない）
  restoreTimers({
    phaseStartedAt:  saved.phaseStartTime,
    tutorialEndedAt: saved.tutorialEndedAt ?? undefined,
  });

  // ★ リロード後は音声素材が読み込み直しになるが、試聴フェーズ(startListeningMode)を通らないため
  //   isSoundEnabled が false のままになり、再生ボタンが無効化されてしまう。復元時に有効化する。
  isSoundEnabled.value = true;

  // ★ 進行フラグの復元
  surveyOpened.value        = Boolean(saved.surveyOpened);
  recordingUploaded.value   = Boolean(saved.recordingUploaded);
  postSurveySubmitted.value = Boolean(saved.postSurveySubmitted);
  if (saved.postSurvey && typeof saved.postSurvey === 'object') {
    Object.assign(postSurvey.value, saved.postSurvey);
  }

  // ① 事後アンケート回答済み → フェーズ5（メイン画面で自由制作）。タイマーもアンケートも動かさない。
  if (postSurveySubmitted.value) {
    currentPhase.value = 5;
    return true;
  }

  // ② 制作時間は終了済み（フェーズ4）
  if (saved.currentPhase >= 4 || surveyOpened.value) {
    currentPhase.value = 4;
    if (surveyOpened.value) {
      // すでにアンケートを開いてログ送信も済んでいる：画面だけ復元し、ログは再送しない。
      // 録音のアップロードが未完了だった場合のみ、固定パスへやり直す（成功済みなら何もしない）。
      isSurveyMode.value = true;
      ensureRecordingUploaded();
    } else {
      // アンケートを開く前にリロードされていた場合のみ、通常どおり開く（初回扱い）。
      openSurvey();
    }
    return true;
  }

  // ③ 制作フェーズ中（フェーズ1〜3）
  resumePhaseTimer(saved.phaseStartTime, saved.endTime);

  return true;
};

// 保存対象となりうる状態が変化するたびに、制作フェーズ開始後であればローカル保存する
watch(
  [noteBlocks, currentPhase, soundPalette, vasData, playCount, totalOperations,
   surveyOpened, recordingUploaded, postSurveySubmitted, postSurvey],
  () => { persistProductionState(); },
  { deep: true }
);

// フェーズ5（事後アンケート完了後の自由制作）では、操作ログ・スナップショットを送信しない。
// 復元でcurrentPhaseが5にセットされた場合もこのwatchで反映される。
watch(
  currentPhase,
  (phase) => { setLoggingEnabled(phase < 5); },
  { immediate: true }
);

// =====================================================
// ■ チュートリアル
// =====================================================
const tutorialStep = ref(-1);
const currentTutorial = computed(() => {
  if (tutorialStep.value < 0 || tutorialStep.value >= tutorialSteps.length) return null;
  return tutorialSteps[tutorialStep.value];
});
const isTutorialActive = computed(() => currentTutorial.value !== null);
const isHelpMode       = ref(false);
const isHelpMenuOpen   = ref(false);

const tutorialSteps = [
  { id: 'welcome',                title: null,              message: 'DOPP Sequencer へようこそ。',                                                               type: 'next',   targets: [] },
  {                               title: null,              message: '今から15分間の簡単な作曲体験を行います。',                                                      type: 'next',   targets: [] },
  {                               title: null,              message: '体験を始める前に、まずは操作方法を覚えましょう。',                                                type: 'next',   targets: [] },
  { id: 'palette_intro',          title: '素材パレット',      message: 'ここは、素材パレットです。',                                                                 type: 'next',   targets: ['.sidebar'] },
  { id: 'closePaletteColorModal', title: '素材パレット',      message: '音をクリックするとブロックの色を変更することができます。',                                        type: 'action', targets: ['.palette-item'] },
  { id: 'sound_palette',          title: '素材パレット',      message: '音（A〜H）のいずれかを右側のエリアにドラッグ＆ドロップしてみましょう。',                            type: 'action', targets: ['.sidebar', '.sequencer-wrapper'] },
  { id: 'color_select',           title: 'カラーパレット',    message: 'ここはカラーパレットです。色を選んでブロックをクリックすると色を塗れます。',                           type: 'action', targets: ['.sidebar-color-section'] },
  { id: 'color_palette',          title: 'カラーパレット',    message: '試しにブロックに塗ってみましょう。塗り終わったら「適用終了」を押してください。',                       type: 'action', targets: ['.sidebar-color-section', '.sequencer-wrapper'] },
  { id: 'work_space',             title: '作業スペース',      message: 'ここは作業スペースです。ブロックをドラッグして順番を入れ替えてみましょう。',                           type: 'action', targets: ['.music-block', '.sequencer-wrapper'] },
  { id: 'select_box',             title: 'セレクトボックス',  message: 'セレクトボックスでブロックの音を変更することもできます。変えてみましょう。',                           type: 'action', targets: ['.selectbox-wrapper', '.sequencer-wrapper'] },
  { id: 'select_button',          title: '選択とコピー',       message: 'ブロックを2つ選択して始点と終点を指定し、その範囲を「コピー」してみましょう。同時に選択した項目を「選択削除」してみましょう。', type: 'action', targets: ['.btn-select-range', '.sequencer-wrapper', '.controls_group'] },
  { id: 'playback_intro',         title: '楽曲の再生',       message: '「再生」は選択範囲（無選択なら全体）を再生。「停止」はその場で再生を停止。「保存」は選択範囲（無選択なら全体）を保存できます。', type: 'next', targets: ['.controls_play'] },
  { id: 'undo_redo_intro',        title: 'やり直し',         message: 'これはやり直し機能です。',                                                                   type: 'next',   targets: ['.controls_undo-redo'] },
  { id: 'undo',                   title: 'やり直し',         message: '「戻る」は一つ前の操作に戻ることができます。',                                                  type: 'action', targets: ['.btn-undo'] },
  { id: 'redo',                   title: 'やり直し',         message: '「進む」は「戻る」を押す前の操作に戻ることができます。',                                          type: 'action', targets: ['.btn-redo'] },
  { id: 'help_intro',             title: 'ヘルプ',          message: '操作方法を忘れた時はいつでもここから確認できます。',                                             type: 'done',   targets: ['.controls_help'] },
];

// helpMenuItems は tutorialSteps を配列の「番号」ではなく「id」で参照する。
// こうしておくと、途中に新しいステップを挿入・削除しても対応がズレない。
const helpMenuItems = [
  { label: '素材パレット',     stepId: 'palette_intro'   },
  { label: 'カラーパレット',   stepId: 'color_select'    },
  { label: '作業スペース',    stepId: 'work_space'      },
  { label: 'セレクトボックス', stepId: 'select_box'      },
  { label: '選択とコピー',     stepId: 'select_button'   },
  { label: '楽曲の再生',     stepId: 'playback_intro'  },
  { label: 'やり直し',       stepId: 'undo_redo_intro' },
  { label: 'ヘルプボタン',    stepId: 'help_intro'      },
  { label: 'はじめから',     stepId: 'welcome'          },
];

const tutorialActionDone          = ref(false);
const tutorialDuplicateDone       = ref(false);
const noteBlocksCountAtDuplicate  = ref(0);

const clearTutorialHighlights = () => {
  document.querySelectorAll('.tutorial-focus').forEach(el => el.classList.remove('tutorial-focus'));
};

const applyTutorialHighlight = (step) => {
  clearTutorialHighlights();
  if (step < 0 || step >= tutorialSteps.length) return;
  const targets = tutorialSteps[step].targets ?? [];
  nextTick(() => {
    if (step !== tutorialStep.value) return;
    targets.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => el.classList.add('tutorial-focus'));
    });
  });
};

watch(tutorialStep, (newStep) => { applyTutorialHighlight(newStep); });

const advanceTutorial = () => {
  if (tutorialStep.value < tutorialSteps.length - 1) { tutorialStep.value++; tutorialActionDone.value = false; }
  else { endTutorial(); }
};

const endTutorial = () => {
  clearTutorialHighlights();
  tutorialStep.value = -1;
  logTutorialEnd();  // ★追加
  if (isHelpMode.value) { isHelpMode.value = false; }
  else { startListeningMode(); }
};

const startTutorial = () => {
  tutorialStep.value = 0;
  tutorialActionDone.value = false;
  tutorialDuplicateDone.value = false;
  noteBlocksCountAtDuplicate.value = 0;
};

const startTour = () => { isHelpMenuOpen.value = true; logHelpOpen(); };
// const startTour = () => { isHelpMenuOpen.value = true; };

const startTourFromStep = (stepId) => {
  const index = tutorialSteps.findIndex(step => step.id === stepId);
  if (index === -1) {
    console.warn(`[tutorial] stepId "${stepId}" に対応する tutorialSteps が見つかりません。`);
    return;
  }
  isHelpMenuOpen.value = false;
  isHelpMode.value = true;
  tutorialStep.value = index;
  tutorialActionDone.value = false;
  tutorialDuplicateDone.value = false;
};

onMounted(() => {
  // 制作フェーズ開始後にリロードされていた場合は、そこから再開する
  const resumed = restoreProductionStateIfAny();
  if (!resumed) {
    // preSurveyOpenedAt.value = Date.now();
    logPreSurveyOpen();
  }
  window.addEventListener("keydown", onKeydown);
  document.addEventListener('click', onDocClick);
  // 事前アンケート完了後に startTutorial() を呼ぶ
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  document.removeEventListener('click', onDocClick);
  if (phaseTimer.value)    clearInterval(phaseTimer.value);
  if (listeningTimer.value) clearInterval(listeningTimer.value);
  clearTutorialHighlights();
});
</script>

<template>
  <div class="app-layout">

    <!-- 事前アンケートオーバーレイ -->
    <div v-if="isPreSurveyMode" class="survey-overlay survey-overlay-front">
      <form class="survey-modal survey-modal-wide" @submit.prevent="submitPreSurvey">
        <h2 class="survey-title">事前アンケート</h2>
        <div class="survey-section">
          <p class="survey-question">Q1. これまでに、音楽を創作・制作した経験はありますか？(授業や講座、ワークショップなどの指導を含む)</p>
          <label class="survey-option">
            <input type="radio" value="yes" v-model="preSurvey.musicExperience" />
            ある
          </label>
          <label class="survey-option">
            <input type="radio" value="no" v-model="preSurvey.musicExperience" />
            ない
          </label>
<!--           
          <div v-if="preSurvey.musicExperience === 'yes'" class="survey-sub-input">
            <label class="survey-sub-label">経験年数（任意）</label>
            <input
              v-model.number="preSurvey.musicExperienceYears"
              type="number"
              min="0"
              max="99"
              placeholder="例：3"
              class="survey-number-input"
            />
            <span class="survey-unit">年</span>
          </div>
  -->
        </div>

        <div v-if="preSurvey.musicExperience === 'yes'" class="survey-section">
          <p class="survey-question">Q1-a. どのような音楽創作・制作を経験しましたか？</p>
          <div v-for="opt in musicExperienceOptions" :key="opt.value" class="survey-genre-block">
            <label class="survey-option">
              <input type="checkbox" :value="opt.value" v-model="preSurvey.musicExperienceTypes" />
              {{ opt.label }}
            </label>
            <!-- チェックされたジャンルだけ追加の2問を表示 -->
            <div v-if="preSurvey.musicExperienceTypes.includes(opt.value)" class="survey-genre-detail">

              <input
                v-if="opt.value === 'other'"
                v-model="preSurvey.musicExperienceOther"
                type="text"
                class="survey-text-input"
                placeholder="具体的にご記入ください"
              />

              <p class="survey-sub-label">どのような場での経験ですか？(1つ選択)</p>
              <label v-for="c in musicExperienceCategory" :key="c.value" class="survey-option">
                <input
                  type="radio"
                  :name="`category-${opt.value}`"
                  :value="c.value"
                  v-model="preSurvey.musicExperienceDetails[opt.value].category"
                />
                {{ c.label }}
              </label>

              <p class="survey-sub-label">経験の程度(1つ選択)</p>
              <div class="survey-inline-options">
                <label v-for="f in musicExperienceTimes" :key="f.value" class="survey-option">
                  <input
                    type="radio"
                    :name="`times-${opt.value}`"
                    :value="f.value"
                    v-model="preSurvey.musicExperienceDetails[opt.value].times"
                  />
                  {{ f.label }}
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- 
        <div class="survey-section">
          <p class="survey-question">電子音響音楽を知っていましたか？</p>
          <div class="likert-row">
            <span class="likert-edge-label">全く知らなかった</span>
            <label v-for="n in 7" :key="n" class="likert-option">
              <input type="radio" :value="n" v-model.number="preSurvey.knewElectroacoustic" />
              <span>{{ n }}</span>
            </label>
            <span class="likert-edge-label">よく知っていた</span>
          </div>
        </div> -->

        <div class="survey-section">
          <p class="survey-question">制作過程や制作された楽曲は実験に使用します。当サイトをご利用いただくには<a href="https://sites.google.com/view/composition-music-res-lab-2026" target="_blank" rel="noopener noreferrer" class="survey-link">利用規約</a>に同意していただく必要があります。</p>
          <label class="survey-option">
            <input type="radio" value="yes" v-model="preSurvey.agreeTerms" />
            同意する
          </label>
          <label class="survey-option">
            <input type="radio" value="no" v-model="preSurvey.agreeTerms" />
            同意しない
          </label>
        </div>

        <p v-if="preSurveyError" class="survey-error">{{ preSurveyError }}</p>

        <button type="submit" class="btn-survey-done" :disabled="isAssigningCondition">
          {{ isAssigningCondition ? '準備中...' : '実験を開始する' }}
        </button>
      </form>
    </div>

    <!-- 事後アンケートオーバーレイ -->
    <div v-if="isSurveyMode" class="survey-overlay survey-overlay-front">
      <form class="survey-modal survey-modal-wide" @submit.prevent="submitPostSurvey">
        <h2 class="survey-title">事後アンケート</h2>

        <div class="survey-section">
          <p class="survey-section-label">以下の項目について、あてはまる程度を選んでください。</p>

          <template v-for="(item, idx) in postSurveyItems" :key="idx">
            <div class="survey-likert-block">
              <p class="survey-question">{{ item.label }}</p>

              <!-- 自由記入フィールド -->
              <template v-if="item.type === 'freeform'">
                <textarea
                  v-model="postSurvey[item.key]"
                  class="survey-text-input"
                  rows="4"
                  placeholder="ご自由にお書きください"
                ></textarea>
              </template>
              <!--
              <template v-if="item.key === 'freeFormDescription'">
                <textarea
                  v-model="postSurvey.freeFormDescription"
                  class="survey-text-input"
                  rows="4"
                  placeholder="ご自由にお書きください"
                ></textarea>
              </template>-->

              <!-- はい/いいえ -->
              <template v-else-if="item.type === 'yesno'">
                <div class="likert-row">
                  <label class="survey-option">
                    <input type="radio" value="yes" v-model="postSurvey[item.key]" />
                    はい
                  </label>
                  <label class="survey-option">
                    <input type="radio" value="no" v-model="postSurvey[item.key]" />
                    いいえ
                  </label>
                </div>
              </template>

              <!-- 通常の Likert -->
              <template v-else>
                <div class="likert-row">
                  <span class="likert-edge-label">全くそう思わない</span>
                  <label v-for="n in 7" :key="n" class="likert-option">
                    <input type="radio" :value="n" v-model.number="postSurvey[item.key]" />
                    <span>{{ n }}</span>
                  </label>
                  <span class="likert-edge-label">とてもそう思う</span>
                </div>
              </template>

            </div>
          </template>
        </div>

        <p v-if="postSurveyError" class="survey-error">{{ postSurveyError }}</p>

        <button type="submit" class="btn-survey-done" :disabled="isSubmittingPostSurvey">
          {{ isSubmittingPostSurvey ? '送信中...' : '回答を送信する' }}
        </button>
      </form>
    </div>

    <!-- ヘルプ目次モーダル -->
    <div v-if="isHelpMenuOpen" class="help-menu-overlay" @click.self="isHelpMenuOpen = false">
      <div class="help-menu-modal">
        <p class="help-menu-title">どの操作を確認しますか？</p>
        <div class="help-menu-list">
          <button v-for="item in helpMenuItems" :key="item.stepId" class="help-menu-item" @click="startTourFromStep(item.stepId)">
            {{ item.label }}
          </button>
        </div>
        <button class="help-menu-close" @click="isHelpMenuOpen = false">閉じる</button>
      </div>
    </div>

    <!-- チュートリアル暗幕 -->
    <div v-if="isTutorialActive" class="tutorial-overlay"></div>

    <!-- チュートリアルポップアップ -->
    <div v-if="currentTutorial" class="tutorial-popover">
      <p v-if="currentTutorial.title" class="tutorial-title">{{ currentTutorial.title }}</p>
      <p class="tutorial-message">{{ currentTutorial.message }}</p>
      <div class="tutorial-footer">
        <span class="tutorial-progress">{{ tutorialStep + 1 }} / {{ tutorialSteps.length }}</span>
        <div class="tutorial-footer-buttons">
          <button v-if="isHelpMode" class="tutorial-btn-cancel" @click="endTutorial">中断</button>
          <button v-if="currentTutorial.type === 'next'" class="tutorial-btn" @click="advanceTutorial">次へ →</button>
          <button v-else-if="currentTutorial.type === 'done'" class="tutorial-btn" @click="endTutorial">完了</button>
          <span v-else class="tutorial-action-hint">操作して進んでください</span>
        </div>
      </div>
    </div>

    <!-- 試聴モードオーバーレイ -->
    <div v-if="isListeningMode" class="listening-overlay">
      <!-- VAS 入力モーダル（試聴フェーズ） -->
      <div v-if="vasEnabled && vasModalTarget" class="vas-overlay" @click.self="closeVasModal">
        <div class="vas-modal">
          <p class="vas-modal-title">Sound {{ vasModalTarget }} の印象</p>


          <!-- ★ 色設定セクションを追加 -->
          <!--
          <div class="vas-color-section">
            <p class="vas-color-label">ブロックの色</p>
            <input
              type="color"
              :value="soundPalette.find(p => p.sound === vasModalTarget)?.color ?? '#555555'"
              @input="setPaletteColor(vasModalTarget, $event.target.value)"
              class="vas-color-picker"
            />
          </div>
          -->

          <div class="vas-rows">
            <div v-for="item in vasLabels" :key="item.key" class="vas-row">
              <span class="vas-label-left" :style="vasLabelStyle(vasModalTarget, item.key, 'left')">{{ item.left }}</span>
              <input type="range" min="0" max="100" class="vas-slider"
                :value="vasData[vasModalTarget][item.key]"
                @input="vasData[vasModalTarget][item.key] = Number($event.target.value)" />
              <span class="vas-label-right" :style="vasLabelStyle(vasModalTarget, item.key, 'right')">{{ item.right }}</span>
            </div>
          </div>
          <button class="vas-close-btn" @click="closeVasModal">保存して閉じる</button>
        </div>
      </div>

      <div class="listening-modal">
        <p class="listening-title">
          {{ vasEnabled
            ? 'まずは各ブロックをクリックして音への印象を評価してみてください'
            : 'まずはじっくり音を聴いてみましょう'
          }}
        </p>
        
        <div class="listening-blocks">
          <div v-for="item in soundPalette" :key="item.sound"
               class="listening-block" style="background-color: #555555"
               @click="previewSound(item)">
            <span class="listening-block-label">{{ item.sound }}</span>
            
          </div>
        </div>
        <p class="listening-block-hint">
          {{ vasEnabled
            ? '制作フェーズではパレット下の比喩表示ボタンを活用して音のコントラストを意識してみましょう'
            : '各ブロックをクリックして音を聴いてみてください'
          }}
        </p>
        <p v-if="showListeningWarning" class="listening-warning">⏰ 約{{ Math.round(EXPERIMENT_CONFIG.listeningWarningAtSeconds / 60) }}分後に制作が始まります</p>
        <p class="listening-timer">残り {{ formatListeningTime }}</p>
        <!-- <button class="btn-start-now" @click="endListeningEarly">制作を始める →</button> -->
      </div>
    </div>

    <!-- サイト共通ヘッダー -->
    <header class="site-header">
      <h1>DOPP Sequencer</h1>
    </header>

    <div class="body-row">
    <!-- ■ サイドバー -->
    <div class="sidebar">
      <h2>Palette</h2>
      <!-- <p class="hint">Drag to right area 👉</p> -->
      <draggable v-model="soundPalette" item-key="sound" class="palette-list"
                 :group="{ name: 'music', pull: 'clone', put: false }"
                 :clone="cloneSound" :sort="false" @start="onPaletteDragStart">
        <template #item="{ element }">
          <div class="palette-item" :style="{ backgroundColor: element.color }" @click="currentPhase >= 1 ? (openPaletteColorModal(element), previewSound(element)) : openPaletteColorModal(element)">
            <span class="palette-icon">♪</span>
            <span class="palette-label">{{ element.sound }}</span>
          </div>
        </template>
      </draggable>

      <div class="sidebar-color-section">
        <h3>Color</h3>
        <input type="color" class="sidebar-color-picker" :value="paintColor ?? '#ffffff'" @change="startPaintMode($event.target.value)" />
        <button v-if="isPaintMode" class="btn-end-paint" @click="endPaintMode">適用終了</button>
        <p v-if="isPaintMode" class="paint-hint">ブロックをクリックして色を適用</p>
      </div>

      <div v-if="vasEnabled" class="sidebar-vas-section">
        <h3>比喩</h3>
        <button class="btn-vas-mode" :class="{ active: isVasMode }" @click="toggleVasMode" :disabled="currentPhase === 0">
          {{ isVasMode ? '解除' : '表示' }}
        </button>
        <p v-if="currentPhase === 0" class="vas-hint">制作開始後に使えます</p>
      </div>
    </div>

    <!-- パレット色変更モーダル（制作フェーズ） -->
    <div v-if="paletteColorModalTarget" class="palette-color-overlay" @click.self="closePaletteColorModal">
      <div class="palette-color-modal">
        <p class="palette-color-title">Sound {{ paletteColorModalTarget.sound }} の色を変更</p>
        <div class="palette-color-preview" :style="{ backgroundColor: paletteColorModalTarget.color }">
          <span class="palette-color-preview-label">{{ paletteColorModalTarget.sound }}</span>
        </div>
        <input
          type="color"
          :value="paletteColorModalTarget.color"
          @input="applyPaletteColor($event.target.value)"
          class="palette-color-picker"
        />
        <p class="palette-color-hint">同じ音のブロック全てに適用されます</p>
        <button class="palette-color-confirm" @click="confirmPaletteColor">確定</button>
      </div>
    </div>

    <!-- ■ メインコンテンツ -->
    <div class="main-content">
      <div class="content-toolbar">
        <div v-if="currentPhase > 0" class="phase-indicator" :class="`phase-${currentPhase}`">
          <div v-if="currentPhase === 1" class="phase-display">
            <span class="phase-icon">🎵</span>
            <span class="phase-text">フェーズ1: {{ vasEnabled ? '制作開始　音のコントラストを意識しましょう！' : '制作開始' }}<span class="phase-end-time">{{ formatTime(endTime) }}まで</span></span>
          </div>
          <div v-else-if="currentPhase === 2" class="phase-display">
            <span class="phase-icon">🔁</span>
            <span class="phase-text">フェーズ2: {{ vasEnabled ? '折り返し地点　音のコントラストを意識しましょう！' : '折り返し地点' }}<span class="phase-end-time">終了 {{ formatTime(endTime) }}</span></span>
          </div>
          <div v-else-if="currentPhase === 3" class="phase-display">
            <span class="phase-icon">⏰</span>
            <span class="phase-text">フェーズ3: {{ vasEnabled ? '仕上げの時間　音のコントラストを意識しましょう！' : '仕上げの時間' }}<span class="phase-end-time">終了 {{ formatTime(endTime) }}　2分後にアンケートに移ります</span></span>
          </div>
          <div v-else-if="currentPhase === 4" class="phase-display">
            <span class="phase-icon">💾</span>
            <span class="phase-text">お疲れ様でした！ 作品を保存してください</span>
          </div>
          <div v-else-if="currentPhase === 5" class="phase-display">
            <span class="phase-icon">🎧</span>
            <span class="phase-text">ご協力ありがとうございました。引き続き自由に制作できます<span class="phase-end-time">作品は「⬇ 保存」から保存できます</span></span>
          </div>
        </div>
        <div class="controls">
          <div class="controls_play">
            <button @click="playSelectedOrAll" class="btn-play" :disabled="!isLoaded || !isSoundEnabled">
              {{ isLoaded ? (selectionInfo.has ? "▶ 選択再生" : "▶ 全体再生") : "読み込み中..." }}
            </button>
            <button @click="stopSequence" class="btn-stop">■ 停止</button>
            <button class="duration-display">作品の長さ：{{ totalDurationDisplay }}秒</button>
            <button @click="exportAudio" class="btn-export" :disabled="!isLoaded">⬇ 保存</button>
          </div>
          <div class="controls_group">
            <button @click="duplicateSelection" class="btn-duplicate" :disabled="!selectionInfo.has">⧉ コピー</button>
            <button @click="clearSelection"     class="btn-clear"     :disabled="!selectionInfo.has">☐ 解除</button>
            <button @click="deleteSelection"    class="btn-clear"     :disabled="!selectionInfo.has">✕ 選択削除</button>
          </div>
          <div class="controls_undo-redo">
            <button @click="undo" class="btn-undo" :disabled="undoStack.length === 0">↩ 戻る</button>
            <button @click="redo" class="btn-redo" :disabled="redoStack.length === 0">↪ 進む</button>
          </div>
          <div class="controls_help">
            <button @click="startTour" class="btn-help">? 使い方</button>
          </div>
        </div>
      </div>

      <div class="sequencer-wrapper">
        <draggable v-model="noteBlocks" item-key="id" class="block-list" animation="200" group="music"
                   ghost-class="seq-ghost" chosen-class="seq-chosen" drag-class="seq-drag"
                   @start="onSeqDragStart" @end="onSeqDragEnd" @add="onPaletteAdd">
          <template #item="{ element, index }">
            <div
              class="music-block"
              :class="{
                active:           element.isPlaying,
                selected:         isBlockSelected(element.id),
                'anchor-start':   isStartAnchor(element.id),
                'anchor-end':     isEndAnchor(element.id),
                'group-member':   groupDragActive && groupSegmentIds.includes(element.id),
                'is-group-proxy': groupDragActive && groupDraggedId === element.id,
                'paint-mode':     isPaintMode,
                'vas-mode':       vasEnabled && isVasMode,
              }"
              :style="{ backgroundColor: element.color }"
              :data-id="element.id"
              @click="onBlockClick(element, $event); setRangePoint(element.id)"
              
              
            >
              <span class="step-number">{{ index + 1 }}</span>

              <template v-if="groupDragActive && groupDraggedId === element.id">
                <span class="sound-name">GROUP</span>
                <div class="proxy-chips">
                  <div v-for="seg in noteBlocks.filter(b => groupSegmentIds.includes(b.id))" :key="seg.id"
                       class="proxy-chip" :style="{ backgroundColor: seg.color }">
                    <span>{{ seg.sound }}</span>
                  </div>
                </div>
              </template>

              <template v-else>
                <!-- ========== VAS 表示モード ========== -->
                <template v-if="vasEnabled && isVasMode">
                  <span class="sound-name sound-name--vas">{{ element.sound.toUpperCase() }}</span>
                  <div class="vas-bars">
                    <div v-for="item in vasLabels" :key="item.key" class="vas-bar-row">
                      <span class="vas-bar-label-left" :style="vasLabelStyle(element.sound, item.key, 'left')">{{ item.left }}</span>
                      <div class="vas-bar-track-wrap">
                        <div class="vas-bar-track">
                          <div class="vas-bar-fill" :style="{ width: vasData[element.sound][item.key] + '%' }">
                            <div class="vas-bar-thumb"></div>
                          </div>
                        </div>
                      </div>
                      <span class="vas-bar-label-right" :style="vasLabelStyle(element.sound, item.key, 'right')">{{ item.right }}</span>
                    </div>
                  </div>
                  <!-- VASモード中もボタン類をすべて表示 -->
                  <div class="selectbox-wrapper" @click.stop>
                    <button class="selectbox-trigger" @click.stop="toggleDropdown(element.id)">▼</button>
                    <div v-if="openDropdownId === element.id" class="selectbox-dropdown">
                      <button v-for="s in ['A','B','C','D','E','F','G','H']" :key="s"
                              class="selectbox-option" :class="{ 'is-selected': element.sound === s }"
                              @click="selectSound(element.id, s)">{{ s }}</button>
                    </div>
                  </div>
                  <!-- <button class="btn-select-range" @click.stop="setRangePoint(element.id)">{{ getSelectBtnText(element) }}</button> -->
                  <button class="btn-delete" @click.stop="removeBlock(index)">×</button>
                </template>


                <!-- ========== 通常表示モード ========== -->
                <template v-else>
                  <span class="sound-name">{{ element.sound.toUpperCase() }}</span>
                  <div class="selectbox-wrapper" @click.stop>
                    <button class="selectbox-trigger" @click.stop="toggleDropdown(element.id)">▼</button>
                    <div v-if="openDropdownId === element.id" class="selectbox-dropdown">
                      <button v-for="s in ['A','B','C','D','E','F','G','H']" :key="s"
                              class="selectbox-option" :class="{ 'is-selected': element.sound === s }"
                              @click="selectSound(element.id, s)">{{ s }}</button>
                    </div>
                  </div>
                  <!-- <button class="btn-select-range" @click.stop="setRangePoint(element.id)">{{ getSelectBtnText(element) }}</button> -->
                  <button class="btn-delete" @click.stop="removeBlock(index)">×</button>
                </template>
              </template>
            </div>
          </template>
        </draggable>
        <div v-if="noteBlocks.length === 0" class="empty-state">左のパレットから音を置いてみよう</div>
      </div>
    </div>
    </div>
  </div>
</template>

<style scoped>
.app-layout { display: flex; flex-direction: column; height: 100vh; background-color: #222; color: white; font-family: sans-serif; overflow: hidden; }

/* =====================================================
   サイト共通ヘッダー
   ===================================================== */
.site-header {
  flex-shrink: 0;
  width: 100%;
  box-sizing: border-box;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #2a2a2a;
  border-bottom: 1px solid #444;
}
.site-header h1 { margin: 0; font-size: 1.4rem; font-weight: 700; text-align: left; }

.body-row { display: flex; flex: 1; min-height: 0; overflow: hidden; }

/* =====================================================
   サイドバー
   ===================================================== */
.sidebar { width: 120px; background-color: #2d2d2d; padding: 20px 10px; border-right: 1px solid #444; display: flex; flex-direction: column; overflow-y: auto; }
.sidebar h2 { font-size: 1.2rem; padding: 5px; text-align: center; } /* margin-bottom: 5px; */ 
.hint { font-size: 0.7rem; color: #aaa; text-align: center; margin-bottom: 20px; }
.palette-list { display: flex; flex-direction: column; gap: 10px; align-items: center; }
.palette-item { width: 80px; height: 60px; background-color: #444; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: grab; border: 1px solid #555; transition: transform 0.1s, background-color 0.1s; }
.palette-item:hover { background-color: #555; }
.palette-item:active { cursor: grabbing; transform: scale(0.95); }
.palette-icon { font-size: 1.2rem; margin-bottom: 2px; }
.palette-label { font-size: 1.0rem; font-weight: bold; }

.sidebar-color-section { margin-top: 20px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.sidebar-color-section h3 { font-size: 1.0rem; margin: 0; text-align: center; }
.sidebar-color-picker { width: 60px; height: 60px; border: none; border-radius: 8px; cursor: pointer; background: none; padding: 0; }
.btn-end-paint { background: #e74c3c; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; width: 80px; }
.btn-end-paint:hover { background: #c0392b; }
.paint-hint { font-size: 0.65rem; color: #aaa; text-align: center; margin: 0; }

.sidebar-vas-section { margin-top: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.sidebar-vas-section h3 { font-size: 1.0rem; margin: 0; text-align: center; }
.btn-vas-mode { background: rgba(255,255,255,0.15); color: white; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; width: 80px; transition: background 0.15s; border: 1px solid transparent; }
.btn-vas-mode:hover { background: rgba(255,255,255,0.25); filter: none; }
.btn-vas-mode.active { background: rgba(126,184,247,0.25); border-color: rgba(126,184,247,0.6); color: #7eb8f7; }
.btn-vas-mode:disabled { opacity: 0.35; cursor: not-allowed; }
.vas-hint { font-size: 0.62rem; color: #888; text-align: center; margin: 0; line-height: 1.3; }

/* =====================================================
   パレット色変更モーダル（制作フェーズ）
   ===================================================== */
.palette-color-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.75);
  z-index: 1200;
  display: flex; align-items: center; justify-content: center;
}
.palette-color-modal {
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 14px;
  padding: 28px 32px;
  min-width: 240px;
  display: flex; flex-direction: column;
  align-items: center; gap: 18px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}
.palette-color-title {
  font-size: 1.05rem; font-weight: bold;
  color: #7eb8f7; margin: 0; text-align: center;
}
.palette-color-preview {
  width: 80px; height: 80px;
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid rgba(255,255,255,0.2);
  transition: background-color 0.15s;
}
.palette-color-preview-label {
  font-size: 2rem; font-weight: 900;
  color: white; text-shadow: 1px 1px 0 rgba(0,0,0,0.5);
}
.palette-color-picker {
  width: 72px; height: 72px;
  border: none; border-radius: 10px;
  cursor: pointer; background: none; padding: 0;
}
.palette-color-hint {
  font-size: 0.78rem; color: rgba(255,255,255,0.5);
  margin: 0; text-align: center;
}
.palette-color-confirm {
  background: #3498db; color: white;
  padding: 10px 28px; border-radius: 8px; font-size: 0.95rem;
}
.palette-color-confirm:hover { filter: brightness(1.2); }

/* =====================================================
   メインコンテンツ
   ===================================================== */
.main-content { flex: 1; padding: 20px; display: flex; flex-direction: column; overflow-y: auto; }
.content-toolbar { margin-bottom: 20px; }
.controls { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
.controls_play      { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.controls_group     { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.controls_undo-redo { display: flex; gap: 10px; flex-wrap: wrap; align-items: center;  }
.controls_help      { display: flex; gap: 10px; align-items: center; }

.sequencer-wrapper { background-color: #333; padding: 20px; border-radius: 8px; flex: 1; min-height: 300px; display: flex; flex-direction: column; position: relative; overflow-y: auto; }
.block-list { display: flex; flex-wrap: wrap; gap: 30px 10px; flex: 1; align-content: flex-start; width: 100%; min-height: 100%; }
.empty-state { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #666; font-weight: bold; border: 2px dashed #444; border-radius: 8px; box-sizing: border-box; pointer-events: none; }

/* =====================================================
   ボタン共通
   ===================================================== */
button { cursor: pointer; border: none; padding: 10px 20px; border-radius: 4px; font-weight: bold; white-space: nowrap; }
button:hover { filter: brightness(1.2); }
button:active { filter: brightness(0.8); transform: translateY(2px); }
button:disabled { filter: brightness(1.0); transform: translateY(0px); color: #888; }

.btn-play { background-color: rgba(76,175,80,1.0); min-width: 112px; color: white; }
.btn-play:disabled { background-color: #555; cursor: wait; }
.duration-display { cursor: default !important; background-color: rgba(255,255,255,0.3); color: rgba(255,255,255,1.0); /* font-size: 1.00rem;*/ filter: none !important; transform: none !important; }
.duration-display:active { background-color: rgba(255,255,255,0.3); }
.btn-stop    { background-color: rgba(255,71,87,1.0); color: white; }
.btn-export  { background-color: #9b59b6; color: white; }
.btn-export:disabled { background-color: #555; cursor: wait; }
.btn-help    { background-color: #7f8c8d; color: white; border-radius: 50px; /* padding: 5px 15px;*//* font-size: 0.9rem;*/ }
.btn-duplicate { background-color: rgba(255,255,255,0.3); color: #fff; }
.btn-duplicate:hover { background-color: rgba(255,255,255,0.4); }
.btn-duplicate:disabled { background-color: #333; cursor: not-allowed; }
.btn-clear { background-color: rgba(255,255,255,0.3); color: #fff; }
.btn-clear:hover { background-color: rgba(255,255,255,0.4); }
.btn-clear:disabled { background-color: #333; cursor: not-allowed; }
.btn-undo { background-color: rgba(255,255,255,0.3); color: #fff; padding: 10px 14px; }
.btn-undo:hover { background-color: rgba(255,255,255,0.4); }
.btn-undo:disabled { background-color: #333; cursor: not-allowed; }
.btn-redo { background-color: rgba(255,255,255,0.3); color: #fff; padding: 10px 14px; }
.btn-redo:hover { background-color: rgba(255,255,255,0.4); }
.btn-redo:disabled { background-color: #333; cursor: not-allowed; }

/* =====================================================
   音ブロック
   ===================================================== */
.seq-chosen, .seq-drag, .seq-ghost { transform: scale(0.85); }
.seq-ghost { opacity: 0.4; }


.music-block {
  width: 160px;
  height: 160px;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  cursor: grab;
  position: relative;
  box-shadow: 0 4px 6px rgba(0,0,0,0.3);
  border: 2px solid rgba(255,255,255,0.1);
  transition: transform 0.1s, filter 0.1s, box-shadow 0.1s, outline 0.1s;
}

.music-block.active       { filter: brightness(1.5); box-shadow: 0 0 15px #ffffff; border-color: #ffffff; transform: scale(1.05); z-index: 10; }
.music-block.selected     { outline: 2px solid rgba(255,255,255,0.8); outline-offset: 2px; }
.music-block.anchor-start,
.music-block.anchor-end   { border-color: rgba(255,255,255,0.9); }
.music-block.group-member { outline: 2px solid rgba(255,200,0,0.85); outline-offset: 2px; opacity: 0.35; pointer-events: none; }
.music-block.is-group-proxy { background: #3a3a3a !important; border: 2px dashed rgba(255,255,255,0.7) !important; justify-content: center; /* padding-top: 28px; */ }
.music-block.paint-mode   { cursor: crosshair; }

.step-number { position: absolute; top: 4px; left: 6px; font-size: 0.8rem; font-weight: bold; color: rgba(255,255,255,0.5); }
.sound-name { font-size: 1.2rem; font-weight: 900; color: #fff; text-shadow: 1px 1px 0 rgba(0,0,0,0.5); }
.sound-name--vas { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); font-size: 1.0rem; white-space: nowrap; }

.proxy-chips { display: flex; flex-wrap: wrap; gap: 3px; justify-content: center; padding: 2px; }
.proxy-chip  { width: 20px; height: 20px; border-radius: 3px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.35); }
.proxy-chip span { font-weight: 900; font-size: 0.6rem; color: #fff; }

/* =====================================================
   カスタムドロップダウン
   ===================================================== */
.selectbox-wrapper {
  position: absolute !important;
  right: 6%;
  bottom: 4%;
}

.selectbox-trigger {
  background: rgba(255,255,255,0.5);
  color: #333;
  border: none;
  border-radius: 50px;
  width: 22px;
  height: 18px;
  font-size: 7px;
  padding: 0;
  line-height: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.selectbox-trigger::after { content: ''; position: absolute; top: -6px; bottom: -10px; left: -6px; right: -10px; }
.selectbox-trigger:hover { background: rgba(255,255,255,0.85); filter: none; }

.selectbox-dropdown {
  position: absolute;
  bottom: calc(100% + 4px);
  right: 0;
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.25);
  border-radius: 6px;
  z-index: 200;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-width: 56px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.6);
}

.selectbox-option {
  background: transparent;
  color: #fff;
  border: none;
  border-bottom: 0.5px solid rgba(255,255,255,0.1);
  border-right: 0.5px solid rgba(255,255,255,0.1);
  padding: 5px 4px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: center;
}
.selectbox-option:nth-child(2n)        { border-right: none; }
.selectbox-option:nth-last-child(-n+2) { border-bottom: none; }
.selectbox-option:hover                { background: rgba(255,255,255,0.15); filter: none; }
.selectbox-option.is-selected          { background: rgba(255,255,255,0.25); }

/* =====================================================
   選択・削除ボタン
   ===================================================== */
.btn-delete { position: absolute; top: 2px; right: 2px; background: rgba(0,0,0,0.3); color: white; width: 20px; height: 20px; padding: 0; font-size: 12px; line-height: 20px; border-radius: 50%; }
.btn-delete::after { content: ''; position: absolute; top: -6px; bottom: -6px; left: -6px; right: -6px; }
.btn-delete:hover { background: rgba(255,0,0,0.7); }

/* .btn-select-range { position: absolute !important; bottom: 3%; background: rgba(255,255,255,0.2); color: white; width: auto; padding: 0 8px; height: 20px; font-size: 10px; line-height: 20px; border-radius: 50px; border: 1px solid rgba(255,255,255,0.3); } */
/* .btn-select-range::after { content: ''; position: absolute; top: -8px; bottom: -8px; left: -8px; right: -8px; } */
/* .btn-select-range:hover { background: rgba(255,255,255,0.9); color: #333; filter: none; } */

/* =====================================================
   VAS バー表示（制作フェーズ）
   ===================================================== */

/*
  .vas-bars：ブロック全体を覆う絶対配置コンテナ。
  上部パディング = 音名ラベル分、下部 = 削除ボタン分を避ける。
*/
.vas-bars {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 10px;
  padding: 32px 10px 28px;
  box-sizing: border-box;
}

/*
  1行 = 左ラベル ─── トラック ─── 右ラベル の横一列レイアウト。
  ラベルは flex-shrink:0 で固定幅、トラックは flex:1 で残り幅をすべて占有。
  → 全項目のトラック幅が完全に統一される。
*/
/* 変更後 */
.vas-bar-row {
  position: relative;      /* ラベルのabsolute基準 */
  width: 50%;
  height: 11px;
  flex-shrink: 0;
}

.vas-bar-label-left,
.vas-bar-label-right {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: rgba(255,255,255,0.65);
  white-space: nowrap;
  line-height: 1;
  pointer-events: none;
}

.vas-bar-label-left  { right: calc(100% + 4px); }  /* トラック左端の外側 */
.vas-bar-label-right { left:  calc(100% + 4px); }  /* トラック右端の外側 */

.vas-bar-track-wrap {
  width: 100%;      /* 親(.vas-bar-row)の幅いっぱい・ラベルと無関係 */
  height: 11px;
  display: flex;
  align-items: center;
}

.vas-bar-track {
  width: 100%;
  height: 3px;
  background: rgba(255,255,255,0.25);
  border-radius: 3px;
  overflow: visible;
  position: relative;
}

.vas-bar-fill {
  height: 100%;
  background: rgba(255,255,255,0.75);
  border-radius: 3px;
  position: relative;
}

/* つまみ：バー右端に追従、読み取り専用 */
.vas-bar-thumb {
  position: absolute;
  top: 50%;
  right: 0;
  width: 9px;
  height: 9px;
  background: white;
  border-radius: 50%;
  transform: translate(50%, -50%);
  box-shadow: 0 1px 3px rgba(0,0,0,0.5);
  pointer-events: none;
}

/* =====================================================
   VAS モーダル（試聴フェーズ）
   ===================================================== */
.vas-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.75);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.vas-modal {
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 14px;
  padding: 28px 32px;
  min-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}

.vas-modal-title { font-size: 1.1rem; font-weight: bold; color: #7eb8f7; margin: 0; text-align: center; }
.vas-rows        { display: flex; flex-direction: column; gap: 14px; }
.vas-row         { display: flex; align-items: center; gap: 10px; }

.vas-label-left,
.vas-label-right {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.7);
  min-width: 44px;
  white-space: nowrap;
}
.vas-label-left  { text-align: right; }
.vas-label-right { text-align: left;  }

.vas-slider    { flex: 1; accent-color: #7eb8f7; cursor: pointer; }
.vas-close-btn { background: #3498db; color: white; padding: 10px 24px; border-radius: 8px; font-size: 0.95rem; align-self: center; }

.vas-color-section {
  display: flex;
  align-items: center;
  gap: 12px;
}
.vas-color-label {
  font-size: 0.9rem;
  color: rgba(255,255,255,0.7);
  margin: 0;
}
.vas-color-picker {
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: none;
  padding: 0;
}

/* =====================================================
   アンケート
   ===================================================== */
.survey-overlay  { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.survey-overlay-front { z-index: 1250; }
.survey-modal    { background: #333; padding: 40px; border-radius: 12px; display: flex; flex-direction: column; align-items: stretch; gap: 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); }
.survey-modal-wide { width: min(620px, 90vw); box-sizing: border-box; max-height: 90vh; overflow-y: auto; }
.survey-title { margin: 0 0 8px; font-size: 1.3rem; text-align: center; color: white; }
.survey-section { display: flex; flex-direction: column; gap: 10px;}
.survey-question { margin: 0; font-size: 1rem; font-weight: bold; color: white; }
.survey-option { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; color: white; }
.survey-text-input { width: 100%; box-sizing: border-box; padding: 10px; border-radius: 6px; border: 1px solid #666; background: #222; color: white; }
.survey-error { margin: 0; color: #ff7675; font-size: 0.85rem; font-weight: bold; text-align: center; }
.likert-row { display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap; color: white; }
.likert-option { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 0.85rem; }
.likert-edge-label { font-size: 0.85rem; color: rgba(255,255,255,0.8); }
.btn-survey-done { background: #4caf50; color: white; padding: 10px 30px; border-radius: 4px; align-self: center; }
.btn-survey-done:disabled { background: #555; cursor: wait; }

/* 事前アンケート：経験年数入力 */
.survey-sub-input {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  padding-left: 24px;
}
.survey-sub-label { font-size: 0.9rem; color: rgba(255,255,255,0.8); }
.survey-genre-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 6px 0 12px 24px;
  padding-left: 12px;
  border-left: 2px solid #666;
}
.survey-inline-options { display: flex; gap: 16px; flex-wrap: wrap; }
.survey-number-input {
  width: 72px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid #666;
  background: #222;
  color: white;
  font-size: 1rem;
}
.survey-unit { font-size: 0.9rem; color: rgba(255,255,255,0.7); }
.survey-link {
  color: #7eb8f7;
  text-decoration: underline;
}
.survey-link:hover {
  color: #aed4fb;
}

/* 事後アンケート：各質問ブロック */
.survey-section-label {
  font-size: 0.85rem;
  color: rgba(255,255,255,0.6);
  margin: 0 0 12px 0;
}
.survey-likert-block {
  padding: 14px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.survey-likert-block:last-child { border-bottom: none; }
.survey-likert-block .survey-question { margin: 0 0 10px 0; font-size: 0.9rem; }

/* =====================================================
   フェーズ表示
   ===================================================== */
.phase-indicator { display: inline-flex; flex-direction: row; align-items: center; font-size: 0.9rem; font-weight: bold; gap: 8px; padding: 8px 16px; margin: 16px 0; border-radius: 8px; transition: background-color 0.5s; }
.phase-display   { display: flex; flex-direction: row; align-items: center; gap: 8px; }
.phase-1 { background: rgba(76,175,80,0.3);  border: 1px solid rgba(76,175,80,0.6);  }
.phase-2 { background: rgba(255,193,7,0.3);  border: 1px solid rgba(255,193,7,0.6);  }
.phase-3 { background: rgba(255,87,34,0.3);  border: 1px solid rgba(255,87,34,0.6);  }
.phase-4 { background: rgba(156,39,176,0.3); border: 1px solid rgba(156,39,176,0.6); }
.phase-5 { background: rgba(33,150,243,0.25); border: 1px solid rgba(33,150,243,0.55); }
.phase-icon     { margin-right: 4px; font-size: 1.1rem; }
.phase-text     { display: flex; flex-direction: column; gap: 2px; }
.phase-end-time { font-size: 0.75rem; color: rgba(255,255,255,0.7); font-weight: normal; }

/* =====================================================
   試聴モード
   ===================================================== */
.listening-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.8s ease-in-out; }
.listening-modal   { display: flex; flex-direction: column; align-items: center; gap: 64px; padding: 40px; animation: fadeInUp 0.8s ease-in-out; }
.listening-title   { font-size: 1.6rem; font-weight: bold; color: white; margin: 0; }
.listening-blocks  { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
.listening-block   { width: 80px; height: 80px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; border: 2px solid rgba(255,255,255,0.2); transition: transform 0.1s, filter 0.1s; position: relative; }
.listening-block:hover  { filter: brightness(1.3); transform: scale(1.05); }
.listening-block:active { transform: scale(0.95); }
.listening-block-label  { font-size: 1.8rem; font-weight: 900; color: white; text-shadow: 1px 1px 0 rgba(0,0,0,0.5); }
.listening-block-hint   { font-size: 1.0rem; font-weight: bold; color: rgba(255,255,255,0.6); margin: 0; bottom: 0px; text-align: center; line-height: 0; }
.listening-warning { font-size: 1.1rem; color: #ff6b6b; font-weight: bold; margin: 0; animation: blink 1s ease-in-out infinite; }
.listening-timer   { font-size: 1.2rem; color: rgba(255,255,255,0.5); margin: 0; font-weight: bold; }
.btn-start-now {
  background: rgba(255, 255, 255, 0.15);
  color: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.25);
  padding: 10px 28px;
  border-radius: 50px;
  font-size: 0.9rem;
  transition: background 0.2s, color 0.2s;
}
.btn-start-now:hover {
  background: rgba(255, 255, 255, 0.25);
  color: white;
}

@keyframes fadeIn   { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
@keyframes blink    { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

/* =====================================================
   ヘルプ目次モーダル
   ===================================================== */
.help-menu-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 980; display: flex; align-items: center; justify-content: center; }
.help-menu-modal   { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.15); border-radius: 14px; padding: 28px 32px; min-width: 280px; max-width: 400px; max-height: 80vh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); }
.help-menu-title   { font-size: 1.05rem; font-weight: bold; color: #7eb8f7; margin: 0; text-align: center; }
.help-menu-list    { display: flex; flex-direction: column; gap: 8px; }
.help-menu-item    { background: rgba(255,255,255,0.08); color: white; padding: 10px 16px; border-radius: 8px; font-size: 0.95rem; text-align: left; transition: background 0.15s; font-weight: normal; }
.help-menu-item:hover  { background: rgba(52,152,219,0.35); filter: none; }
.help-menu-item:active { background: rgba(52,152,219,0.55); transform: translateY(1px); filter: none; }
.help-menu-close       { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.6); padding: 8px 16px; border-radius: 8px; font-size: 0.9rem; align-self: center; }
.help-menu-close:hover { background: rgba(255,255,255,0.18); filter: none; }

/* =====================================================
   チュートリアル
   ===================================================== */
.tutorial-overlay  { position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 930; pointer-events: none; }
.tutorial-popover  { position: fixed; bottom: 40px; left: 50%; transform: translateX(-50%); background: #1a1a2e; border: 1px solid rgba(255,255,255,0.2); border-radius: 12px; padding: 20px 24px; min-width: 320px; max-width: 480px; box-shadow: 0 8px 32px rgba(0,0,0,0.6); z-index: 970; pointer-events: auto; }
.tutorial-title    { font-size: 1.0rem; font-weight: bold; color: #7eb8f7; margin: 0 0 8px 0; }
.tutorial-message  { font-size: 0.95rem; color: white; margin: 0 0 16px 0; line-height: 1.5; }
.tutorial-footer   { display: flex; align-items: center; justify-content: space-between; }
.tutorial-progress { font-size: 0.8rem; color: rgba(255,255,255,0.4); }
.tutorial-footer-buttons { display: flex; align-items: center; gap: 8px; }
.tutorial-btn        { background: #3498db; color: white; padding: 8px 20px; border-radius: 6px; font-size: 0.9rem; }
.tutorial-btn:hover  { filter: brightness(1.2); }
.tutorial-btn-cancel { background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.6); padding: 8px 16px; border-radius: 6px; font-size: 0.9rem; }
.tutorial-btn-cancel:hover { background: rgba(255,255,255,0.22); color: rgba(255,255,255,0.9); filter: none; }
.tutorial-action-hint { font-size: 0.8rem; color: rgba(255,255,255,0.5); font-style: italic; }
.tutorial-focus { position: relative; z-index: 960 !important; box-shadow: 0 0 0 4px rgba(52,152,219,0.85), 0 0 24px rgba(52,152,219,0.35) !important; border-radius: 4px; pointer-events: auto !important; }
</style>
