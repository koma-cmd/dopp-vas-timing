<script setup>
import { ref, onMounted } from 'vue'; // onMountedを追加
import draggable from 'vuedraggable';
import * as Tone from 'tone';
// ■ 追加: driver.js をインポート
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

// ■ 1. パレット（素材置き場）の定義
// ここにある音をドラッグして右側のスペースへ持っていきます
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

// ■ 2. シーケンサーの初期データ
// 最初は空っぽでもいいですが、例としていくつか置いておきます
const noteBlocks = ref([
  { id: 1, sound: 'A', color: '#555555' },
  { id: 2, sound: 'B', color: '#555555' },
  { id: 3, sound: 'C', color: '#555555' },
  { id: 4, sound: 'D', color: '#555555' },
  { id: 5, sound: 'E', color: '#555555' },
  { id: 6, sound: 'F', color: '#555555' },
  { id: 7, sound: 'G', color: '#555555' },
  { id: 8, sound: 'H', color: '#555555' },
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

// ■ 4. 重要: パレットからの複製処理 (Clone)
// パレットからドラッグされた時、自動的に呼ばれます
const cloneSound = (origin) => {
  return {
    ...origin,       // 元のデータ(sound, color等)をコピー
    id: nextId++,    // 新しいIDを発行（これがないとバグります）
    isPlaying: false // 初期状態は「光っていない」
  };
};

// ■ 5. 再生機能
const playSequence = async (startIndex = 0) => {
  await Tone.start();
  if (!isLoaded.value) return;

  const startIdx = typeof startIndex === 'number' ? startIndex : 0;
  const now = Tone.now();
  let timeOffset = 0;

  const blocksToPlay = noteBlocks.value.slice(startIdx);  

  blocksToPlay.forEach((block) => {
    if (players.has(block.sound)) {
      const player = players.player(block.sound);
      const fileDuration = player.loaded ? player.buffer.duration : 0;

      player.start(now + timeOffset);

      Tone.Draw.schedule(() => {
        block.isPlaying = true;
      }, now + timeOffset);

      Tone.Draw.schedule(() => {
        block.isPlaying = false;
      }, now + timeOffset + fileDuration);
      
      timeOffset += fileDuration; 
    }
  });
};

const stopSequence = () => {
  players.stopAll();
  Tone.Draw.cancel();
  noteBlocks.value.forEach(block => { block.isPlaying = false; });
};

const previewSound = (block) => {
  if (players.has(block.sound)) {
    players.player(block.sound).start();
    // 試聴時の光る演出
    // パレット上のアイテムには isPlaying プロパティが無い場合があるのでチェック
    if (block.hasOwnProperty('isPlaying')) {
       block.isPlaying = true;
       setTimeout(() => { block.isPlaying = false; }, 100);
    }
  }
};

const removeBlock = (index) => {
  noteBlocks.value.splice(index, 1);
};

const exportAudio = async () => {
  if (noteBlocks.value.length === 0) return alert("ブロックがありません");
  
  // 1. 全体の長さを計算する
  let totalDuration = 0;
  noteBlocks.value.forEach(block => {
    if (players.has(block.sound)) {
      const p = players.player(block.sound);
      totalDuration += p.loaded ? p.buffer.duration : 0;
    }
  });
  
  // 少し余白を持たせる（残響対策）
  totalDuration += 1.0; 

  console.log("書き出し開始: 長さ", totalDuration, "秒");

  // 2. オフラインレンダリング（高速書き出し）
  // ここで仮想の世界で再生シミュレーションを行います
  const buffer = await Tone.Offline(({ transport }) => {
    let timeOffset = 0;
    
    noteBlocks.value.forEach(block => {
      if (players.has(block.sound)) {
        // メインのplayersからバッファ（音の中身）だけ借りてくる
        const originalBuffer = players.player(block.sound).buffer;
        
        // オフライン用のプレイヤーを作って配置
        // (Tone.BufferSourceを使うと軽量です)
        const source = new Tone.BufferSource(originalBuffer).toDestination();
        source.start(timeOffset);
        
        // 次の時間へ
        timeOffset += originalBuffer.duration;
      }
    });
  }, totalDuration);

  // 3. WAVファイルに変換してダウンロード
  downloadWav(buffer);
};

// WAV変換＆ダウンロード用のヘルパー関数
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

  // ヘッダー書き込み
  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8); // file length - 8
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt " chunk
  setUint32(16); // length = 16
  setUint16(1); // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(audioBuffer.sampleRate);
  setUint32(audioBuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
  setUint16(numOfChan * 2); // block-align
  setUint16(16); // 16-bit (hardcoded in this example)
  setUint32(0x61746164); // "data" - chunk
  setUint32(length - pos - 4); // chunk length

  // 音声データ書き込み
  for (i = 0; i < audioBuffer.numberOfChannels; i++)
    channels.push(audioBuffer.getChannelData(i));

  while (pos < audioBuffer.length) {
    for (i = 0; i < numOfChan; i++) {
      sample = Math.max(-1, Math.min(1, channels[i][pos])); // clamp
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit
      view.setInt16(44 + offset, sample, true);
      offset += 2;
    }
    pos++;
  }

  // ブラウザでダウンロード発動
  const blob = new Blob([buffer], { type: "audio/wav" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  document.body.appendChild(anchor);
  anchor.style = "display: none";
  anchor.href = url;
  anchor.download = "my_sequence.wav";
  anchor.click();
  window.URL.revokeObjectURL(url);
  
  // ヘルパー内のヘルパー
  function setUint16(data) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data) { view.setUint32(pos, data, true); pos += 4; }
};

// ■ 追加: チュートリアルを実行する関数
const startTour = () => {
  // driverオブジェクトを作成（設定）
  const tourDriver = driver({
    showProgress: true, // "1/4" みたいな進捗を表示
    nextBtnText: '次へ',
    prevBtnText: '戻る',
    doneBtnText: '完了',
    steps: [
      // ステップ1: パレットの説明
      { 
        element: '.sidebar', 
        popover: { 
          title: '素材パレット', 
          description: 'ここにある音（A〜H）を、右側のエリアにドラッグ＆ドロップしてください。', 
          side: "right", 
          align: 'start' 
        } 
      },
      // ステップ2: 作業エリアの説明
      { 
        element: '.sequencer-wrapper', 
        popover: { 
          title: '作業スペース', 
          description: 'ここに並べた順番で音が再生されます。並べ替えも自由です。', 
          side: "left", 
          align: 'start' 
        } 
      },
      // ステップ3: 再生ボタンの説明
      { 
        element: '.controls', 
        popover: { 
          title: 'コントロール', 
          description: '並べ終わったら「再生」ボタンを押して聴いてみましょう。「書き出し」でファイル保存もできます。', 
          side: "bottom", 
          align: 'start' 
        } 
      }
    ]
  });

  // ツアー開始！
  tourDriver.drive();
};

onMounted(() => {
  // 少しだけ待ってから開始するとスムーズです
  setTimeout(() => {
    // ユーザーが初めてなら…という判定を入れるのも良いですが、
    // まずは強制的に毎回表示してみましょう
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
            @click="() => playSequence(0)" 
            class="btn-play" 
            :disabled="!isLoaded"
            :class="{ loading: !isLoaded }"
          >
            {{ isLoaded ? "▶ 再生" : "読み込み中..." }}
          </button>

          <button @click="stopSequence" class="btn-stop">
           ■ 停止
          </button>

          <button @click="exportAudio" class="btn-export" :disabled="!isLoaded">
          ⬇ 保存
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
        >
          <template #item="{ element, index }">
            <div 
              class="music-block" 
              :style="{ backgroundColor: element.color }"
              :class="{ active: element.isPlaying }"
              @click="previewSound(element)"
            >
              <span class="step-number">{{ index + 1 }}</span>

              <span class="sound-name">
                {{ element.sound.toUpperCase() }}
              </span>
              
              <select v-model="element.sound" @click.stop>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="E">E</option>
                <option value="F">F</option>
                <option value="G">G</option>
                <option value="H">H</option>
              </select>

              <button class="btn-play-from" @click.stop="playSequence(index)">
                ココカラ▶
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
  </div>
</template>

<style scoped>
/* ■ レイアウト全体 (Flexboxで左右分割) */
.app-layout {
  display: flex;
  height: 100vh;
  background-color: #222;
  color: white;
  font-family: sans-serif;
  overflow: hidden;
}

/* ■ 左サイドバー (パレット) */
.sidebar {
  width: 120px; /* 細めのパレット */
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

/* パレットアイテムのデザイン */
.palette-item {
  width: 80px;
  height: 60px;
  background-color: #444; /* ちょっと明るいグレー */
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


/* ■ 右メインエリア */
.main-content {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.header { margin-bottom: 20px; }
.controls { display: flex; gap: 10px; }

/* シーケンサーエリア */
.sequencer-wrapper { 
  background-color: #333; 
  padding: 20px; 
  border-radius: 8px; 
  flex: 1; 
  min-height: 300px;
  display: flex;
  flex-direction: column;
  position: relative; /* ★追加: 中身を絶対配置する基準にします */
}

.block-list { 
  display: flex; 
  flex-wrap: wrap; 
  gap: 10px; 
  flex: 1; 
  align-content: flex-start;
  
  /* ★重要変更: 必ずエリア全体に広がるようにします */
  width: 100%;
  min-height: 100%; 
}

/* 空の状態 */
.empty-state {
  /* ★変更: 場所を固定せず、エリアの中央に浮かせます */
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
  box-sizing: border-box; /* 枠線をサイズに含める */

  /* ★最重要: これでドラッグ操作が文字を突き抜けてリストに届きます */
  pointer-events: none; 
}

/* ■ ボタン・ブロック共通スタイル (以前のものを継承) */
button { cursor: pointer; border: none; padding: 10px 20px; border-radius: 4px; font-weight: bold; }
.btn-play { background-color: #4caf50; color: white; }
.btn-play:disabled { background-color: #555; cursor: wait; }
.btn-stop { background-color: #ff4757; color: white; }
.btn-stop:hover { background-color: #ff6b81; }
.btn-stop:active { transform: translateY(2px); }

.music-block { 
  width: 90px; height: 90px; 
  border-radius: 4px; 
  display: flex; flex-direction: column; 
  justify-content: center; align-items: center; 
  cursor: grab; position: relative; 
  box-shadow: 0 4px 6px rgba(0,0,0,0.3); 
  border: 2px solid rgba(255,255,255,0.1);
  transition: transform 0.1s, filter 0.1s, box-shadow 0.1s;
}

.music-block.active {
  filter: brightness(1.5);
  box-shadow: 0 0 15px #ffffff;
  border-color: #ffffff;
  transform: scale(1.05);
  z-index: 10;
}

.step-number { position: absolute; top: 4px; left: 6px; font-size: 0.8rem; font-weight: bold; color: rgba(255,255,255,0.5); }
.sound-name { font-size: 1.2rem; font-weight: 900; color: #fff; text-shadow: 1px 1px 0 rgba(0,0,0,0.5); margin-bottom: 5px; }

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

.btn-play-from {
  position: absolute; bottom: 2px;
  background: rgba(255, 255, 255, 0.2); color: white;
  width: auto; padding: 0 6px; height: 20px;
  font-size: 9px; line-height: 20px;
  border-radius: 4px; border: 1px solid rgba(255,255,255,0.3);
}
.btn-play-from:hover { background: rgba(255, 255, 255, 0.9); color: #333; }

.btn-export {
  background-color: #9b59b6; /* 紫系 */
  color: white;
}
.btn-export:hover { background-color: #8e44ad; }
.btn-export:disabled { background-color: #555; cursor: wait; }

/* 追加: ヘルプボタン */
.btn-help {
  background-color: #7f8c8d; /* グレー系 */
  color: white;
  border-radius: 50px; /* 丸っこく */
  padding: 5px 15px;
  font-size: 0.9rem;
}
.btn-help:hover {
  background-color: #95a5a6;
}

</style>