// ====== Firebaseからは「問題」だけ取得。成績は端末ローカル保存 or 端末ファイル保存（共有しない） ======
const firebaseConfig = {
  apiKey: "AIzaSyDcWdByC9LIILR19LlAWAor_VtY2y47kUk",
  authDomain: "exampractice-d2ed3.firebaseapp.com",
  databaseURL: "https://exampractice-d2ed3-default-rtdb.firebaseio.com",
  projectId: "exampractice-d2ed3",
};

const DB_URL = firebaseConfig.databaseURL + "/questions.json";

// アプリ状態
let questions = {};
let currentQuestion = null;
let currentGenre = [];
let questionHistory = {};   // { [id]: { count, correct, confidence, memo } }
let lastServedId = null;
let storeMode = null;       // "local" | "file"
let fileHandle = null;

// ストレージキー
const STORAGE_KEY = "quizResults_local_only";
const PREF_KEY = "quizStoragePreference"; // "local" or "file" を保存

// ===== 保存実装 =====
const ResultStore = {
  async initByPreference() {
    // 事前に選択済みならそれに従ってロード
    storeMode = localStorage.getItem(PREF_KEY) || null;

    if (!storeMode) {
      // 未設定 → モーダル表示で設定させる
      openStorageModal();
      throw new Error("Storage preference not set");
    }

    if (storeMode === "file") {
      if (!fileHandle) {
        // ファイルハンドルがない → モーダルで再選択させる
        openStorageModal();
        throw new Error("No file handle");
      }
      try {
        questionHistory = await FileStore.load(fileHandle) || {};
      } catch {
        questionHistory = {};
      }
    } else {
      // local
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        questionHistory = raw ? JSON.parse(raw) : {};
      } catch {
        questionHistory = {};
      }
    }
  },

  async save() {
    if (storeMode === "file") {
      if (!fileHandle) {
        // 保存先が未確定 → モーダル
        openStorageModal();
        return;
      }
      await FileStore.save(fileHandle, questionHistory);
    } else if (storeMode === "local") {
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

  async switchToLocalReplace() {
    storeMode = "local";
    localStorage.setItem(PREF_KEY, "local");
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
    localStorage.setItem(PREF_KEY, "file");
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
    await this.save();
    alert("ファイルから読み込み、現在の成績を置き換えました。");
    updateCurrentStoreLabel();
  },

  async resetAll() {
    // すべての成績データを削除し初期化、保存先設定もクリア
    questionHistory = {};
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(PREF_KEY);
    fileHandle = null;
    storeMode = null;
    // 画面遷移：初期画面へ戻し、保存先モーダルを開く
    document.getElementById("settings-screen").classList.add("hidden");
    document.getElementById("score-screen").classList.add("hidden");
    document.getElementById("quiz-screen").classList.add("hidden");
    document.getElementById("start-screen").classList.remove("hidden");
    openStorageModal();
  }
};

// File System Access API
const FileStore = {
  async create() {
    if (!window.showSaveFilePicker) {
      alert("このブラウザはファイル保存の新方式に未対応です。エクスポート/インポートをご利用ください。");
      return null;
    }
    const handle = await window.showSaveFilePicker({
      suggestedName: "quiz_results.json",
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }]
    });
    await this.save(handle, {});
    return handle;
  },
  async open() {
    if (!window.showOpenFilePicker) {
      alert("このブラウザはファイル読み込みの新方式に未対応です。インポートをご利用ください。");
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

// ===== 画面イベント =====
document.addEventListener("DOMContentLoaded", () => {
  // 起動時：保存先が未設定 or 保存データが無ければモーダルを出す
  const pref = localStorage.getItem(PREF_KEY);
  const hasLocal = !!localStorage.getItem(STORAGE_KEY);
  if (!pref && !hasLocal) {
    openStorageModal();
  }

  // ===== モーダル：保存先ラジオの切替でUI更新 =====
  document.querySelectorAll('#storage-modal input[name="store"]').forEach(r => {
    r.addEventListener("change", updateStorageModalUI);
  });

  // モーダル：ファイル作成/既存選択
  document.getElementById("modal-create-file-btn")?.addEventListener("click", async () => {
    const h = await FileStore.create();
    if (h) {
      fileHandle = h;
      document.getElementById("modal-file-status").textContent = `保存先: ${await FileStore.name(h)}`;
      updateStorageModalUI();
    }
  });
  document.getElementById("modal-open-file-btn")?.addEventListener("click", async () => {
    const h = await FileStore.open();
    if (h) {
      fileHandle = h;
      document.getElementById("modal-file-status").textContent = `保存先: ${await FileStore.name(h)}`;
      updateStorageModalUI();
    }
  });

  // モーダル：保存先確定
  document.getElementById("modal-save-store-btn")?.addEventListener("click", async () => {
    const selected = document.querySelector('#storage-modal input[name="store"]:checked')?.value || "local";

    // file のときはファイル必須
    if (selected === "file" && !fileHandle) {
      alert("ファイル保存を選んだ場合は、ファイルを作成または選択してください。");
      return;
    }

    // 設定反映
    storeMode = selected;
    localStorage.setItem(PREF_KEY, storeMode);

    // 初期データの用意（任意：空を書いておく）
    if (storeMode === "local") {
      if (!localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({}));
      }
    } else if (storeMode === "file" && fileHandle) {
      try {
        const existing = await FileStore.load(fileHandle);
        if (!existing || typeof existing !== "object") {
          await FileStore.save(fileHandle, {});
        }
      } catch {
        await FileStore.save(fileHandle, {});
      }
    }

    // UI を閉じる
    closeStorageModal();
  });

  // 成績画面：エクスポート/インポート
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
    if (!fileHandle) return alert("ファイルを選択してください。");
    await ResultStore.switchToFileReplace(fileHandle);
  });
  document.getElementById("load-from-file-btn")?.addEventListener("click", async () => {
    if (!fileHandle) return alert("ファイルを選択してください。");
    await ResultStore.loadFromFileReplace(fileHandle);
  });
  document.getElementById("reset-results-btn")?.addEventListener("click", async () => {
    if (confirm("本当に全成績をリセットしますか？")) {
      await ResultStore.resetAll();
    }
  });
  document.getElementById("settings-close-btn")?.addEventListener("click", () => {
    document.getElementById("settings-screen").classList.add("hidden");
    document.getElementById("quiz-screen").classList.remove("hidden");
    showGlobalControls(true);
  });

  // 常設コントロールのイベント（クイズ画面用）
  document.getElementById("score-btn")?.addEventListener("click", () => {
    showGlobalControls(false);
    showScore();
  });
  document.getElementById("settings-btn")?.addEventListener("click", () => {
    showSettings();
  });
  document.getElementById("exit-btn")?.addEventListener("click", () => {
    document.getElementById("quiz-screen").classList.add("hidden");
    document.getElementById("score-screen").classList.add("hidden");
    document.getElementById("settings-screen").classList.add("hidden");
    document.getElementById("start-screen").classList.remove("hidden");
    showGlobalControls(false);
  });
});

