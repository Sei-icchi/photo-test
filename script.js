// ====== Firebaseからは「問題」だけ取得。成績は端末ローカル保存（共有しない） ======
const firebaseConfig = {
  apiKey: "AIzaSyDcWdByC9LIILR19LlAWAor_VtY2y47kUk",
  authDomain: "exampractice-d2ed3.firebaseapp.com",
  databaseURL: "https://exampractice-d2ed3-default-rtdb.firebaseio.com",
  projectId: "exampractice-d2ed3",
};

// Realtime Database REST (読み取り専用)
const DB_URL = firebaseConfig.databaseURL + "/questions.json";

// 成績データは共有しない → ネット送信なし
// 保存方法：localStorage または File System Access API を利用した端末ファイル

// アプリ状態
let questions = {};
let currentQuestion = null;
let currentGenre = [];
let questionHistory = {};   // { [id]: { count, correct, confidence, memo } }
let lastServedId = null;    // 最小回数グループ内の巡回用
let storeMode = "local";    // "local" | "file"
let fileHandle = null;      // File System Access API のハンドル

// ---------- 保存レイヤ ----------
const STORAGE_KEY = "quizResults_local_only";

const ResultStore = {
  async initFromStartScreen() {
    // ストレージモード
    const selected = document.querySelector('input[name="store"]:checked');
    storeMode = selected ? selected.value : "local";

    if (storeMode === "file") {
      // fileHandle が未設定の場合は警告
      if (!fileHandle) {
        alert("ファイル保存を選択しています。『新規ファイルを作成』か『既存ファイルを開く』を行ってください。");
        throw new Error("No file handle");
      }
      // 読み込み（なければ空）
      try {
        questionHistory = await FileStore.load(fileHandle) || {};
      } catch (e) {
        console.warn("ファイルから読み込みに失敗:", e);
        questionHistory = {};
      }
    } else {
      // localStorage
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        questionHistory = raw ? JSON.parse(raw) : {};
      } catch (e) {
        console.warn("localStorage読み込み失敗:", e);
        questionHistory = {};
      }
    }
  },

  async save() {
    if (storeMode === "file") {
      if (!fileHandle) {
        alert("ファイル保存が未設定です。『新規ファイルを作成』または『既存ファイルを開く』を実行してください。");
        return;
      }
      await FileStore.save(fileHandle, questionHistory);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(questionHistory));
    }
  },

  async exportJSON() {
    const blob = new Blob([JSON.stringify(questionHistory, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "quiz_results.json";
    a.click();
    URL.revokeObjectURL(url);
  },

  async importJSON(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    if (typeof data === "object" && data) {
      questionHistory = data;
      await this.save();
      alert("インポートしました。");
    } else {
      alert("JSON形式が不正です。");
    }
  },

  // 設定画面：途中切替（置き換え保存）
  async switchToLocalReplace() {
    storeMode = "local";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(questionHistory));
    alert("ブラウザ保存に切り替えました（現在の成績で置き換え）。");
    updateCurrentStoreLabel();
  },

  async switchToFileReplace(selectedHandle) {
    if (!selectedHandle) {
      alert("ファイルを選択してください。");
      return;
    }
    fileHandle = selectedHandle;
    storeMode = "file";
    await FileStore.save(fileHandle, questionHistory);
    alert("ファイル保存に切り替えました（現在の成績で置き換え）。");
    updateCurrentStoreLabel();
  },

  async loadFromFileReplace(selectedHandle) {
    if (!selectedHandle) {
      alert("ファイルを選択してください。");
      return;
    }
    fileHandle = selectedHandle;
    const data = await FileStore.load(fileHandle);
    questionHistory = data || {};
    await this.save(); // 現在のモードへも保存
    alert("ファイルから読み込み、現在の成績を置き換えました。");
    updateCurrentStoreLabel();
  }
};

// File System Access API（対応ブラウザのみ）
const FileStore = {
  async create() {
    if (!window.showSaveFilePicker) {
      alert("このブラウザはファイル保存の新方式に未対応です。成績画面のエクスポート/インポートをご利用ください。");
      return null;
    }
    const handle = await window.showSaveFilePicker({
      suggestedName: "quiz_results.json",
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
    });
    // 初期ファイルへ空オブジェクトを書き込んでおく
    await this.save(handle, {});
    return handle;
  },

  async open() {
    if (!window.showOpenFilePicker) {
      alert("このブラウザはファイル読み込みの新方式に未対応です。成績画面のインポートをご利用ください。");
      return null;
    }
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
    });
    return handle || null;
  },

  async save(handle, data) {
    const writable = await handle.createWritable();
    await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    await writable.close();
  },

  async load(handle) {
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  },

  async name(handle) {
    try { return handle.name || "選択済み"; } catch { return "選択済み"; }
  }
};

