/* ========= 設定 ========= */
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
};
const DB_URL = firebaseConfig.databaseURL + "/questions.json";

/* ========= アプリ状態 ========= */
let questions = {};
let currentQuestion = null;
let currentGenre = [];
let questionHistory = {};     // { [id]: { count, correct, confidence, memo } }
let lastServedId = null;

let storeMode = localStorage.getItem("STORE_MODE") || null; // "local" | "file" | null
let fileHandle = null; // File System Access API ハンドル

const STORAGE_KEY = "quizResults_local_only";

/* ========= File Store ========= */
const FileStore = {
  async create() {
    if (!window.showSaveFilePicker) {
      alert("このブラウザはファイル保存に未対応です。エクスポート/インポートをご利用ください。");
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
      alert("このブラウザはファイル読み込みに未対応です。インポートをご利用ください。");
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
    const f = await handle.getFile();
    const text = await f.text();
    return JSON.parse(text);
  },
  async name(handle){ try{return handle.name||"選択済み"}catch{return"選択済み"} }
};

/* ========= Result Store ========= */
const ResultStore = {
  async bootstrapStorage() {
    const existsLocal = !!localStorage.getItem(STORAGE_KEY);
    const hasMode = !!storeMode;
    if (!hasMode && !existsLocal) {
      openStorageModal(); // 成績無し＆未設定 → モーダルで保存先選択
      return false;
    }
    if (!storeMode && existsLocal) { // 既存ローカルがあれば local と判断
      storeMode = "local";
      localStorage.setItem("STORE_MODE", storeMode);
    }
    await this.loadToMemory();
    return true;
  },

  async loadToMemory() {
    if (storeMode === "file") {
      if (!fileHandle) { questionHistory = {}; return; }
      try { questionHistory = await FileStore.load(fileHandle) || {}; }
      catch { questionHistory = {}; }
    } else {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        questionHistory = raw ? JSON.parse(raw) : {};
      } catch { questionHistory = {}; }
    }
  },

  async save() {
    if (storeMode === "file") {
      if (!fileHandle) {
        alert("ファイル保存が未設定です。『設定』からファイルを選んでください。");
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
    const a = Object.assign(document.createElement("a"), { href:url, download:"quiz_results.json" });
    a.click(); URL.revokeObjectURL(url);
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
    localStorage.setItem("STORE_MODE", storeMode);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(questionHistory));
    updateCurrentStoreLabel();
    alert("ブラウザ保存に切り替えました（現在の成績で置き換え）。");
  },

  async switchToFileReplace(selectedHandle) {
    if (!selectedHandle) { alert("ファイルを選択してください。"); return; }
    fileHandle = selectedHandle;
    storeMode = "file";
    localStorage.setItem("STORE_MODE", storeMode);
    await FileStore.save(fileHandle, questionHistory);
    updateCurrentStoreLabel();
    alert("ファイル保存に切り替えました（現在の成績で置き換え）。");
  },

  async loadFromFileReplace(selectedHandle) {
    if (!selectedHandle) { alert("ファイルを選択してください。"); return; }
    fileHandle = selectedHandle;
    const data = await FileStore.load(fileHandle);
    questionHistory = data || {};
    await this.save();
    updateCurrentStoreLabel();
    alert("ファイルから読み込み、現在の成績を置き換えました。");
  },

  async resetAll() {
    questionHistory = {};
    localStorage.removeItem(STORAGE_KEY);
    if (storeMode === "file" && fileHandle) {
      await FileStore.save(fileHandle, {});
    }
    storeMode = null;
    localStorage.removeItem("STORE_MODE");
  }
};

/* ========= 画面初期化 ========= */
document.addEventListener("DOMContentLoaded", async () => {
  showFooter(false); // 初期状態で非表示

  // ストレージ状態チェック
  await ResultStore.bootstrapStorage();

  // モーダル：ラジオでUI切替
  document.querySelectorAll('input[name="store-modal"]').forEach(r => {
    r.addEventListener("change", () => {
      const isFile = r.value === "file" && r.checked;
      document.getElementById("modal-file-setup").classList.toggle("hidden", !isFile);
    });
  });
  // モーダル：新規/既存
  document.getElementById("modal-create-file-btn")?.addEventListener("click", async () => {
    const h = await FileStore.create();
    if (h) {
      fileHandle = h;
      document.getElementById("modal-file-status").textContent = `保存先: ${await FileStore.name(h)}`;
    }
  });
  document.getElementById("modal-open-file-btn")?.addEventListener("click", async () => {
    const h = await FileStore.open();
    if (h) {
      fileHandle = h;
      document.getElementById("modal-file-status").textContent = `保存先: ${await FileStore.name(h)}`;
    }
  });
  // モーダル：決定
  document.getElementById("storage-confirm-btn")?.addEventListener("click", async () => {
    const selected = document.querySelector('input[name="store-modal"]:checked')?.value || "local";
    if (selected === "file" && !fileHandle) {
      alert("ファイル保存を選ぶ場合は『新規ファイルを作成』または『既存ファイルを開く』を実行してください。");
      return;
    }
    storeMode = selected;
    localStorage.setItem("STORE_MODE", storeMode);
    await ResultStore.loadToMemory();
    closeStorageModal();
  });

  // 成績：エクスポート/インポート/戻る
  document.getElementById("export-btn")?.addEventListener("click", () => ResultStore.exportJSON());
  document.getElementById("import-input")?.addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (f) await ResultStore.importJSON(f);
  });
  document.getElementById("back-to-quiz-btn")?.addEventListener("click", () => {
    showOnly("quiz"); // ここでフッター復活
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
    if (!fileHandle) { alert("ファイルを選択してください。"); return; }
    await ResultStore.switchToFileReplace(fileHandle);
  });
  document.getElementById("load-from-file-btn")?.addEventListener("click", async () => {
    if (!fileHandle) { alert("ファイルを選択してください。"); return; }
    await ResultStore.loadFromFileReplace(fileHandle);
  });
  document.getElementById("reset-results-btn")?.addEventListener("click", async () => {
    if (!confirm("本当に成績データをリセットしますか？")) return;
    await ResultStore.resetAll();
    // 初期画面に戻して、保存先選択モーダルを表示
    showOnly("start");
    openStorageModal();
  });
});

