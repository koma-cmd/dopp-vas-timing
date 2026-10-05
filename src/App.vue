<script setup>
import { ref, computed, onBeforeUnmount } from 'vue';
import * as Tone from 'tone';
import { useVasTiming } from './useVasTiming';

// =====================================================
// ■ 音素材（本実験の App.vue と同じ）
// =====================================================
const SOUNDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const isLoaded = ref(false);
const loadError = ref(false);

const players = new Tone.Players({
  A: 'sounds/frag_A2.wav',
  B: 'sounds/frag_B2.wav',
  C: 'sounds/frag_C2.wav',
  D: 'sounds/frag_D2.wav',
  E: 'sounds/frag_E2.wav',
  F: 'sounds/frag_F2.wav',
  G: 'sounds/frag_G2.wav',
  H: 'sounds/frag_H2.wav',
}, {
  onload: () => { isLoaded.value = true; },
  onerror: () => { loadError.value = true; },
}).toDestination();

/** 音の長さ(ms)。記録用 */
const getDurationMs = (sound) => {
  try {
    if (!players.has(sound)) return null;
    const p = players.player(sound);
    return p.loaded ? Math.round(p.buffer.duration * 1000) : null;
  } catch {
    return null;
  }
};

// =====================================================
// ■ VAS項目（本実験の vasLabels と同じ。キー名も揃えてあるので既存データと比較できる）
// =====================================================
const vasLabels = [
  { key: 'high_low',          left: '軽い',   right: '重い'   },
  { key: 'strong_weak',       left: '強い',   right: '弱い'   },
  { key: 'bright_dark',       left: '明るい', right: '暗い'   },
  { key: 'activity_temporal', left: '動的',   right: '静的'   },
  { key: 'rough_smooth',      left: '粗い',   right: '滑らか' },
];

// =====================================================
// ■ 時間計測
// =====================================================
const timing = useVasTiming({
  sounds: SOUNDS,
  itemKeys: vasLabels.map((l) => l.key),
  getDurationMs,
});
const {
  status, saveState, finishedMs, openSound, trials,
  completedCount, allCompleted, isCompleted, remainingItems,
} = timing;

onBeforeUnmount(() => timing.dispose());

// ---------- 開始 ----------
const begin = async () => {
  if (!isLoaded.value) return;
  await Tone.start(); // ブラウザの自動再生制限の解除（クリック操作の中で呼ぶ）
  timing.start();
};

// ---------- ブロックのクリック：再生してVASモーダルを開く（本実験の previewSound と同じ順序） ----------
const onBlockClick = (sound) => {
  if (!isLoaded.value) return;
  Tone.start(); // リロード直後は AudioContext が suspended のため、クリック時に再開させる
  if (players.has(sound)) players.player(sound).start();
  timing.notePlay(sound);
  timing.openModal(sound);
};

// ---------- 完了の確認 ----------
const showFinishConfirm = ref(false);
const cancelFinish = () => { showFinishConfirm.value = false; };
const confirmFinish = () => {
  showFinishConfirm.value = false;
  timing.finish();
};

// ---------- スライダー ----------
const item = (key) => trials[openSound.value].items[key];

const NAV_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const onSliderKeydown = (e, key) => {
  if (!NAV_KEYS.has(e.key) || e.repeat) return;
  timing.touchStart(openSound.value, key);
};
const onSliderCommit = (e, key) => timing.commit(openSound.value, key, Number(e.target.value));

// ---------- ブロックの状態表示 ----------
const blockState = (sound) => {
  if (isCompleted(sound)) return 'done';
  const t = trials[sound];
  return Object.values(t.items).some((i) => i.touched) ? 'partial' : 'idle';
};