// ---------- 画面イベント ----------
document.addEventListener("DOMContentLoaded", () => {
  // 保存先選択 → ファイル設定UIの表示切替（スタート画面）
  const radios = document.querySelectorAll('input[name="store"]');
  const fileSetup = document.getElementById("file-setup");
  radios.forEach(r => {
    r.addEventListener("change", () => {
      fileSetup.classList.toggle("hidden", r.value !== "file" || !r.checked);
    });
  });

  // ファイル新規作成／既存を開く（スタート画面）
  document.getElementById("create-file-btn")?.addEventListener("click", async () => {
    try {
      const h = await FileStore.create();
      if (h) {
        fileHandle = h;
        const name = await FileStore.name(h);
        document.getElementById("file-status").textContent = `保存先: ${name}`;
      }
    } catch (e) { console.warn(e); }
  });

  document.getElementById("open-file-btn")?.addEventListener("click", async () => {
    try {
      const h = await FileStore.open();
      if (h) {
        fileHandle = h;
        const name = await FileStore.name(h);
        document.getElementById("file-status").textContent = `保存先: ${name}`;
      }
    } catch (e) { console.warn(e); }
  });

  // 成績画面のエクスポート／インポート
  document.getElementById("export-btn")?.addEventListener("click", () => ResultStore.exportJSON());
  document.getElementById("import-input")?.addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (f) await ResultStore.importJSON(f);
  });

  // 設定画面イベント
  document.getElementById("switch-to-local-btn")?.addEventListener("click", async () => {
    await ResultStore.switchToLocalReplace();
  });

  document.getElementById("settings-create-file-btn")?.addEventListener("click", async () => {
    const h = await FileStore.create();
    if (h) {
      fileHandle = h;
      document.getElementById("settings-file-status").textContent = `保存先: ${await FileStore.name(h)}`;
    }
  });

  document.getElementById("settings-open-file-btn")?.addEventListener("click", async () => {
    const h = await FileStore.open();
    if (h) {
      fileHandle = h;
      document.getElementById("settings-file-status").textContent = `保存先: ${await FileStore.name(h)}`;
    }
  });

  document.getElementById("switch-to-file-btn")?.addEventListener("click", async () => {
    if (!fileHandle) {
      alert("『新規ファイルを作成』または『既存ファイルを開く』でファイルを選んでください。");
      return;
    }
    await ResultStore.switchToFileReplace(fileHandle);
  });

  document.getElementById("load-from-file-btn")?.addEventListener("click", async () => {
    if (!fileHandle) {
      alert("『新規ファイルを作成』または『既存ファイルを開く』でファイルを選んでください。");
      return;
    }
    await ResultStore.loadFromFileReplace(fileHandle);
  });

  document.getElementById("settings-close-btn")?.addEventListener("click", () => {
    document.getElementById("settings-screen").classList.add("hidden");
    document.getElementById("quiz-screen").classList.remove("hidden");
  });
});

// スタート
document.getElementById("start-btn").addEventListener("click", async () => {
  // 保存レイヤ初期化（選択モードに応じて読み込み）
  await ResultStore.initFromStartScreen();

  // ジャンル選択
  const checkboxes = document.querySelectorAll("input[type=checkbox]:checked");
  currentGenre = Array.from(checkboxes).map(cb => cb.value);
  if (currentGenre.length === 0) {
    alert("ジャンルを1つ以上選択してください");
    return;
  }

  // 問題データの読込（Firebase Realtime Database / REST）
  try {
    const qRes = await fetch(DB_URL, { cache: "no-store" });
    questions = await qRes.json();
  } catch (e) {
    alert("問題データの取得に失敗しました。databaseURL をご確認ください。");
    return;
  }

  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("quiz-screen").classList.remove("hidden");

  lastServedId = null;
  showNextQuestion();
});