/* ========= Start ========= */
document.getElementById("start-btn").addEventListener("click", async () => {
  if (!storeMode) { openStorageModal(); return; }

  // ジャンル
  const checkboxes = document.querySelectorAll("input[type=checkbox]:checked");
  currentGenre = Array.from(checkboxes).map(cb => cb.value);
  if (currentGenre.length === 0) { alert("ジャンルを1つ以上選択してください"); return; }

  // 問題取得（REST）
  try {
    const qRes = await fetch(DB_URL, { cache: "no-store" });
    questions = await qRes.json();
  } catch {
    alert("問題データの取得に失敗しました。databaseURL を確認してください。");
    return;
  }

  lastServedId = null;
  showOnly("quiz");  // ここでフッターも表示
  showNextQuestion();
});

/* ========= フッター常設 ========= */
document.getElementById("footer-score-btn").addEventListener("click", () => {
  buildScoreTable();
  showOnly("score"); // 成績画面ではフッターを無効化（非表示）
});
document.getElementById("footer-settings-btn").addEventListener("click", () => {
  updateCurrentStoreLabel();
  showOnly("settings"); // 設定画面ではフッター表示のまま
});
document.getElementById("footer-next-btn").addEventListener("click", async () => {
  if (!currentQuestion) return;
  const memoInput = document.getElementById("memo");
  if (memoInput) {
    if (!questionHistory[currentQuestion.id]) questionHistory[currentQuestion.id] = {};
    questionHistory[currentQuestion.id].memo = memoInput.value;
  }
  await ResultStore.save();
  showNextQuestion();
});
document.getElementById("footer-exit-btn").addEventListener("click", () => {
  showOnly("start"); // 開始画面ではフッター非表示
});