// スタート
document.getElementById("start-btn").addEventListener("click", async () => {
  try {
    await ResultStore.initByPreference(); // 保存先設定が未完了ならここでモーダルが出る
  } catch {
    return; // 設定完了後に再度スタートを押してもらう
  }

  // ジャンル選択
  const checkboxes = document.querySelectorAll("input[type=checkbox]:checked");
  currentGenre = Array.from(checkboxes).map(cb => cb.value);
  if (currentGenre.length === 0) {
    alert("ジャンルを1つ以上選択してください");
    return;
  }

  // 問題データの読込
  try {
    const qRes = await fetch(DB_URL, { cache: "no-store" });
    questions = await qRes.json();
  } catch (e) {
    alert("問題データの取得に失敗しました。databaseURL をご確認ください。");
    return;
  }

  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("quiz-screen").classList.remove("hidden");
  showGlobalControls(true);

  lastServedId = null;
  showNextQuestion();
});

// ===== 出題ロジック（ID順ベース＋未出題/少出題優先） =====
function idToNum(id) {
  const n = parseInt(String(id).replace(/^0+/, ''), 10);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

function showNextQuestion() {
  const all = Object.values(questions || {});
  let candidates = all.filter(q => currentGenre.includes(q.genre));
  if (candidates.length === 0) {
    alert("対象の問題がありません。");
    return;
  }

  const withCount = candidates.map(q => ({ q, count: (questionHistory[q.id]?.count || 0) }));
  const minCount = Math.min(...withCount.map(x => x.count));
  let minGroup = withCount.filter(x => x.count === minCount).map(x => x.q);

  minGroup.sort((a, b) => idToNum(a.id) - idToNum(b.id));

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

  // NEXT 有効/無効
  const nextBtn = document.getElementById("next-btn");
  nextBtn.disabled = !(savedConfidence && savedCount > 0);
}

function handleAnswer(selectedKey, button) {
  const isCorrect = selectedKey === currentQuestion.answer;

  // ボタン固定 & 色付け
  const buttons = document.querySelectorAll(".choice-button");
  buttons.forEach(btn => btn.disabled = true);
  buttons.forEach(btn => {
    if (btn.dataset.key === currentQuestion.answer) {
      btn.classList.add("correct");
    } else if (btn === button && !isCorrect) {
      btn.classList.add("incorrect");
    }
  });

  // フィードバック
  const fb = document.getElementById("feedback");
  fb.classList.remove("hidden");
  fb.innerText = isCorrect ? "正解！" : "不正解！";

  // 履歴更新
  if (!questionHistory[currentQuestion.id]) questionHistory[currentQuestion.id] = {};
  questionHistory[currentQuestion.id].correct = isCorrect; // 直近
  questionHistory[currentQuestion.id].count = (questionHistory[currentQuestion.id].count || 0) + 1;

  // 自信度選択で色付け＆NEXT解放＆保存
  document.querySelectorAll(".confidence").forEach(btn => {
    btn.onclick = async () => {
      questionHistory[currentQuestion.id].confidence = btn.dataset.level;
      document.querySelectorAll(".confidence").forEach(b => b.classList.remove("selected"));
      btn.classList.add("selected");
      document.getElementById("next-btn").disabled = false;
      await ResultStore.save();
    };
  });

  // 回答直後の保存
  ResultStore.save();
}

// 選択肢シャッフル（出題抽選には不使用）
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
      const correctCount = h.correct ? 1 : 0; // 直近正誤（必要なら累計に拡張）
      [id, q.question, h.count || 0, correctCount, h.confidence || "", h.memo || ""].forEach(val => {
        const td = document.createElement("td");
        td.innerText = val;
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });

  document.getElementById("quiz-screen").classList.add("hidden");
  scoreScreen.classList.remove("hidden");
  showGlobalControls(false);
}