// ---------- 出題ロジック ----------
function idToNum(id) {
  const n = parseInt(String(id).replace(/^0+/, ''), 10);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

// バランス出題（ID順ベース＋未出題/少出題を優先）
function showNextQuestion() {
  const all = Object.values(questions || {});
  let candidates = all.filter(q => currentGenre.includes(q.genre));
  if (candidates.length === 0) {
    alert("対象の問題がありません。");
    return;
  }

  // 出題回数
  const withCount = candidates.map(q => {
    const cnt = questionHistory[q.id]?.count || 0;
    return { q, count: cnt };
  });

  // 最小回数グループ
  const minCount = Math.min(...withCount.map(x => x.count));
  let minGroup = withCount.filter(x => x.count === minCount).map(x => x.q);

  // ID昇順
  minGroup.sort((a, b) => idToNum(a.id) - idToNum(b.id));

  // lastServedIdの次を優先、無ければ先頭
  let next = null;
  if (lastServedId !== null) {
    const lastNum = idToNum(lastServedId);
    next = minGroup.find(q => idToNum(q.id) > lastNum) || null;
  }
  if (!next) next = minGroup[0];

  currentQuestion = next;
  lastServedId = currentQuestion.id;

  displayQuestion();
}

function displayQuestion() {
  const q = currentQuestion;
  document.getElementById("question-container").innerText = q.question;

  // 選択肢
  let choices = ["c1", "c2", "c3", "c4"];
  if (q.c1 === "◯") choices = ["c1", "c2"]; // c1が◯ならc3, c4非表示

  // c1が◯のときは順序固定／それ以外は表示順だけシャッフル
  const displayChoices = (q.c1 === "◯") ? choices : shuffle(choices);

  // 描画
  const container = document.getElementById("choices-container");
  container.innerHTML = "";
  displayChoices.forEach(key => {
    const text = q[key] || "[選択肢未設定]";
    const btn = document.createElement("button");
    btn.className = "choice-button";
    btn.dataset.key = key;
    btn.textContent = text;
    btn.onclick = () => handleAnswer(key, btn);
    container.appendChild(btn);
  });

  // 初期化
  document.getElementById("feedback").classList.add("hidden");
  document.getElementById("confidence-container").classList.add("hidden");

  // メモ復元
  const memoInput = document.getElementById("memo");
  memoInput.value = questionHistory[q.id]?.memo || "";

  // 自信度復元（回答回数0なら無色）
  const saved = questionHistory[q.id];
  const savedConfidence = saved?.confidence;
  const savedCount = saved?.count || 0;
  document.querySelectorAll(".confidence").forEach(btn => {
    btn.classList.remove("selected");
    if (savedCount > 0 && btn.dataset.level === savedConfidence) {
      btn.classList.add("selected");
    }
  });

  // コントロール行（再生成）
  const existing = document.getElementById("control-buttons");
  if (existing) existing.remove();
  const control = document.createElement("div");
  control.id = "control-buttons";

  // 成績（Nextの左）
  const scoreBtn = document.createElement("button");
  scoreBtn.id = "score-btn";
  scoreBtn.textContent = "成績";
  scoreBtn.onclick = () => showScore();
  control.appendChild(scoreBtn);

  // 設定（保存先切替）
  const settingsBtn = document.createElement("button");
  settingsBtn.id = "settings-btn";
  settingsBtn.textContent = "設定";
  settingsBtn.onclick = () => showSettings();
  control.appendChild(settingsBtn);

  // Next（自信度が未設定なら無効）
  const nextBtn = document.createElement("button");
  nextBtn.id = "next-btn";
  nextBtn.textContent = "Next";
  nextBtn.disabled = !(savedConfidence && savedCount > 0);
  nextBtn.onclick = async () => {
    if (!questionHistory[q.id]) questionHistory[q.id] = {};
    questionHistory[q.id].memo = memoInput.value;
    await ResultStore.save();  // ローカルへ保存
    showNextQuestion();
  };
  control.appendChild(nextBtn);

  // Exit
  const exitBtn = document.createElement("button");
  exitBtn.id = "exit-btn";
  exitBtn.textContent = "Exit";
  exitBtn.onclick = () => {
    document.getElementById("quiz-screen").classList.add("hidden");
    document.getElementById("start-screen").classList.remove("hidden");
  };
  control.appendChild(exitBtn);

  document.getElementById("confidence-container").appendChild(control);
}

function handleAnswer(selectedKey, button) {
  const isCorrect = selectedKey === currentQuestion.answer;

  // ボタン固定
  const buttons = document.querySelectorAll(".choice-button");
  buttons.forEach(btn => btn.disabled = true);

  // 色付け
  buttons.forEach(btn => {
    if (btn.dataset.key === currentQuestion.answer) {
      btn.classList.add("correct");
    } else if (btn === button && !isCorrect) {
      btn.classList.add("incorrect");
    }
  });

  // フィードバック
  document.getElementById("feedback").classList.remove("hidden");
  document.getElementById("feedback").innerText = isCorrect ? "正解！" : "不正解！";
  document.getElementById("confidence-container").classList.remove("hidden");

  // 履歴更新（累積）
  if (!questionHistory[currentQuestion.id]) questionHistory[currentQuestion.id] = {};
  questionHistory[currentQuestion.id].correct = isCorrect; // 直近の正誤（必要に応じて累計に拡張可能）
  questionHistory[currentQuestion.id].count = (questionHistory[currentQuestion.id].count || 0) + 1;

  // 自信度選択で色付け＆Next解放＆保存
  document.querySelectorAll(".confidence").forEach(btn => {
    btn.onclick = async () => {
      questionHistory[currentQuestion.id].confidence = btn.dataset.level;
      document.querySelectorAll(".confidence").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      const nextBtn = document.getElementById("next-btn");
      if (nextBtn) nextBtn.disabled = false;
      await ResultStore.save(); // 自信度選択のタイミングでも保存
    };
  });

  // 回答直後にも保存
  ResultStore.save();
}

// 選択肢のシャッフル（出題の抽選には使わない）
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// 成績一覧
function showScore() {
  const scoreScreen = document.getElementById("score-screen");
  const scoreTable = document.getElementById("score-table");
  scoreTable.innerHTML = "";

  const table = document.createElement("table");
  const header = document.createElement("tr");
  ["ID", "問題", "出題回数", "正解数(直近)", "自信度", "メモ"].forEach(text => {
    const th = document.createElement("th");
    th.innerText = text;
    header.appendChild(th);
  });
  table.appendChild(header);

  Object.keys(questionHistory)
    .sort((a, b) => idToNum(a) - idToNum(b))
    .forEach(id => {
      const q = questions[id];
      const h = questionHistory[id];
      if (!q || !h) return;

      const tr = document.createElement("tr");
      const correctCount = h.correct ? 1 : 0; // 直近正誤を1/0表示（必要に応じて累計に拡張可）
      [id, q.question, h.count || 0, correctCount, h.confidence || "", h.memo || ""].forEach(val => {
        const td = document.createElement("td");
        td.innerText = val;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

  scoreTable.appendChild(table);
  document.getElementById("quiz-screen").classList.add("hidden");
  scoreScreen.classList.remove("hidden");
}

function backToQuiz() {
  document.getElementById("score-screen").classList.add("hidden");
  document.getElementById("quiz-screen").classList.remove("hidden");
}

// 設定画面（途中切替UI）
function showSettings() {
  updateCurrentStoreLabel();
  document.getElementById("quiz-screen").classList.add("hidden");
  document.getElementById("settings-screen").classList.remove("hidden");
}

function updateCurrentStoreLabel() {
  const label = document.getElementById("current-store-label");
  label.textContent = storeMode === "file" ? "端末ファイル保存" : "ブラウザ保存";
  // 併せてファイル名表示
  const status = document.getElementById("settings-file-status");
  if (storeMode === "file" && fileHandle) {
    FileStore.name(fileHandle).then(name => status.textContent = `保存先: ${name}`);
  }
}
