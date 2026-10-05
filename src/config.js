// config.js
// 実験パラメータをまとめた設定ファイル。
//
// 【VAS時間計測アプリでの変更点】
// ・vasTimingCollection を追加（本実験の sessions と混ざらないよう、保存先を分ける）。
// ・それ以外のキーは本実験のものをそのまま残している（このアプリでは使っていない）。
//
// 値を変えたい場合は、下記のデフォルト値を直接書き換えるか、
// .env 系ファイルに環境変数として指定する。
//   例）.env.local
//     VITE_VAS_TIMING_COLLECTION=vas_timing_pilot2

/** 環境変数の値を数値化する。未設定・不正な値のときは fallback を使う。 */
const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const EXPERIMENT_CONFIG = {
  // 制作フェーズの長さ（分）
  phaseTimeMinutes: toNumber(import.meta.env.VITE_PHASE_TIME_MINUTES, 15),

  // 試聴フェーズの長さ（秒）
  listeningTimeSeconds: toNumber(import.meta.env.VITE_LISTENING_TIME_SECONDS, 180),

  // 試聴フェーズ終了の何秒前に警告表示を出すか
  listeningWarningAtSeconds: toNumber(import.meta.env.VITE_LISTENING_WARNING_AT_SECONDS, 60),

  // Undo/Redo で遡れる操作の最大件数
  maxUndoHistory: toNumber(import.meta.env.VITE_MAX_UNDO_HISTORY, 50),

  // ★追加：VAS時間計測アプリの保存先コレクション名
  vasTimingCollection: import.meta.env.VITE_VAS_TIMING_COLLECTION || 'vas_timing_sessions',
};