function backToQuiz() {
  document.getElementById("score-screen").classList.add("hidden");
  document.getElementById("quiz-screen").classList.remove("hidden");
  showGlobalControls(true);
}

// 設定画面
function showSettings() {
  updateCurrentStoreLabel();
  document.getElementById("quiz-screen").classList.add("hidden");
  document.getElementById("settings-screen").classList.remove("hidden");
  showGlobalControls(false);
}
function updateCurrentStoreLabel() {
  const label = document.getElementById("current-store-label");
  label.textContent = storeMode === "file" ? "端末ファイル保存" : (storeMode === "local" ? "ブラウザ保存" : "未設定");
  const status = document.getElementById("settings-file-status");
  if (storeMode === "file" && fileHandle) {
    FileStore.name(fileHandle).then(name => status.textContent = `保存先: ${name}`);
  }
}

// グローバルコントロールの表示切替（クイズ画面のみ表示）
function showGlobalControls(show) {
  document.getElementById("global-controls").style.display = show ? "flex" : "none";
}

// === 追加：モーダルのボタン活性/表示切替 ===
function updateStorageModalUI() {
  const selected = document.querySelector('#storage-modal input[name="store"]:checked')?.value || "local";
  const fileSetup = document.getElementById("modal-file-setup");
  const saveBtn = document.getElementById("modal-save-store-btn");

  // file 選択時のみファイル操作UIを表示
  fileSetup.classList.toggle("hidden", selected !== "file");

  // file 選択かつ fileHandle 未設定なら決定ボタンを無効化
  if (selected === "file" && !fileHandle) {
    saveBtn.disabled = true;
  } else {
    saveBtn.disabled = false;
  }
}

// 保存先モーダル
function openStorageModal() {
  const modal = document.getElementById("storage-modal");
  modal.classList.remove("hidden");

  // デフォルト local にセット
  const localRadio = modal.querySelector('input[value="local"]');
  if (localRadio) localRadio.checked = true;

  // ファイル UI 初期化
  document.getElementById("modal-file-status").textContent = "未設定";
  document.getElementById("modal-file-setup").classList.add("hidden");

  // 決定ボタン活性制御
  updateStorageModalUI();
}
function closeStorageModal() {
  document.getElementById("storage-modal").classList.add("hidden");
}
