// =====================================================
// useVasTiming.js
// VAS評定の所要時間を計測・保存するモジュール
//
// 【計測の考え方】
// ・時刻はすべて「開始ボタンを押してからの経過ミリ秒」で持つ。
//   経過時間の計算には performance.now() を使う（Date.now() は時刻補正で飛ぶことがあるため）。
// ・Firestore の serverTimestamp は「記録日時」としてのみ使い、期間の計算には使わない
//   （persistentLocalCache ではオフライン中の書き込みが遅れて確定するため）。
//
// 【主な指標】
//   finished_ms        … 「完了」ボタンを押した時刻（＝8音の評定を終えるまでの時間）
//   all_completed_ms   … 8音すべての評定が終わった時刻（最後のスライダーを離した時点）
//   sound_trials/{音}  … 音ごとの詳細（初回オープン、完了時刻、モーダル滞在時間など）
//
// 【Firestore 構造】
//   {vasTimingCollection}/{sessionId}                  … セッション全体のサマリー
//   {vasTimingCollection}/{sessionId}/sound_trials/{A–H} … 音ごとの詳細（固定IDなので再送しても重複しない）
// =====================================================

import { reactive, ref, computed } from 'vue';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { EXPERIMENT_CONFIG } from './config';

const COLLECTION = EXPERIMENT_CONFIG.vasTimingCollection;
const SAVE_TIMEOUT_MS = 8000;