// =====================================================
// ■ 完了画面
// =====================================================
const fmtClock = (ms) => {
  if (ms == null) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
};
const fmtSec = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}秒`);

const rows = computed(() =>
  SOUNDS.map((s) => ({
    sound: s,
    completed: trials[s].completed_ms,
    modal: trials[s].modal_open_total_ms,
    plays: trials[s].play_count,
  }))
);

const saveMessage = computed(() => ({
  idle:    '',
  saving:  '記録を送信しています…',
  saved:   '記録を送信しました。',
  pending: '送信待ちです。ネットワークに接続されると自動で送信されます。このページは閉じても構いません。',
  error:   '送信に失敗しました。下の「結果をコピー」で内容を控えてください。',
}[saveState.value]));

const copied = ref(false);
const copyResult = async () => {
  try {
    await navigator.clipboard.writeText(JSON.stringify(timing.exportData(), null, 2));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  } catch {
    window.prompt('コピーに失敗しました。以下を手動でコピーしてください。', JSON.stringify(timing.exportData()));
  }
};
</script>

<template>
  <div class="app">

    <!-- ============ 開始前 ============ -->
    <main v-if="status === 'intro'" class="intro">
      <h1 class="intro-title"></h1>
      <p class="intro-lead">
        
      </p>
      <!-- <p class="intro-note">順番は自由です。ヘッドホンまたはイヤホンを使い、音量を調整してから始めてください。</p> -->
      <button class="btn btn-primary" :disabled="!isLoaded" @click="begin">
        {{ isLoaded ? '開始' : '音を読み込み中…' }}
      </button>
      <p v-if="loadError" class="intro-error">音の読み込みに失敗しました。ページを再読み込みしてください。</p>
    </main>

    <!-- ============ 評定中（本実験の試聴オーバーレイと同じ構造） ============ -->
    <div v-else-if="status === 'running'" class="listening-overlay">

      <!-- VAS 入力モーダル -->
      <div v-if="openSound" class="vas-overlay" @click.self="timing.closeModal()">
        <div class="vas-modal" role="dialog" aria-modal="true">
          <p class="vas-modal-title">Sound {{ openSound }} の印象</p>

          <div class="vas-rows">
            <div v-for="l in vasLabels" :key="l.key" class="vas-row">
              <span class="vas-label-left">{{ l.left }}</span>
              <input
                type="range" min="0" max="100" step="1"
                class="vas-slider"
                
                :value="item(l.key).value ?? 50"
                :aria-label="`${l.left} 〜 ${l.right}`"
                @pointerdown="timing.touchStart(openSound, l.key)"
                @keydown="onSliderKeydown($event, l.key)"
                @input="timing.setValue(openSound, l.key, Number($event.target.value))"
                @pointerup="onSliderCommit($event, l.key)"
                @pointercancel="onSliderCommit($event, l.key)"
                @change="onSliderCommit($event, l.key)"
                @keyup="onSliderCommit($event, l.key)"
              />
              <span class="vas-label-right">{{ l.right }}</span>
            </div>
          </div>

          <!-- <p class="vas-remaining" :class="{ done: remainingItems(openSound) === 0 }">
            {{ remainingItems(openSound) === 0 ? 'この音の評価は完了しています' : `未操作のスライダー：あと ${remainingItems(openSound)} 項目` }}
          </p> -->
          <button class="btn vas-close-btn" @click="timing.closeModal()">保存して閉じる</button>
        </div>
      </div>

      <div class="listening-modal">
        <p class="listening-title">まずは各ブロックをクリックして音への印象を評価してみてください</p>

        <div class="listening-blocks">
          <button
            v-for="s in SOUNDS" :key="s"
            type="button"
            class="listening-block"
            
            :aria-label="`Sound ${s}${isCompleted(s) ? '（評価済み）' : ''}`"
            @click="onBlockClick(s)"
          >
            <span class="listening-block-label">{{ s }}</span>
            <!-- <span v-if="isCompleted(s)" class="listening-block-check" aria-hidden="true">✓</span> -->
          </button>
        </div>

        <div class="progress">
          <!-- <p class="progress-text">評価済み {{ completedCount }} / {{ SOUNDS.length }}</p> -->
          <button class="btn btn-finish"  @click="showFinishConfirm = true">完了</button>
          <p class="progress-hint">{{ '評価が終わったら押してください。' }}</p> 
        </div>
      </div>

      <!-- 完了の確認ダイアログ -->
      <div v-if="showFinishConfirm" class="confirm-overlay" @click.self="cancelFinish">
        <div class="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
          <p id="confirm-title" class="confirm-title">本当に完了してよろしいですか？</p>
          <div class="confirm-buttons">
            <button class="btn btn-ghost" @click="cancelFinish">いいえ</button>
            <button class="btn btn-finish" @click="confirmFinish">はい</button>
          </div>
        </div>
      </div>   

    </div>

    

    <!-- ============ 完了 ============ -->
    <main v-else class="done">
      <h1 class="done-title">完了しました。ご協力ありがとうございました。</h1>
<!--
      <p class="done-total">
        <span class="done-total-value">{{ fmtClock(finishedMs) }}</span>
        <span class="done-total-label">開始から「完了」までの時間（{{ finishedMs }} ms）</span>
      </p>
 
      <table class="done-table">
        <thead>
          <tr><th>音</th><th>評価が終わった時点</th><th>評価画面を開いていた時間</th><th>再生回数</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.sound">
            <td>{{ r.sound }}</td>
            <td>{{ fmtSec(r.completed) }}</td>
            <td>{{ fmtSec(r.modal) }}</td>
            <td>{{ r.plays }}</td>
          </tr>
        </tbody>
      </table>

      <p class="done-save" :class="`is-${saveState}`">{{ saveMessage }}</p>
      <button class="btn btn-ghost" @click="copyResult">{{ copied ? 'コピーしました' : '結果をコピー' }}</button> -->
    </main>

  </div>
</template>

<style scoped>
/* =====================================================
   共通
   ===================================================== */
.app {
  min-height: 100vh;
  background: #1c1c1c;
  color: #fff;
  font-family: 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', system-ui, sans-serif;
  line-height: 1.6;
}

.btn {
  border: none;
  cursor: pointer;
  font: inherit;
  color: #fff;
  border-radius: 8px;
  padding: 10px 24px;
  font-size: 0.95rem;
  transition: filter 0.15s;
}
.btn:hover:not(:disabled) { filter: brightness(1.15); }
.btn:disabled { cursor: not-allowed; opacity: 0.45; }
.btn:focus-visible,
.listening-block:focus-visible,
/* .vas-slider:focus-visible { outline: 3px solid #7eb8f7; outline-offset: 3px; } */

/* =====================================================
   開始前 / 完了
   ===================================================== */
.intro, .done {
  max-width: 1560px;
  margin: 0 auto;
  padding: 72px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center; 
  gap: 20px;
  min-height: 100vh;          /* ← 追加：画面の高さいっぱいに広げる */
  box-sizing: border-box;     /* ← 追加：padding を含めて 100vh に収める */
}
.intro-title, .done-title { margin: 0; font-size: 1.8rem;}
.intro-lead { margin: 0; font-size: 1.05rem; }
.intro-steps { margin: 0; padding-left: 1.4em; display: flex; flex-direction: column; gap: 8px; }
.intro-note { margin: 0; color: rgba(255,255,255,0.65); font-size: 0.9rem; }
.intro-error { margin: 0; color: #ff7675; font-weight: bold; }
.btn-primary { background: #3498db; padding: 12px 40px; font-size: 1.05rem; }

.done-total { margin: 0; display: flex; flex-direction: column; gap: 4px; }
.done-total-value { font-size: 3rem; font-weight: 900; line-height: 1.1; font-variant-numeric: tabular-nums; }
.done-total-label { color: rgba(255,255,255,0.65); font-size: 0.9rem; }

.done-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; font-variant-numeric: tabular-nums; }
.done-table th, .done-table td { padding: 8px 10px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.12); }
.done-table th:first-child, .done-table td:first-child { text-align: left; }
.done-table th { color: rgba(255,255,255,0.65); font-weight: normal; }

.done-save { margin: 0; font-size: 0.9rem; color: rgba(255,255,255,0.75); }
.done-save.is-error { color: #ff7675; font-weight: bold; }
.done-save.is-saved { color: #81c784; }
.btn-ghost { background: rgba(255,255,255,0.12); }

/* =====================================================
   試聴モード（本実験の App.vue と同じ寸法）
   ===================================================== */
.listening-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 1000; display: flex; align-items: center; justify-content: center; }
.listening-modal   { display: flex; flex-direction: column; align-items: center; gap: 64px; padding: 40px; }
.listening-title   { font-size: 1.6rem; font-weight: bold; color: white; margin: 0; text-align: center; }
.listening-blocks  { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
.listening-block   {
  width: 80px; height: 80px; border-radius: 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  cursor: pointer; border: 2px solid rgba(255,255,255,0.2);
  background-color: #555555; padding: 0; font: inherit;
  transition: transform 0.1s, filter 0.1s; position: relative;
}
.listening-block:hover  { filter: brightness(1.3); transform: scale(1.05); }
.listening-block:active { transform: scale(0.95); }
.listening-block-label  { font-size: 1.8rem; font-weight: 900; color: white; text-shadow: 1px 1px 0 rgba(0,0,0,0.5); }

/* 評価の進み具合（このアプリで追加した表示） */
.listening-block.is-partial { border: 2px dashed #7eb8f7; }
.listening-block.is-done    { border: 2px solid #4caf50; }
.listening-block-check {
  position: absolute; top: -9px; right: -9px;
  width: 22px; height: 22px; border-radius: 50%;
  background: #4caf50; color: #fff; font-size: 0.8rem; font-weight: bold;
  display: flex; align-items: center; justify-content: center;
}

.progress { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: -24px; }
.progress-text { margin: 0; font-size: 1.1rem; font-weight: bold; color: rgba(255,255,255,0.85); }
.progress-hint { margin: 0; font-size: 0.85rem; color: rgba(255,255,255,0.55); }
.btn-finish { background: #4caf50; padding: 12px 48px; font-size: 1.05rem; }

/* 完了の確認ダイアログ */
.confirm-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.75);
  z-index: 1200;
  display: flex; align-items: center; justify-content: center;
}
.confirm-modal {
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 14px;
  padding: 28px 32px;
  max-width: 92vw;
  display: flex; flex-direction: column; align-items: center; gap: 24px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}
.confirm-title { margin: 0; font-size: 1.1rem; font-weight: bold; text-align: center; }
.confirm-buttons { display: flex; gap: 16px; }
.confirm-buttons .btn { min-width: 110px; padding: 10px 24px; }

/* =====================================================
   VAS モーダル（本実験の App.vue と同じ寸法）
   ===================================================== */
.vas-overlay {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.75);
  z-index: 1100;
  display: flex; align-items: center; justify-content: center;
}
.vas-modal {
  background: #1a1a2e;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 14px;
  padding: 28px 32px;
  min-width: 320px;
  max-width: 92vw;
  display: flex; flex-direction: column; gap: 20px;
  box-shadow: 0 12px 40px rgba(0,0,0,0.6);
}
.vas-modal-title { font-size: 1.1rem; font-weight: bold; color: #7eb8f7; margin: 0; text-align: center; }
.vas-rows { display: flex; flex-direction: column; gap: 14px; }
.vas-row  { display: flex; align-items: center; gap: 10px; }

.vas-label-left, .vas-label-right {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.7);
  min-width: 44px;
  white-space: nowrap;
}
.vas-label-left  { text-align: right; }
.vas-label-right { text-align: left; }

/* スライダー：触れるまでつまみを隠し、初期位置(50)による誘導を避ける */
.vas-slider { flex: 1; accent-color: #7eb8f7; cursor: pointer; }
/* .vas-slider {
  flex: 1; min-width: 160px; height: 28px;
  -webkit-appearance: none; appearance: none;
  background: transparent; cursor: pointer; margin: 0;
}
.vas-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.28); }
.vas-slider::-moz-range-track              { height: 4px; border-radius: 2px; background: rgba(255,255,255,0.28); }
.vas-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 20px; height: 20px; border-radius: 50%; border: none;
  background: #7eb8f7; margin-top: -8px;
}
.vas-slider::-moz-range-thumb {
  width: 20px; height: 20px; border-radius: 50%; border: none; background: #7eb8f7;
}
.vas-slider.untouched::-webkit-slider-thumb { opacity: 0; }
.vas-slider.untouched::-moz-range-thumb     { opacity: 0; } */

.vas-remaining { margin: 0; text-align: center; font-size: 0.85rem; color: rgba(255,255,255,0.6); }
.vas-remaining.done { color: #81c784; }
.vas-close-btn { background: #3498db; align-self: center; }

@media (max-width: 520px) {
  .listening-title { font-size: 1.2rem; }
  .listening-modal { gap: 40px; padding: 24px 16px; }
  .vas-modal { padding: 20px 16px; min-width: 0; }
  .vas-slider { min-width: 100px; }
}
</style>