/* ========= 出題ロジック ========= */
function idToNum(id){
  const n = parseInt(String(id).replace(/^0+/,''),10);
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

// ID順ベース＋未出題/少出題を優先
function showNextQuestion(){
  const all = Object.values(questions || {});
  let candidates = all.filter(q => currentGenre.includes(q.genre));
  if (candidates.length === 0) { alert("対象の問題がありません。"); return; }

  const withCount = candidates.map(q => ({ q, count:(questionHistory[q.id]?.count || 0) }));
  const minCount = Math.min(...withCount.map(x => x.count));
  let minGroup = withCount.filter(x => x.count === minCount).map(x => x.q);
  minGroup.sort((a,b) => idToNum(a.id) - idToNum(b.id));

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

function displayQuestion(){
  const q = currentQuestion;
  document.getElementById("question-container").innerText = q.question;

  // 選択肢
  let keys = ["c1","c2","c3","c4"];
  if (q.c1 === "◯") keys = ["c1","c2"]; // c1が◯ならc3/c4は非表示
  const order = (q.c1 === "◯") ? keys : shuffle(keys);

  const box = document.getElementById("choices-container");
  box.innerHTML = "";
  order.forEach(k => {
    const btn = document.createElement("button");
    btn.className = "choice-button";
    btn.dataset.key = k;
    btn.textContent = q[k] || "[選択肢未設定]";
    btn.onclick = () => handleAnswer(k, btn);
    box.appendChild(btn);
  });

  // 初期化
  document.getElementById("feedback").classList.add("hidden");
  document.getElementById("confidence-container").classList.add("hidden");
  const memo = document.getElementById("memo");
  memo.value = questionHistory[q.id]?.memo || "";

  // 自信度復元（回答回数0なら無色）
  const saved = questionHistory[q.id];
  const savedConfidence = saved?.confidence;
  const savedCount = saved?.count || 0;
  document.querySelectorAll(".confidence").forEach(b=>{
    b.classList.remove("selected");
    if (savedCount > 0 && b.dataset.level === savedConfidence) b.classList.add("selected");
  });

  // NEXTは自信度未選択なら無効
  const nextBtn = document.getElementById("footer-next-btn");
  nextBtn.disabled = !(savedConfidence && savedCount > 0);
}

function handleAnswer(selectedKey, button){
  const isCorrect = selectedKey === currentQuestion.answer;

  // ボタンロック＆色付け
  const buttons = document.querySelectorAll(".choice-button");
  buttons.forEach(b => b.disabled = true);
  buttons.forEach(b=>{
    if (b.dataset.key === currentQuestion.answer) b.classList.add("correct");
    else if (b === button && !isCorrect) b.classList.add("incorrect");
  });

  // フィードバック・自信度
  document.getElementById("feedback").classList.remove("hidden");
  document.getElementById("feedback").innerText = isCorrect ? "正解！" : "不正解！";
  document.getElementById("confidence-container").classList.remove("hidden");

  // 履歴更新
  if (!questionHistory[currentQuestion.id]) questionHistory[currentQuestion.id] = {};
  questionHistory[currentQuestion.id].correct = isCorrect;
  questionHistory[currentQuestion.id].count = (questionHistory[currentQuestion.id].count || 0) + 1;

  // 自信度選択で NEXT 解放＆保存
  document.querySelectorAll(".confidence").forEach(b=>{
    b.onclick = async ()=>{
      questionHistory[currentQuestion.id].confidence = b.dataset.level;
      document.querySelectorAll(".confidence").forEach(x=>x.classList.remove("selected"));
      b.classList.add("selected");
      document.getElementById("footer-next-btn").disabled = false;
      await ResultStore.save();
    };
  });

  ResultStore.save();
}

/* ========= 成績 ========= */
function buildScoreTable(){
  const scoreTable = document.getElementById("score-table");
  scoreTable.innerHTML = "";

  const table = document.createElement("table");
  const header = document.createElement("tr");
  ["ID","問題","出題回数","正解数(直近)","自信度","メモ"].forEach(t=>{
    const th = document.createElement("th"); th.innerText = t; header.appendChild(th);
  });
  table.appendChild(header);

  Object.keys(questionHistory).sort((a,b)=>idToNum(a)-idToNum(b)).forEach(id=>{
    const q = questions[id]; const h = questionHistory[id]; if (!q || !h) return;
    const tr = document.createElement("tr");
    const correctCount = h.correct ? 1 : 0;
    [id, q.question, h.count||0, correctCount, h.confidence||"", h.memo||""].forEach(val=>{
      const td = document.createElement("td"); td.innerText = val; tr.appendChild(td);
    });
    table.appendChild(tr);
  });

  scoreTable.appendChild(table);
}

/* ========= ユーティリティ ========= */
function shuffle(arr){
  const a = [...arr];
  for (let i=a.length-1;i>0;i--){
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i+1);
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

function showOnly(which){
  // 画面切替
  document.getElementById("start-screen").classList.add("hidden");
  document.getElementById("quiz-screen").classList.add("hidden");
  document.getElementById("score-screen").classList.add("hidden");
  document.getElementById("settings-screen").classList.add("hidden");

  if (which==="start") document.getElementById("start-screen").classList.remove("hidden");
  if (which==="quiz") document.getElementById("quiz-screen").classList.remove("hidden");
  if (which==="score") document.getElementById("score-screen").classList.remove("hidden");
  if (which==="settings") document.getElementById("settings-screen").classList.remove("hidden");

  // フッター表示制御：
  // - start: 非表示
  // - quiz: 表示
  // - settings: 表示
  // - score: 非表示（ご要望）
  if (which === "quiz" || which === "settings") {
    showFooter(true);
  } else {
    showFooter(false);
  }
}

function showFooter(show){
  document.getElementById("app-footer").classList.toggle("hidden", !show);
}

function openStorageModal(){
  document.getElementById("storage-modal").classList.remove("hidden");
  const selected = document.querySelector('input[name="store-modal"]:checked')?.value || "local";
  document.getElementById("modal-file-setup").classList.toggle("hidden", selected!=="file");
}
function closeStorageModal(){
  document.getElementById("storage-modal").classList.add("hidden");
}
function updateCurrentStoreLabel(){
  const label = document.getElementById("current-store-label");
  label.textContent = storeMode === "file" ? "端末ファイル保存" : "ブラウザ保存";
}