// =====================================================
// ■ セッション・ユーザ情報（useLogger.js と同じ仕組み）
// =====================================================
const generateSessionId = () =>
  `vt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const getUserId = () =>
  new URLSearchParams(location.search).get('uid') ?? 'unknown';

/**
 * リロードしても同じセッションとして続けられるよう、sessionId を localStorage に保存する。
 * 別の参加者を同じ端末で実施するときは、uid を変えるか URL に ?reset=1 を付ける。
 */
const getOrCreateSessionId = (userId) => {
  const params = new URLSearchParams(location.search);
  const storageKey = `vas_timing_session_id_${userId}`;
  try {
    if (params.get('reset') === '1') {
      const old = localStorage.getItem(storageKey);
      if (old) localStorage.removeItem(`vas_timing_state_${old}`);
      localStorage.removeItem(storageKey);
      // 使い終わった reset はURLから取り除く（残すとリロードのたびに最初からになる）
      params.delete('reset');
      const qs = params.toString();
      history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : '') + location.hash);
    }
    const stored = localStorage.getItem(storageKey);
    if (stored) return stored;
    const created = generateSessionId();
    localStorage.setItem(storageKey, created);
    return created;
  } catch (error) {
    console.warn('localStorageを利用できないため、一時的なsessionIdを発行します。', error);
    return generateSessionId();
  }
};

// =====================================================
// ■ composable 本体
// =====================================================
/**
 * @param {Object}   options
 * @param {string[]} options.sounds        音の識別子（例: ['A', ..., 'H']）
 * @param {string[]} options.itemKeys      VAS項目のキー（例: ['high_low', ...]）
 * @param {Function} [options.getDurationMs] 音の長さ(ms)を返す関数（記録用）
 */
export function useVasTiming({ sounds, itemKeys, getDurationMs = () => null }) {
  const userId = getUserId();
  const sessionId = getOrCreateSessionId(userId);
  const stateKey = `vas_timing_state_${sessionId}`;

  const sessionRef = doc(db, COLLECTION, sessionId);
  const soundRef = (sound) => doc(db, COLLECTION, sessionId, 'sound_trials', sound);

  // ---------- 状態 ----------
  /** 'intro'（開始前） | 'running'（評定中） | 'finished'（完了） */
  const status = ref('intro');
  /** 'idle' | 'saving' | 'saved' | 'pending'（送信待ち） | 'error' */
  const saveState = ref('idle');
  const finishedMs = ref(null);
  const hiddenMs = ref(0);
  const resumeCount = ref(0);
  const openSound = ref(null);

  let t0Perf = null;        // 開始時点の performance.now()
  let startedAtWall = null; // 開始時点の Date.now()（リロード復元用）
  let openedAtMs = null;    // 現在開いているモーダルの開始時刻（経過ms）
  let hiddenSince = null;   // タブが非表示になった時点の performance.now()

  const makeItem = () => ({
    value: null,            // 0〜100。触るまでは null
    touched: false,         // つまみに触れた（pointerdown / keydown）
    committed: false,       // 操作を終えた（pointerup / change / keyup）
    first_touch_ms: null,
    committed_ms: null,     // 初めて操作を終えた時刻
    last_interaction_ms: null,
    touch_count: 0,         // 触れた回数（ドラッグ1回＝1回）
  });

  const makeTrial = () => ({
    play_count: 0,
    open_count: 0,
    modal_open_total_ms: 0,
    first_open_ms: null,
    first_touch_ms: null,
    completed_ms: null,     // 5項目すべての操作を終えた時刻
    last_interaction_ms: null,
    items: Object.fromEntries(itemKeys.map((k) => [k, makeItem()])),
  });

  const trials = reactive(Object.fromEntries(sounds.map((s) => [s, makeTrial()])));

  // ---------- 時計 ----------
  const elapsed = () => Math.round(performance.now() - t0Perf);

  const currentHiddenMs = () =>
    Math.round(hiddenMs.value + (hiddenSince != null ? performance.now() - hiddenSince : 0));

  const effectiveModalTotal = (sound) =>
    trials[sound].modal_open_total_ms +
    (openSound.value === sound && openedAtMs != null ? elapsed() - openedAtMs : 0);

  // ---------- 完了判定 ----------
  const isCompleted = (sound) => trials[sound].completed_ms != null;
  const remainingItems = (sound) =>
    itemKeys.filter((k) => !trials[sound].items[k].committed).length;
  const completedCount = computed(() => sounds.filter(isCompleted).length);
  const allCompleted = computed(() => completedCount.value === sounds.length);

  // ---------- スナップショット ----------
  const snapshotTrial = (sound) => {
    const tr = trials[sound];
    const items = {};
    itemKeys.forEach((k) => { items[k] = { ...tr.items[k] }; });
    return { ...tr, items, modal_open_total_ms: Math.round(effectiveModalTotal(sound)) };
  };

  const maxOf = (arr) => {
    const v = arr.filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  };

  /** サマリー（serverTimestamp を含まない純粋なデータ。画面表示・コピー用にも使う） */
  const buildSummary = () => {
    const snaps = Object.fromEntries(sounds.map((s) => [s, snapshotTrial(s)]));
    return {
      user_id: userId,
      session_id: sessionId,
      finished_ms: finishedMs.value,
      // all_completed_ms: maxOf(sounds.map((s) => snaps[s].completed_ms)),
      last_interaction_ms: maxOf(sounds.map((s) => snaps[s].last_interaction_ms)),
      hidden_ms: currentHiddenMs(),
      resume_count: resumeCount.value,
      // sounds_completed: sounds.filter((s) => snaps[s].completed_ms != null).length,
      // 「T秒の時点で何音まで終わっていたか」を後から計算するための一覧
      // sound_completed_ms: Object.fromEntries(sounds.map((s) => [s, snaps[s].completed_ms])),
      sound_modal_open_total_ms: Object.fromEntries(sounds.map((s) => [s, snaps[s].modal_open_total_ms])),
      vas_data: Object.fromEntries(
        sounds.map((s) => [s, Object.fromEntries(itemKeys.map((k) => [k, snaps[s].items[k].value]))])
      ),
    };
  };

  const buildSoundDoc = (sound) => ({
    user_id: userId,
    session_id: sessionId,
    sound,
    sound_duration_ms: getDurationMs(sound),
    ...snapshotTrial(sound),
    updated_at: serverTimestamp(),
  });

  // ---------- localStorage（リロード復元） ----------
  const persist = () => {
    try {
      localStorage.setItem(stateKey, JSON.stringify({
        status: status.value,
        startedAtWall,
        hiddenMs: currentHiddenMs(),
        resumeCount: resumeCount.value,
        finishedMs: finishedMs.value,
        saveState: saveState.value,
        trials: Object.fromEntries(sounds.map((s) => [s, snapshotTrial(s)])),
      }));
    } catch (error) {
      console.warn('[useVasTiming] 状態の保存に失敗しました:', error);
    }
  };

  const restoreFromStorage = () => {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(stateKey) ?? 'null'); } catch { saved = null; }
    if (!saved || (saved.status !== 'running' && saved.status !== 'finished')) return;

    for (const s of sounds) {
      const src = saved.trials?.[s];
      if (!src) continue;
      const { items, ...rest } = src;
      Object.assign(trials[s], rest);
      itemKeys.forEach((k) => { if (items?.[k]) Object.assign(trials[s].items[k], items[k]); });
    }
    hiddenMs.value = saved.hiddenMs ?? 0;
    resumeCount.value = saved.resumeCount ?? 0;
    startedAtWall = saved.startedAtWall;

    if (saved.status === 'finished') {
      finishedMs.value = saved.finishedMs;
      saveState.value = saved.saveState === 'saving' ? 'pending' : (saved.saveState ?? 'pending');
      status.value = 'finished';
      return;
    }

    // 評定中にリロードされた：リロードの空白時間も含めて「開始からの経過時間」を続ける
    resumeCount.value += 1;
    t0Perf = performance.now() - (Date.now() - startedAtWall);
    status.value = 'running';
    attach();
    persist();
    setDoc(sessionRef, {
      resume_count: resumeCount.value,
      updated_at: serverTimestamp(),
    }, { merge: true }).catch((e) => console.error('[useVasTiming] 再開の記録に失敗しました:', e));
  };

  // ---------- タブの表示状態（離席検出） ----------
  const onVisibility = () => {
    if (document.hidden) {
      if (hiddenSince == null) hiddenSince = performance.now();
    } else if (hiddenSince != null) {
      hiddenMs.value += performance.now() - hiddenSince;
      hiddenSince = null;
      persist();
    }
  };
  const onPageHide = () => persist();

  function attach() {
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
  }
  function detach() {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
  }
  const dispose = () => detach();

  // =====================================================
  // ■ 操作
  // =====================================================

  /** 「開始」ボタン：ここが時間の起点（経過0ms） */
  const start = () => {
    if (status.value !== 'intro') return;
    t0Perf = performance.now();
    startedAtWall = Date.now();
    status.value = 'running';
    attach();
    persist();

    const ua = navigator.userAgent;
    setDoc(sessionRef, {
      user_id: userId,
      session_id: sessionId,
      status: 'running',
      device_type: /Mobi|Android/i.test(ua) ? 'mobile' : 'desktop',
      browser: ua,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      started_at_client: new Date(startedAtWall).toISOString(),
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    }, { merge: true }).catch((e) => console.error('[useVasTiming] 開始情報の記録に失敗しました:', e));
  };

  /** 音ごとの詳細を保存（モーダルを閉じるたびに上書き。固定IDなので重複しない） */
  const saveSoundTrial = (sound) =>
    setDoc(soundRef(sound), buildSoundDoc(sound), { merge: true })
      .catch((e) => console.error(`[useVasTiming] ${sound} の記録に失敗しました:`, e));

  const notePlay = (sound) => {
    if (status.value !== 'running') return;
    trials[sound].play_count += 1;
    persist();
  };

  const openModal = (sound) => {
    if (status.value !== 'running') return;
    if (openSound.value && openSound.value !== sound) closeModal();
    const tr = trials[sound];
    const t = elapsed();
    tr.open_count += 1;
    if (tr.first_open_ms == null) tr.first_open_ms = t;
    openedAtMs = t;
    openSound.value = sound;
    persist();
  };

  const closeModal = () => {
    const sound = openSound.value;
    if (!sound) return;
    trials[sound].modal_open_total_ms += elapsed() - openedAtMs;
    openSound.value = null;
    openedAtMs = null;
    persist();
    saveSoundTrial(sound);
  };

  /** スライダーに触れた（pointerdown / keydown） */
  const touchStart = (sound, key) => {
    if (status.value !== 'running') return;
    const tr = trials[sound];
    const it = tr.items[key];
    const t = elapsed();
    if (!it.touched) {
      it.touched = true;
      it.first_touch_ms = t;
      if (it.value == null) it.value = 50; // 仮の値。直後の input / pointerup で実際の値に更新される
    }
    if (tr.first_touch_ms == null) tr.first_touch_ms = t;
    it.touch_count += 1;
    it.last_interaction_ms = t;
    tr.last_interaction_ms = t;
    persist();
  };

  /** ドラッグ中などに値が変わった（input） */
  const setValue = (sound, key, value) => {
    if (status.value !== 'running') return;
    const tr = trials[sound];
    const it = tr.items[key];
    const t = elapsed();
    if (!it.touched) { it.touched = true; it.first_touch_ms = t; }
    if (tr.first_touch_ms == null) tr.first_touch_ms = t;
    it.value = value;
    it.last_interaction_ms = t;
    tr.last_interaction_ms = t;
    persist();
  };

  /** 操作を終えた（pointerup / pointercancel / change / keyup） */
  const commit = (sound, key, value) => {
    if (status.value !== 'running') return;
    const tr = trials[sound];
    const it = tr.items[key];
    if (!it.touched) return; // 触れていないのに発火した場合は無視
    const t = elapsed();
    if (value != null && Number.isFinite(value)) it.value = value;
    it.last_interaction_ms = t;
    tr.last_interaction_ms = t;
    if (!it.committed) {
      it.committed = true;
      it.committed_ms = t;
    }
    // if (tr.completed_ms == null && itemKeys.every((k) => tr.items[k].committed)) {
    //   tr.completed_ms = t;
    // }
    persist();
  };

  /** 「完了」ボタン：8音すべて終わっているときだけ受け付ける */
  const finish = async () => {
    if (status.value !== 'running') return;
    if (openSound.value) closeModal();

    finishedMs.value = elapsed();
    if (hiddenSince != null) { hiddenMs.value += performance.now() - hiddenSince; hiddenSince = null; }
    status.value = 'finished';
    saveState.value = 'saving';
    detach();
    persist();

    const writes = Promise.all([
      setDoc(sessionRef, {
        ...buildSummary(),
        status: 'finished',
        finished_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }, { merge: true }),
      ...sounds.map((s) => setDoc(soundRef(s), buildSoundDoc(s), { merge: true })),
    ]);

    // persistentLocalCache のため、オフライン中は書き込みの完了(Promise)が返らない。
    // 一定時間で見切り、画面上は「送信待ち」とする（接続が戻れば自動送信され、その時点で saved になる）。
    const result = await Promise.race([
      writes.then(() => 'ok').catch(() => 'error'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), SAVE_TIMEOUT_MS)),
    ]);

    if (result === 'ok') {
      saveState.value = 'saved';
    } else if (result === 'error') {
      saveState.value = 'error';
    } else {
      saveState.value = 'pending';
      writes
        .then(() => { saveState.value = 'saved'; persist(); })
        .catch(() => { saveState.value = 'error'; persist(); });
    }
    persist();
  };

  /** 画面表示・コピー用のデータ */
  const exportData = () => ({
    summary: buildSummary(),
    sound_trials: Object.fromEntries(sounds.map((s) => [s, snapshotTrial(s)])),
  });

  // 起動時：評定中／完了済みならそこから復元
  restoreFromStorage();

  return {
    sessionId,
    userId,
    status,
    saveState,
    finishedMs,
    openSound,
    trials,
    completedCount,
    allCompleted,
    isCompleted,
    remainingItems,
    start,
    notePlay,
    openModal,
    closeModal,
    touchStart,
    setValue,
    commit,
    finish,
    exportData,
    dispose,
  };
}
