"use strict";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const pad2 = value => String(value).padStart(2, "0");
const monthKey = (year, month) => `${year}-${pad2(month)}`;
const currentDate = new Date();
const DEFAULT_SETTINGS = {
  key: "main",
  startYear: 2016,
  endYear: currentDate.getFullYear(),
  tepraModel: "SR5900P",
  tepraModelRevision: 2,
  tapeWidth: 12
};
const TILE_COLORS = ["#ee6f67", "#6bb7ae", "#5a84c6", "#f2ad45", "#8d72b7", "#86b66c"];
const DB_NAME = "omoide-timeline";
const DB_VERSION = 2;

const els = {
  timelineView: $("#timelineView"), candidateView: $("#candidateView"), editorView: $("#editorView"), timelineGrid: $("#timelineGrid"),
  timelineScroller: $("#timelineScroller"), rangeLabel: $("#rangeLabel"), homeButton: $("#homeButton"),
  candidateButton: $("#candidateButton"), candidateBadge: $("#candidateBadge"), candidateBackButton: $("#candidateBackButton"),
  candidateMonthInput: $("#candidateMonthInput"), calendarImportButton: $("#calendarImportButton"),
  monthPhotoSearchButton: $("#monthPhotoSearchButton"), candidatePhotoInput: $("#candidatePhotoInput"),
  calendarStatus: $("#calendarStatus"), calendarEventList: $("#calendarEventList"),
  candidateMonthCount: $("#candidateMonthCount"), candidateGrid: $("#candidateGrid"), candidateEmpty: $("#candidateEmpty"),
  candidateSelectionCount: $("#candidateSelectionCount"), selectKeptButton: $("#selectKeptButton"),
  clearCandidateSelectionButton: $("#clearCandidateSelectionButton"), addCandidatesButton: $("#addCandidatesButton"),
  jumpTodayButton: $("#jumpTodayButton"), printSheetButton: $("#printSheetButton"),
  backupButton: $("#backupButton"), restoreButton: $("#restoreButton"), restoreInput: $("#restoreInput"),
  settingsButton: $("#settingsButton"), installButton: $("#installButton"),
  editorTitle: $("#editorTitle"), backButton: $("#backButton"), saveState: $("#saveState"),
  canvas: $("#collageCanvas"), canvasEmpty: $("#canvasEmpty"), photoInput: $("#photoInput"),
  openMonthCandidatesButton: $("#openMonthCandidatesButton"),
  photoStrip: $("#photoStrip"), photoCount: $("#photoCount"), photoControls: $("#photoControls"),
  photoModeButton: $("#photoModeButton"), frameModeButton: $("#frameModeButton"),
  zoomInput: $("#zoomInput"), zoomOutput: $("#zoomOutput"), resetPhotoButton: $("#resetPhotoButton"),
  sendBackButton: $("#sendBackButton"), bringFrontButton: $("#bringFrontButton"), deletePhotoButton: $("#deletePhotoButton"),
  yearInput: $("#yearInput"), monthInput: $("#monthInput"), eventsInput: $("#eventsInput"),
  overlayDateInput: $("#overlayDateInput"), monthStatusPill: $("#monthStatusPill"),
  labelPreview: $("#labelPreview"), tepraModelLabel: $("#tepraModelLabel"),
  copyDateButton: $("#copyDateButton"), copyEventsButton: $("#copyEventsButton"), exportLabelsButton: $("#exportLabelsButton"),
  tepraPrinterStatus: $("#tepraPrinterStatus"), nativeTepraActions: $("#nativeTepraActions"),
  tepraSearchButton: $("#tepraSearchButton"), tepraPrintButton: $("#tepraPrintButton"),
  tepraSdkAttribution: $("#tepraSdkAttribution"),
  downloadButton: $("#downloadButton"), shareButton: $("#shareButton"), printCurrentButton: $("#printCurrentButton"),
  markPrintedButton: $("#markPrintedButton"), settingsDialog: $("#settingsDialog"), settingsForm: $("#settingsForm"),
  settingsBackupButton: $("#settingsBackupButton"), settingsRestoreButton: $("#settingsRestoreButton"),
  startYearInput: $("#startYearInput"), endYearInput: $("#endYearInput"), tepraModelInput: $("#tepraModelInput"),
  tapeWidthInput: $("#tapeWidthInput"), printDialog: $("#printDialog"), printForm: $("#printForm"),
  printMonthList: $("#printMonthList"), selectUnprintedButton: $("#selectUnprintedButton"),
  selectAllButton: $("#selectAllButton"), clearSelectionButton: $("#clearSelectionButton"), toast: $("#toast")
};

const state = {
  db: null,
  settings: { ...DEFAULT_SETTINGS },
  records: new Map(),
  candidates: new Map(),
  calendarMonths: new Map(),
  record: null,
  images: new Map(),
  selectedId: null,
  editMode: "photo",
  pointer: null,
  saveTimer: null,
  gridUrls: [],
  candidateUrls: [],
  printUrls: [],
  installPrompt: null,
  nativeInfo: null,
  webMcpAbort: null,
  dbReady: false,
  candidateMonthKey: monthKey(currentDate.getFullYear(), currentDate.getMonth() + 1),
  candidateFilter: "active",
  selectedCandidates: new Set(),
  pendingNativeImages: [],
  nativeIngestChain: Promise.resolve()
};

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("months")) db.createObjectStore("months", { keyPath: "key" });
      if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!db.objectStoreNames.contains("candidates")) db.createObjectStore("candidates", { keyPath: "id" });
      if (!db.objectStoreNames.contains("calendarMonths")) db.createObjectStore("calendarMonths", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbRequest(store, mode, callback) {
  const tx = state.db.transaction(store, mode);
  const request = callback(tx.objectStore(store));
  return new Promise((resolve, reject) => {
    let result;
    if (request) {
      request.onsuccess = () => { result = request.result; };
      request.onerror = () => reject(request.error);
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存が中断されました"));
  });
}

function replaceAllData(records, candidates, calendarMonths, settings) {
  const tx = state.db.transaction(["months", "candidates", "calendarMonths", "settings"], "readwrite");
  const monthStore = tx.objectStore("months");
  const candidateStore = tx.objectStore("candidates");
  const calendarStore = tx.objectStore("calendarMonths");
  const settingsStore = tx.objectStore("settings");
  monthStore.clear();
  candidateStore.clear();
  calendarStore.clear();
  for (const record of records) monthStore.put(record);
  for (const candidate of candidates) candidateStore.put(candidate);
  for (const value of calendarMonths) calendarStore.put(value);
  settingsStore.put(settings);
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("復元が中断されました"));
  });
}

const getAllMonths = () => dbRequest("months", "readonly", store => store.getAll());
const putMonth = record => dbRequest("months", "readwrite", store => store.put(record));
const deleteMonth = key => dbRequest("months", "readwrite", store => store.delete(key));
const clearMonths = () => dbRequest("months", "readwrite", store => store.clear());
const getSettings = () => dbRequest("settings", "readonly", store => store.get("main"));
const putSettings = settings => dbRequest("settings", "readwrite", store => store.put(settings));
const getAllCandidates = () => dbRequest("candidates", "readonly", store => store.getAll());
const putCandidate = candidate => dbRequest("candidates", "readwrite", store => store.put(candidate));
const deleteCandidate = id => dbRequest("candidates", "readwrite", store => store.delete(id));
const clearCandidates = () => dbRequest("candidates", "readwrite", store => store.clear());
const getAllCalendarMonths = () => dbRequest("calendarMonths", "readonly", store => store.getAll());
const putCalendarMonth = value => dbRequest("calendarMonths", "readwrite", store => store.put(value));
const clearCalendarMonths = () => dbRequest("calendarMonths", "readwrite", store => store.clear());

function makeRecord(year, month) {
  return {
    key: monthKey(year, month),
    year,
    month,
    events: "",
    overlayDate: false,
    photos: [],
    status: "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function showToast(message, duration = 2400) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), duration);
}

function safeYear(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1900 && number <= 2200 ? number : fallback;
}

async function init() {
  for (let month = 1; month <= 12; month += 1) {
    const option = document.createElement("option");
    option.value = String(month);
    option.textContent = `${month}月`;
    els.monthInput.append(option);
  }
  els.candidateMonthInput.value = state.candidateMonthKey;
  bindEvents();
  initAndroidIntegration();
  try {
    state.db = await openDatabase();
    const savedSettings = await getSettings();
    state.settings = { ...DEFAULT_SETTINGS, ...(savedSettings || {}) };
    if ((savedSettings?.tepraModelRevision || 0) < DEFAULT_SETTINGS.tepraModelRevision) {
      state.settings.tepraModel = DEFAULT_SETTINGS.tepraModel;
      state.settings.tepraModelRevision = DEFAULT_SETTINGS.tepraModelRevision;
      await putSettings(state.settings);
    }
    state.settings.startYear = safeYear(state.settings.startYear, DEFAULT_SETTINGS.startYear);
    state.settings.endYear = safeYear(state.settings.endYear, currentDate.getFullYear());
    if (state.settings.endYear < state.settings.startYear) state.settings.endYear = state.settings.startYear;
    const records = await getAllMonths();
    state.records = new Map(records.map(record => [record.key, record]));
    const candidates = await getAllCandidates();
    state.candidates = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const calendarMonths = await getAllCalendarMonths();
    state.calendarMonths = new Map(calendarMonths.map(value => [value.key, value]));
    state.dbReady = true;
    const pendingImages = state.pendingNativeImages.splice(0);
    for (const payload of pendingImages) await ingestNativeImage(payload, false);
    renderTimeline();
    renderCandidateBadge();
    if (pendingImages.length) await openCandidateView(monthForTimestamp(pendingImages[pendingImages.length - 1].takenAt));
    registerWebMcp();
  } catch (error) {
    console.error(error);
    showToast("端末内保存を開始できませんでした。ブラウザ設定をご確認ください。", 5000);
    renderTimeline();
  }
  if (!isAndroidApp() && "serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

function bindEvents() {
  els.homeButton.addEventListener("click", goHome);
  els.backButton.addEventListener("click", closeEditor);
  els.candidateButton.addEventListener("click", () => openCandidateView(state.record?.key || state.candidateMonthKey));
  els.candidateBackButton.addEventListener("click", closeCandidateView);
  els.candidateMonthInput.addEventListener("change", changeCandidateMonth);
  els.calendarImportButton.addEventListener("click", importCalendarMonth);
  els.monthPhotoSearchButton.addEventListener("click", searchCandidateMonthPhotos);
  els.candidatePhotoInput.addEventListener("change", importCandidatePhotos);
  els.openMonthCandidatesButton.addEventListener("click", () => openCandidateView(state.record?.key));
  $$('[data-candidate-filter]').forEach(button => button.addEventListener("click", () => setCandidateFilter(button.dataset.candidateFilter)));
  els.selectKeptButton.addEventListener("click", selectKeptCandidates);
  els.clearCandidateSelectionButton.addEventListener("click", clearCandidateSelection);
  els.addCandidatesButton.addEventListener("click", addSelectedCandidatesToMonth);
  els.jumpTodayButton.addEventListener("click", jumpToToday);
  els.settingsButton.addEventListener("click", openSettings);
  els.settingsForm.addEventListener("submit", saveSettingsFromDialog);
  els.photoInput.addEventListener("change", importPhotos);
  els.photoModeButton.addEventListener("click", () => setEditMode("photo"));
  els.frameModeButton.addEventListener("click", () => setEditMode("frame"));
  els.zoomInput.addEventListener("input", updateSelectedZoom);
  els.resetPhotoButton.addEventListener("click", resetSelectedPhoto);
  els.deletePhotoButton.addEventListener("click", deleteSelectedPhoto);
  els.bringFrontButton.addEventListener("click", () => shiftSelectedLayer("front"));
  els.sendBackButton.addEventListener("click", () => shiftSelectedLayer("back"));
  $$("[data-layout]").forEach(button => button.addEventListener("click", () => applyLayout(button.dataset.layout)));
  els.yearInput.addEventListener("change", changeEditorDate);
  els.monthInput.addEventListener("change", changeEditorDate);
  els.eventsInput.addEventListener("input", () => {
    if (!state.record) return;
    state.record.events = els.eventsInput.value;
    updateLabelPreview();
    markDirty();
  });
  els.overlayDateInput.addEventListener("change", () => {
    if (!state.record) return;
    state.record.overlayDate = els.overlayDateInput.checked;
    renderCanvas();
    markDirty();
  });
  els.copyDateButton.addEventListener("click", () => copyText(currentDateLabel(), "年月をコピーしました"));
  els.copyEventsButton.addEventListener("click", () => copyText(state.record?.events?.trim() || "", "出来事をコピーしました"));
  els.exportLabelsButton.addEventListener("click", exportLabelsCsv);
  els.tepraSearchButton.addEventListener("click", () => window.AndroidBridge?.searchTepra());
  els.tepraPrintButton.addEventListener("click", printCurrentTepraLabel);
  els.downloadButton.addEventListener("click", downloadCurrentImage);
  els.shareButton.addEventListener("click", shareCurrentImage);
  els.printCurrentButton.addEventListener("click", () => openPrintDialog(state.record?.key));
  els.printSheetButton.addEventListener("click", () => openPrintDialog());
  els.markPrintedButton.addEventListener("click", togglePrinted);
  els.backupButton.addEventListener("click", exportBackup);
  els.restoreButton.addEventListener("click", () => isAndroidApp() ? window.AndroidBridge.chooseBackupFile() : els.restoreInput.click());
  els.settingsBackupButton.addEventListener("click", () => { els.settingsDialog.close(); exportBackup(); });
  els.settingsRestoreButton.addEventListener("click", () => {
    els.settingsDialog.close();
    if (isAndroidApp()) window.AndroidBridge.chooseBackupFile(); else els.restoreInput.click();
  });
  els.restoreInput.addEventListener("change", importBackup);
  els.selectUnprintedButton.addEventListener("click", () => setPrintChecks("unprinted"));
  els.selectAllButton.addEventListener("click", () => setPrintChecks("all"));
  els.clearSelectionButton.addEventListener("click", () => setPrintChecks("none"));
  els.printForm.addEventListener("submit", startSelectedPrint);
  els.canvas.addEventListener("pointerdown", canvasPointerDown);
  els.canvas.addEventListener("pointermove", canvasPointerMove);
  els.canvas.addEventListener("pointerup", canvasPointerUp);
  els.canvas.addEventListener("pointercancel", canvasPointerUp);
  els.canvas.addEventListener("keydown", canvasKeyDown);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    state.installPrompt = event;
    els.installButton.hidden = false;
  });
  els.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    els.installButton.hidden = true;
  });
}

function isAndroidApp() {
  return Boolean(window.AndroidBridge);
}

function initAndroidIntegration() {
  if (!isAndroidApp()) return;
  document.documentElement.classList.add("android-apk");
  els.installButton.hidden = true;
  try {
    window.onAndroidNativeReady(JSON.parse(window.AndroidBridge.getNativeInfo()));
  } catch (error) {
    console.warn("Native bridge initialization failed", error);
  }
}

window.onAndroidNativeReady = info => {
  if (typeof info === "string") {
    try { info = JSON.parse(info); } catch { info = {}; }
  }
  state.nativeInfo = info || {};
  els.nativeTepraActions.hidden = false;
  els.tepraPrinterStatus.hidden = false;
  els.tepraSdkAttribution.hidden = false;
  if (state.nativeInfo.printerSelected) {
    const host = state.nativeInfo.printerHost ? `（${state.nativeInfo.printerHost}）` : "";
    els.tepraPrinterStatus.textContent = `${state.nativeInfo.printerName || "SR5900P"}${host}を使用します`;
    els.tepraPrinterStatus.className = "tepra-printer-status connected";
  } else {
    els.tepraPrinterStatus.textContent = "SR5900Pは未登録です。最初に機器を探してください。";
    els.tepraPrinterStatus.className = "tepra-printer-status";
  }
};

window.onAndroidNativeMessage = (status, message) => {
  if (status === "error" && els.calendarStatus.textContent === "読込中…") {
    els.calendarStatus.textContent = state.calendarMonths.has(state.candidateMonthKey) ? `${state.calendarMonths.get(state.candidateMonthKey).events.length}件` : "未読込";
  }
  if (message) showToast(message, status === "error" ? 4800 : 3200);
};

window.onAndroidSharedImage = payload => {
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return; }
  }
  if (!state.dbReady) {
    state.pendingNativeImages.push(payload);
    return;
  }
  state.nativeIngestChain = state.nativeIngestChain.then(async () => {
    await ingestNativeImage(payload, false);
    state.lastIncomingMonth = monthForTimestamp(payload.takenAt);
  });
};

window.onAndroidSharedImagesFinished = async count => {
  if (!count) return;
  await state.nativeIngestChain;
  state.candidateFilter = "active";
  if (state.dbReady && state.lastIncomingMonth) await openCandidateView(state.lastIncomingMonth);
  renderCandidateBadge();
  showToast(`${count}枚を候補箱へ追加しました`);
};

window.onAndroidCalendarEvents = async result => {
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch { result = {}; }
  }
  const year = safeYear(result?.year, null);
  const month = Number(result?.month);
  if (!year || month < 1 || month > 12) {
    showToast("カレンダーを読み込めませんでした", 4200);
    return;
  }
  const key = monthKey(year, month);
  const value = { key, events: Array.isArray(result.events) ? result.events : [], syncedAt: new Date().toISOString() };
  state.calendarMonths.set(key, value);
  if (state.db) await putCalendarMonth(value);
  if (!els.candidateView.hidden && state.candidateMonthKey === key) renderCandidateView();
  showToast(result.error || `${value.events.length}件の予定を読み込みました`, result.error ? 4200 : 2400);
};

async function printCurrentTepraLabel() {
  if (!state.record) return;
  const events = state.record.events?.trim();
  if (!events && !currentDateLabel()) {
    showToast("ラベルに印刷する内容を入力してください");
    return;
  }
  els.tepraPrintButton.disabled = true;
  window.AndroidBridge.printTepraLabel(currentDateLabel(), events || "", Number(state.settings.tapeWidth) || 12, 46);
}

window.onTepraPrintStatus = (status, message, tapeWidth) => {
  const busy = ["checking", "sending", "printing"].includes(status);
  els.tepraPrintButton.disabled = busy;
  els.tepraSearchButton.disabled = busy;
  els.tepraPrinterStatus.hidden = false;
  els.tepraPrinterStatus.textContent = message || "SR5900P";
  els.tepraPrinterStatus.className = `tepra-printer-status${status === "error" ? " error" : status === "success" || status === "selected" ? " connected" : ""}`;
  if (message) showToast(message, status === "error" ? 4800 : 2800);
  if (status === "success" && state.record) {
    state.record.status = "printed";
    saveRecordNow().then(updateEditorUi).catch(console.error);
  }
};

window.androidHandleBack = () => {
  if (els.settingsDialog.open) { els.settingsDialog.close(); return true; }
  if (els.printDialog.open) { els.printDialog.close(); return true; }
  if (!els.editorView.hidden) { closeEditor(); return true; }
  if (!els.candidateView.hidden) { closeCandidateView(); return true; }
  return false;
};

function renderTimeline() {
  state.gridUrls.forEach(URL.revokeObjectURL);
  state.gridUrls = [];
  els.timelineGrid.replaceChildren();
  const corner = document.createElement("div");
  corner.className = "corner-cell";
  els.timelineGrid.append(corner);
  for (let month = 1; month <= 12; month += 1) {
    const header = document.createElement("div");
    header.className = `month-header${month === currentDate.getMonth() + 1 ? " current" : ""}`;
    header.textContent = `${month}月`;
    els.timelineGrid.append(header);
  }
  for (let year = state.settings.startYear; year <= state.settings.endYear; year += 1) {
    const yearCell = document.createElement("div");
    yearCell.className = `year-header${year === currentDate.getFullYear() ? " current" : ""}`;
    const y = document.createElement("span");
    y.textContent = year;
    const suffix = document.createElement("small");
    suffix.textContent = "YEAR";
    yearCell.append(y, suffix);
    els.timelineGrid.append(yearCell);
    for (let month = 1; month <= 12; month += 1) {
      els.timelineGrid.append(makeTimelineCell(year, month));
    }
  }
  els.rangeLabel.textContent = `${state.settings.startYear}–${state.settings.endYear}年`;
}

function makeTimelineCell(year, month) {
  const key = monthKey(year, month);
  const record = state.records.get(key);
  const candidateCount = [...state.candidates.values()].filter(candidate => candidate.monthKey === key && candidate.status !== "excluded").length;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `month-cell${record?.photos?.length ? "" : " empty"}${year === currentDate.getFullYear() && month === currentDate.getMonth() + 1 ? " current" : ""}`;
  button.dataset.key = key;
  button.style.setProperty("--tile", TILE_COLORS[(year + month) % TILE_COLORS.length]);
  button.setAttribute("aria-label", `${year}年${month}月を編集`);
  if (record?.photos?.length) {
    const first = [...record.photos].sort((a, b) => a.z - b.z)[0];
    const image = document.createElement("img");
    const url = URL.createObjectURL(first.blob);
    state.gridUrls.push(url);
    image.src = url;
    image.alt = "";
    button.append(image);
  } else {
    const empty = document.createElement("span");
    empty.className = "empty-month";
    empty.textContent = "+";
    button.append(empty);
  }
  const footer = document.createElement("span");
  footer.className = "cell-footer";
  const title = document.createElement("strong");
  title.textContent = record?.events?.trim().replace(/\n/g, "／") || (candidateCount ? `候補 ${candidateCount}枚` : `${month}月`);
  const status = document.createElement("i");
  status.className = `cell-status ${record?.status || ""}`;
  footer.append(title, status);
  button.append(footer);
  button.addEventListener("click", () => openEditor(year, month));
  return button;
}

function jumpToToday() {
  const year = currentDate.getFullYear();
  if (year < state.settings.startYear || year > state.settings.endYear) {
    showToast("現在の年が表示範囲にありません。設定から終了年を変更してください。");
    return;
  }
  const cell = els.timelineGrid.querySelector(`[data-key="${monthKey(year, currentDate.getMonth() + 1)}"]`);
  cell?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  cell?.focus({ preventScroll: true });
}

async function openEditor(year, month) {
  await saveRecordNow();
  clearEditorImages();
  clearCandidateUrls();
  const key = monthKey(year, month);
  state.record = state.records.get(key) || makeRecord(year, month);
  state.selectedId = state.record.photos[0]?.id || null;
  state.editMode = "photo";
  els.timelineView.hidden = true;
  els.candidateView.hidden = true;
  els.editorView.hidden = false;
  window.scrollTo({ top: 0, behavior: "instant" });
  els.yearInput.value = String(year);
  els.monthInput.value = String(month);
  els.eventsInput.value = state.record.events || "";
  els.overlayDateInput.checked = Boolean(state.record.overlayDate);
  els.editorTitle.textContent = `${year}年${month}月`;
  await loadEditorImages();
  updateEditorUi();
  renderCanvas();
}

async function closeEditor() {
  if (els.editorView.hidden) return;
  await saveRecordNow();
  clearEditorImages();
  state.record = null;
  state.selectedId = null;
  els.editorView.hidden = true;
  els.timelineView.hidden = false;
  renderTimeline();
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function goHome() {
  if (!els.editorView.hidden) return closeEditor();
  if (!els.candidateView.hidden) return closeCandidateView();
}

function monthForTimestamp(value) {
  const date = new Date(Number(value) || Date.now());
  return monthKey(date.getFullYear(), date.getMonth() + 1);
}

function parseMonthValue(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(value || "");
  if (!match) return null;
  const year = safeYear(match[1], null);
  const month = Number(match[2]);
  return year && month >= 1 && month <= 12 ? { year, month, key: monthKey(year, month) } : null;
}

function monthRange(key) {
  const parsed = parseMonthValue(key);
  if (!parsed) return null;
  return {
    ...parsed,
    start: new Date(parsed.year, parsed.month - 1, 1).getTime(),
    end: new Date(parsed.year, parsed.month, 1).getTime()
  };
}

async function openCandidateView(key = monthKey(currentDate.getFullYear(), currentDate.getMonth() + 1)) {
  const parsed = parseMonthValue(key) || parseMonthValue(monthKey(currentDate.getFullYear(), currentDate.getMonth() + 1));
  if (!els.editorView.hidden) {
    await saveRecordNow();
    clearEditorImages();
    state.record = null;
    state.selectedId = null;
  }
  state.candidateMonthKey = parsed.key;
  state.selectedCandidates.clear();
  els.candidateMonthInput.value = parsed.key;
  els.timelineView.hidden = true;
  els.editorView.hidden = true;
  els.candidateView.hidden = false;
  renderCandidateView();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function closeCandidateView() {
  if (els.candidateView.hidden) return;
  clearCandidateUrls();
  state.selectedCandidates.clear();
  els.candidateView.hidden = true;
  els.timelineView.hidden = false;
  renderTimeline();
  renderCandidateBadge();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function changeCandidateMonth() {
  const parsed = parseMonthValue(els.candidateMonthInput.value);
  if (!parsed) return;
  state.candidateMonthKey = parsed.key;
  state.selectedCandidates.clear();
  renderCandidateView();
}

function clearCandidateUrls() {
  state.candidateUrls.forEach(URL.revokeObjectURL);
  state.candidateUrls = [];
}

function renderCandidateBadge() {
  const count = [...state.candidates.values()].filter(item => item.status !== "excluded").length;
  els.candidateBadge.textContent = count > 99 ? "99+" : String(count);
}

function candidatesForCurrentMonth() {
  return [...state.candidates.values()]
    .filter(candidate => candidate.monthKey === state.candidateMonthKey)
    .sort((a, b) => Number(a.takenAt || 0) - Number(b.takenAt || 0));
}

function filteredCandidates(candidates) {
  if (state.candidateFilter === "all") return candidates;
  if (state.candidateFilter === "active") return candidates.filter(candidate => candidate.status !== "excluded");
  return candidates.filter(candidate => candidate.status === state.candidateFilter);
}

function renderCandidateView() {
  clearCandidateUrls();
  const parsed = parseMonthValue(state.candidateMonthKey);
  if (!parsed) return;
  els.candidateMonthInput.value = parsed.key;
  const all = candidatesForCurrentMonth();
  const visible = filteredCandidates(all);
  els.candidateMonthCount.textContent = `${all.length}枚`;
  els.candidateGrid.replaceChildren();
  for (const candidate of visible) els.candidateGrid.append(makeCandidateCard(candidate));
  els.candidateEmpty.hidden = visible.length > 0;
  $$('[data-candidate-filter]').forEach(button => button.classList.toggle("active", button.dataset.candidateFilter === state.candidateFilter));
  renderCalendarEvents();
  updateCandidateSelectionUi();
}

function makeCandidateCard(candidate) {
  const article = document.createElement("article");
  article.className = `candidate-card${state.selectedCandidates.has(candidate.id) ? " selected" : ""}`;
  const imageWrap = document.createElement("div");
  imageWrap.className = "candidate-image-wrap";
  const image = document.createElement("img");
  const url = URL.createObjectURL(candidate.blob);
  state.candidateUrls.push(url);
  image.src = url;
  image.alt = candidate.name || "写真候補";
  const check = document.createElement("button");
  check.type = "button";
  check.className = "candidate-check";
  check.textContent = state.selectedCandidates.has(candidate.id) ? "✓" : "";
  check.setAttribute("aria-label", "月カードへ追加する写真として選択");
  const toggle = () => toggleCandidateSelection(candidate.id);
  check.addEventListener("click", toggle);
  image.addEventListener("click", toggle);
  imageWrap.append(image, check);

  const info = document.createElement("div");
  info.className = "candidate-info";
  const date = new Date(Number(candidate.takenAt) || Date.now());
  const dateLine = document.createElement("div");
  dateLine.className = "candidate-date";
  const dateLabel = document.createElement("b");
  dateLabel.textContent = `${date.getMonth() + 1}/${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const status = document.createElement("span");
  status.textContent = candidateStatusLabel(candidate.status);
  dateLine.append(dateLabel, status);

  const eventSelect = document.createElement("select");
  eventSelect.setAttribute("aria-label", "関連する出来事");
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "出来事を選択（任意）";
  eventSelect.append(none);
  const events = state.calendarMonths.get(candidate.monthKey)?.events || [];
  if (candidate.eventKey && !events.some(event => event.key === candidate.eventKey)) {
    const option = document.createElement("option");
    option.value = candidate.eventKey;
    option.textContent = candidate.eventTitle || "関連する出来事";
    eventSelect.append(option);
  }
  for (const event of events) {
    const option = document.createElement("option");
    option.value = event.key;
    option.textContent = `${shortDay(event.day)} ${event.title}`;
    eventSelect.append(option);
  }
  eventSelect.value = candidate.eventKey || "";
  eventSelect.addEventListener("change", async () => {
    const event = events.find(item => item.key === eventSelect.value);
    candidate.eventKey = event?.key || "";
    candidate.eventTitle = event?.title || "";
    candidate.eventStart = event?.start || 0;
    await putCandidate(candidate);
  });

  const actions = document.createElement("div");
  actions.className = "candidate-status-actions";
  for (const [value, label] of [["keep", "残す"], ["hold", "保留"], ["excluded", "外す"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.status = value;
    button.textContent = label;
    button.classList.toggle("active", candidate.status === value);
    button.addEventListener("click", () => updateCandidateStatus(candidate.id, value));
    actions.append(button);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "candidate-delete";
  remove.textContent = "候補から削除";
  remove.addEventListener("click", () => removeCandidate(candidate.id));
  info.append(dateLine, eventSelect, actions, remove);
  article.append(imageWrap, info);
  return article;
}

function candidateStatusLabel(status) {
  return status === "keep" ? "残す" : status === "excluded" ? "外す" : "保留";
}

function shortDay(day) {
  const parts = String(day || "").split("-");
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : "";
}

function toggleCandidateSelection(id) {
  if (state.selectedCandidates.has(id)) state.selectedCandidates.delete(id);
  else state.selectedCandidates.add(id);
  renderCandidateView();
}

function updateCandidateSelectionUi() {
  for (const id of [...state.selectedCandidates]) {
    const candidate = state.candidates.get(id);
    if (!candidate || candidate.monthKey !== state.candidateMonthKey) state.selectedCandidates.delete(id);
  }
  const count = state.selectedCandidates.size;
  els.candidateSelectionCount.textContent = `${count}枚選択`;
  els.addCandidatesButton.disabled = count === 0;
}

async function updateCandidateStatus(id, status) {
  const candidate = state.candidates.get(id);
  if (!candidate) return;
  candidate.status = status;
  candidate.updatedAt = new Date().toISOString();
  await putCandidate(candidate);
  renderCandidateView();
  renderCandidateBadge();
}

async function removeCandidate(id) {
  const candidate = state.candidates.get(id);
  if (!candidate || !confirm("この写真を候補箱から削除しますか？")) return;
  await deleteCandidate(id);
  state.candidates.delete(id);
  state.selectedCandidates.delete(id);
  renderCandidateView();
  renderCandidateBadge();
}

function setCandidateFilter(filter) {
  state.candidateFilter = filter;
  renderCandidateView();
}

function selectKeptCandidates() {
  for (const candidate of candidatesForCurrentMonth()) {
    if (candidate.status === "keep") state.selectedCandidates.add(candidate.id);
  }
  renderCandidateView();
}

function clearCandidateSelection() {
  state.selectedCandidates.clear();
  renderCandidateView();
}

function renderCalendarEvents() {
  const monthData = state.calendarMonths.get(state.candidateMonthKey);
  const events = monthData?.events || [];
  els.calendarStatus.textContent = monthData ? `${events.length}件` : "未読込";
  els.calendarEventList.replaceChildren();
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "calendar-empty";
    empty.textContent = monthData ? "この月の予定はありません" : "「カレンダーを読み込む」で、この月の予定を表示します";
    els.calendarEventList.append(empty);
    return;
  }
  for (const event of events) {
    const card = document.createElement("article");
    card.className = "calendar-event";
    const day = document.createElement("div");
    day.className = "event-day";
    const dayParts = String(event.day || "").split("-");
    day.innerHTML = `<span>${Number(dayParts[1]) || ""}月</span><b>${Number(dayParts[2]) || ""}</b>`;
    const copy = document.createElement("div");
    copy.className = "event-copy";
    const title = document.createElement("strong");
    title.textContent = event.title || "予定";
    const detail = document.createElement("small");
    detail.textContent = [event.location, event.calendar].filter(Boolean).join(" · ") || (event.allDay ? "終日" : formatTime(event.start));
    const search = document.createElement("button");
    search.type = "button";
    search.textContent = "前後1日の写真を探す";
    search.hidden = !isAndroidApp();
    search.addEventListener("click", () => searchPhotosForEvent(event));
    copy.append(title, detail, search);
    card.append(day, copy);
    els.calendarEventList.append(card);
  }
}

function formatTime(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function eventDayStart(event) {
  const [year, month, day] = String(event.day || "").split("-").map(Number);
  if (year && month && day) return new Date(year, month - 1, day).getTime();
  const date = new Date(Number(event.start) || Date.now());
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function importCalendarMonth() {
  const parsed = parseMonthValue(state.candidateMonthKey);
  if (!parsed || !isAndroidApp()) {
    showToast("カレンダー読込はAPK版で利用できます");
    return;
  }
  els.calendarStatus.textContent = "読込中…";
  window.AndroidBridge.requestCalendarEvents(parsed.year, parsed.month);
}

function searchCandidateMonthPhotos() {
  const range = monthRange(state.candidateMonthKey);
  if (!range || !isAndroidApp()) return;
  window.AndroidBridge.searchPhotos(range.start, range.end, "", "", 0);
}

function searchPhotosForEvent(event) {
  if (!isAndroidApp()) return;
  const day = eventDayStart(event);
  const oneDay = 24 * 60 * 60 * 1000;
  window.AndroidBridge.searchPhotos(day - oneDay, day + oneDay * 2,
    event.title || "", event.key || "", Number(event.start) || day);
}

async function importCandidatePhotos(event) {
  const files = [...event.target.files].filter(file => file.type.startsWith("image/"));
  event.target.value = "";
  if (!files.length) return;
  showToast(`${files.length}枚を候補箱へ追加しています…`, 5000);
  let added = 0;
  let lastMonth = state.candidateMonthKey;
  for (const file of files.slice(0, 60)) {
    try {
      const blob = await compressImage(file);
      const takenAt = Number(file.lastModified) || (monthRange(state.candidateMonthKey)?.start + 12 * 60 * 60 * 1000) || Date.now();
      const candidate = makeCandidate({ name: file.name, blob, takenAt });
      await putCandidate(candidate);
      state.candidates.set(candidate.id, candidate);
      lastMonth = candidate.monthKey;
      added += 1;
    } catch (error) {
      console.warn(error);
    }
  }
  state.candidateMonthKey = lastMonth;
  els.candidateMonthInput.value = lastMonth;
  renderCandidateView();
  renderCandidateBadge();
  showToast(`${added}枚を候補箱へ追加しました`);
}

function makeCandidate({ id, name, blob, takenAt, eventKey = "", eventTitle = "", eventStart = 0, status = "hold", createdAt }) {
  const timestamp = Number(takenAt) || Date.now();
  const key = monthForTimestamp(timestamp);
  if (!eventKey) {
    const taken = new Date(timestamp);
    const day = `${taken.getFullYear()}-${pad2(taken.getMonth() + 1)}-${pad2(taken.getDate())}`;
    const matching = (state.calendarMonths.get(key)?.events || []).filter(event => event.day === day);
    if (matching.length === 1) {
      eventKey = matching[0].key;
      eventTitle = matching[0].title;
      eventStart = matching[0].start;
    }
  }
  return {
    id: id || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
    monthKey: key,
    takenAt: timestamp,
    name: name || "photo.jpg",
    blob,
    eventKey,
    eventTitle,
    eventStart: Number(eventStart) || 0,
    status,
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

async function ingestNativeImage(payload, openView = true) {
  if (!payload?.dataUrl || !String(payload.dataUrl).startsWith("data:image/")) return;
  const candidate = makeCandidate({
    id: payload.id,
    name: payload.name,
    blob: dataUrlToBlob(payload.dataUrl),
    takenAt: payload.takenAt,
    eventKey: payload.eventKey,
    eventTitle: payload.eventTitle,
    eventStart: payload.eventStart
  });
  await putCandidate(candidate);
  state.candidates.set(candidate.id, candidate);
  renderCandidateBadge();
  if (openView) await openCandidateView(candidate.monthKey);
}

async function addSelectedCandidatesToMonth() {
  const parsed = parseMonthValue(state.candidateMonthKey);
  if (!parsed) return;
  const selected = [...state.selectedCandidates]
    .map(id => state.candidates.get(id))
    .filter(candidate => candidate?.monthKey === parsed.key);
  if (!selected.length) return;
  const record = state.records.get(parsed.key) || makeRecord(parsed.year, parsed.month);
  const available = Math.max(0, 24 - (record.photos?.length || 0));
  if (!available) {
    showToast("この月のカードにはすでに24枚あります");
    return;
  }
  const chosen = selected.slice(0, available);
  const startZ = record.photos.length;
  chosen.forEach((candidate, index) => record.photos.push({
    id: `candidate-${candidate.id}`,
    name: candidate.name,
    blob: candidate.blob,
    x: 6, y: 6, w: 588, h: 788,
    zoom: 1, offsetX: 0, offsetY: 0,
    z: startZ + index
  }));
  const eventNames = new Set((record.events || "").split(/[\n／]/).map(value => value.trim()).filter(Boolean));
  chosen.forEach(candidate => { if (candidate.eventTitle) eventNames.add(candidate.eventTitle.trim()); });
  record.events = [...eventNames].join("／");
  record.status = "draft";
  record.updatedAt = new Date().toISOString();
  await putMonth(record);
  state.records.set(record.key, record);
  for (const candidate of chosen) {
    await deleteCandidate(candidate.id);
    state.candidates.delete(candidate.id);
  }
  state.selectedCandidates.clear();
  renderCandidateBadge();
  await openEditor(parsed.year, parsed.month);
  applyLayout("auto", false);
  await saveRecordNow();
  showToast(`${chosen.length}枚を${parsed.year}年${parsed.month}月へ追加しました`);
  if (chosen.length < selected.length) showToast(`上限24枚のため${chosen.length}枚だけ追加しました`, 4200);
}

function clearEditorImages() {
  for (const entry of state.images.values()) URL.revokeObjectURL(entry.url);
  state.images.clear();
}

function loadImageBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
    image.src = url;
  });
}

async function loadEditorImages() {
  if (!state.record) return;
  for (const photo of state.record.photos) {
    try {
      state.images.set(photo.id, await loadImageBlob(photo.blob));
    } catch (error) {
      console.warn(error);
    }
  }
}

function currentDateLabel() {
  return state.record ? `${state.record.year}.${pad2(state.record.month)}` : "";
}

function updateEditorUi() {
  if (!state.record) return;
  els.editorTitle.textContent = `${state.record.year}年${state.record.month}月`;
  els.yearInput.value = String(state.record.year);
  els.monthInput.value = String(state.record.month);
  els.photoCount.textContent = `${state.record.photos.length}枚`;
  els.canvasEmpty.hidden = state.record.photos.length > 0;
  els.photoControls.hidden = !state.selectedId;
  els.photoModeButton.classList.toggle("active", state.editMode === "photo");
  els.frameModeButton.classList.toggle("active", state.editMode === "frame");
  const selected = selectedPhoto();
  if (selected) {
    els.zoomInput.value = String(selected.zoom);
    els.zoomOutput.textContent = `${Math.round(selected.zoom * 100)}%`;
  }
  els.monthStatusPill.textContent = statusText(state.record.status);
  els.monthStatusPill.className = `status-pill ${state.record.status}`;
  els.markPrintedButton.textContent = state.record.status === "printed" ? "印刷済みを解除" : "印刷済みにする";
  els.tepraModelLabel.textContent = state.settings.tepraModel;
  updateLabelPreview();
  renderPhotoStrip();
}

function statusText(status) {
  return status === "printed" ? "印刷済み" : status === "exported" ? "書き出し済み" : "編集中";
}

function updateLabelPreview() {
  const date = els.labelPreview.querySelector("b");
  const events = els.labelPreview.querySelector("span");
  date.textContent = currentDateLabel() || "年月";
  events.textContent = state.record?.events?.trim().replace(/\n/g, "／") || "出来事";
}

function renderPhotoStrip() {
  els.photoStrip.replaceChildren();
  if (!state.record) return;
  [...state.record.photos].sort((a, b) => a.z - b.z).forEach((photo, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `photo-thumb${photo.id === state.selectedId ? " active" : ""}`;
    button.setAttribute("aria-label", `写真${index + 1}を選択`);
    const image = document.createElement("img");
    image.src = state.images.get(photo.id)?.url || "";
    image.alt = "";
    const number = document.createElement("span");
    number.textContent = String(index + 1);
    button.append(image, number);
    button.addEventListener("click", () => {
      state.selectedId = photo.id;
      updateEditorUi();
      renderCanvas();
    });
    els.photoStrip.append(button);
  });
}

function selectedPhoto() {
  return state.record?.photos.find(photo => photo.id === state.selectedId) || null;
}

function setEditMode(mode) {
  state.editMode = mode;
  updateEditorUi();
  renderCanvas();
}

function markDirty(resetStatus = true) {
  if (!state.record) return;
  if (resetStatus) state.record.status = "draft";
  state.record.updatedAt = new Date().toISOString();
  els.saveState.textContent = "保存中…";
  els.saveState.classList.add("saving");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveRecordNow, 650);
  updateStatusOnly();
}

function updateStatusOnly() {
  if (!state.record) return;
  els.monthStatusPill.textContent = statusText(state.record.status);
  els.monthStatusPill.className = `status-pill ${state.record.status}`;
  els.markPrintedButton.textContent = state.record.status === "printed" ? "印刷済みを解除" : "印刷済みにする";
}

async function saveRecordNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (!state.record || !state.db) return;
  try {
    state.record.updatedAt = new Date().toISOString();
    await putMonth(state.record);
    state.records.set(state.record.key, state.record);
    els.saveState.textContent = "保存済み";
    els.saveState.classList.remove("saving");
  } catch (error) {
    console.error(error);
    els.saveState.textContent = "保存できません";
    els.saveState.classList.remove("saving");
    showToast("保存容量が不足している可能性があります。バックアップ後、不要な写真を整理してください。", 5000);
  }
}

async function changeEditorDate() {
  if (!state.record) return;
  const year = safeYear(els.yearInput.value, state.record.year);
  const month = Math.max(1, Math.min(12, Number(els.monthInput.value) || state.record.month));
  const nextKey = monthKey(year, month);
  const oldKey = state.record.key;
  if (nextKey === oldKey) return;
  if (state.records.has(nextKey)) {
    showToast(`${year}年${month}月には、すでにデータがあります。`);
    els.yearInput.value = String(state.record.year);
    els.monthInput.value = String(state.record.month);
    return;
  }
  if (state.db && state.records.has(oldKey)) await deleteMonth(oldKey);
  state.records.delete(oldKey);
  state.record.year = year;
  state.record.month = month;
  state.record.key = nextKey;
  updateEditorUi();
  renderCanvas();
  markDirty();
}

async function compressImage(file) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("対応していない画像です")); };
      image.src = url;
    });
  }
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d", { alpha: false }).drawImage(source, 0, 0, width, height);
  if (typeof source.close === "function") source.close();
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("画像を圧縮できませんでした")), "image/jpeg", .88));
}

async function importPhotos(event) {
  if (!state.record) return;
  const files = [...event.target.files].filter(file => file.type.startsWith("image/"));
  event.target.value = "";
  if (!files.length) return;
  const available = Math.max(0, 24 - state.record.photos.length);
  const selectedFiles = files.slice(0, available);
  if (!selectedFiles.length) {
    showToast("1か月につき24枚まで追加できます。");
    return;
  }
  showToast(`${selectedFiles.length}枚の写真を準備しています…`, 5000);
  const added = [];
  for (const file of selectedFiles) {
    try {
      const blob = await compressImage(file);
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const photo = {
        id, name: file.name, blob,
        x: 6, y: 6, w: 588, h: 788,
        zoom: 1, offsetX: 0, offsetY: 0,
        z: state.record.photos.length + added.length
      };
      added.push(photo);
      state.images.set(id, await loadImageBlob(blob));
    } catch (error) {
      console.warn(error);
      showToast(`${file.name}を読み込めませんでした。`);
    }
  }
  state.record.photos.push(...added);
  if (added.length) {
    state.selectedId = added[0].id;
    applyLayout("auto", false);
    updateEditorUi();
    renderCanvas();
    markDirty();
    showToast(`${added.length}枚を追加しました`);
  }
}

function applyLayout(type, announce = true) {
  if (!state.record?.photos.length) {
    if (announce) showToast("先に写真を追加してください");
    return;
  }
  const photos = [...state.record.photos].sort((a, b) => a.z - b.z);
  const margin = 8;
  const gap = 7;
  if (type === "focus" && photos.length > 1) {
    const topHeight = 488;
    Object.assign(photos[0], { x: margin, y: margin, w: 600 - margin * 2, h: topHeight - gap, zoom: 1, offsetX: 0, offsetY: 0, z: 0 });
    const rest = photos.slice(1);
    const cols = Math.min(3, rest.length);
    const rows = Math.ceil(rest.length / cols);
    const cellW = (600 - margin * 2 - gap * (cols - 1)) / cols;
    const cellH = (800 - topHeight - margin - gap * (rows - 1)) / rows;
    rest.forEach((photo, index) => Object.assign(photo, {
      x: margin + (index % cols) * (cellW + gap),
      y: topHeight + Math.floor(index / cols) * (cellH + gap),
      w: cellW, h: cellH, zoom: 1, offsetX: 0, offsetY: 0, z: index + 1
    }));
  } else {
    let cols;
    if (type === "grid2") cols = 2;
    else if (type === "grid3") cols = 3;
    else if (photos.length === 1 || photos.length === 2) cols = 1;
    else if (photos.length <= 4) cols = 2;
    else if (photos.length <= 9) cols = 3;
    else cols = 4;
    const rows = Math.ceil(photos.length / cols);
    const cellW = (600 - margin * 2 - gap * (cols - 1)) / cols;
    const cellH = (800 - margin * 2 - gap * (rows - 1)) / rows;
    photos.forEach((photo, index) => Object.assign(photo, {
      x: margin + (index % cols) * (cellW + gap),
      y: margin + Math.floor(index / cols) * (cellH + gap),
      w: cellW, h: cellH, zoom: 1, offsetX: 0, offsetY: 0, z: index
    }));
  }
  updateEditorUi();
  renderCanvas();
  markDirty();
  if (announce) showToast("並べ直しました。写真ごとに調整できます。");
}

function drawRecord(canvas, record, imageMap, showSelection = false) {
  const context = canvas.getContext("2d", { alpha: false });
  context.save();
  context.setTransform(canvas.width / 600, 0, 0, canvas.height / 800, 0, 0);
  context.clearRect(0, 0, 600, 800);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 600, 800);
  const photos = [...(record?.photos || [])].sort((a, b) => a.z - b.z);
  photos.forEach(photo => drawPhoto(context, photo, imageMap.get(photo.id)?.image, showSelection && photo.id === state.selectedId));
  if (record?.overlayDate && photos.length) drawDateOverlay(context, record);
  context.restore();
}

function drawPhoto(context, photo, image, selected) {
  context.save();
  context.beginPath();
  context.rect(photo.x, photo.y, photo.w, photo.h);
  context.clip();
  context.fillStyle = "#e9eef3";
  context.fillRect(photo.x, photo.y, photo.w, photo.h);
  if (image) {
    clampOffsets(photo, image);
    const baseScale = Math.max(photo.w / image.naturalWidth, photo.h / image.naturalHeight);
    const scale = baseScale * photo.zoom;
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const x = photo.x + (photo.w - width) / 2 + photo.offsetX;
    const y = photo.y + (photo.h - height) / 2 + photo.offsetY;
    context.drawImage(image, x, y, width, height);
  }
  context.restore();
  if (selected) {
    context.save();
    context.strokeStyle = "#14a59b";
    context.lineWidth = 5;
    context.strokeRect(photo.x + 2.5, photo.y + 2.5, Math.max(0, photo.w - 5), Math.max(0, photo.h - 5));
    if (state.editMode === "frame") {
      context.fillStyle = "#ffffff";
      context.strokeStyle = "#10233f";
      context.lineWidth = 3;
      context.fillRect(photo.x + photo.w - 22, photo.y + photo.h - 22, 20, 20);
      context.strokeRect(photo.x + photo.w - 22, photo.y + photo.h - 22, 20, 20);
    }
    context.restore();
  }
}

function drawDateOverlay(context, record) {
  const text = `${record.year}.${pad2(record.month)}`;
  context.save();
  context.font = "700 24px sans-serif";
  const width = context.measureText(text).width + 28;
  context.fillStyle = "rgba(12, 29, 51, .78)";
  roundRect(context, 600 - width - 14, 800 - 50, width, 36, 9);
  context.fill();
  context.fillStyle = "#fff";
  context.textBaseline = "middle";
  context.fillText(text, 600 - width, 768);
  context.restore();
}

function roundRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function clampOffsets(photo, image) {
  if (!image) return;
  const baseScale = Math.max(photo.w / image.naturalWidth, photo.h / image.naturalHeight);
  const scale = baseScale * photo.zoom;
  const overflowX = Math.max(0, (image.naturalWidth * scale - photo.w) / 2);
  const overflowY = Math.max(0, (image.naturalHeight * scale - photo.h) / 2);
  photo.offsetX = Math.max(-overflowX, Math.min(overflowX, photo.offsetX));
  photo.offsetY = Math.max(-overflowY, Math.min(overflowY, photo.offsetY));
}

function renderCanvas() {
  if (!state.record) return;
  drawRecord(els.canvas, state.record, state.images, true);
}

function pointOnCanvas(event) {
  const rect = els.canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * 600 / rect.width, y: (event.clientY - rect.top) * 800 / rect.height };
}

function photoAtPoint(point) {
  if (!state.record) return null;
  return [...state.record.photos].sort((a, b) => b.z - a.z).find(photo => point.x >= photo.x && point.x <= photo.x + photo.w && point.y >= photo.y && point.y <= photo.y + photo.h) || null;
}

function canvasPointerDown(event) {
  if (!state.record?.photos.length) return;
  event.preventDefault();
  const point = pointOnCanvas(event);
  const hit = photoAtPoint(point);
  if (!hit) return;
  state.selectedId = hit.id;
  const nearHandle = state.editMode === "frame" && point.x >= hit.x + hit.w - 38 && point.y >= hit.y + hit.h - 38;
  state.pointer = { id: event.pointerId, action: nearHandle ? "resize" : state.editMode === "frame" ? "move" : "pan", last: point };
  els.canvas.setPointerCapture(event.pointerId);
  updateEditorUi();
  renderCanvas();
}

function canvasPointerMove(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  event.preventDefault();
  const photo = selectedPhoto();
  if (!photo) return;
  const point = pointOnCanvas(event);
  const dx = point.x - state.pointer.last.x;
  const dy = point.y - state.pointer.last.y;
  if (state.pointer.action === "pan") {
    photo.offsetX += dx;
    photo.offsetY += dy;
    clampOffsets(photo, state.images.get(photo.id)?.image);
  } else if (state.pointer.action === "move") {
    photo.x = Math.max(0, Math.min(600 - photo.w, photo.x + dx));
    photo.y = Math.max(0, Math.min(800 - photo.h, photo.y + dy));
  } else if (state.pointer.action === "resize") {
    photo.w = Math.max(70, Math.min(600 - photo.x, photo.w + dx));
    photo.h = Math.max(70, Math.min(800 - photo.y, photo.h + dy));
    clampOffsets(photo, state.images.get(photo.id)?.image);
  }
  state.pointer.last = point;
  renderCanvas();
  markDirty();
}

function canvasPointerUp(event) {
  if (!state.pointer || state.pointer.id !== event.pointerId) return;
  try { els.canvas.releasePointerCapture(event.pointerId); } catch {}
  state.pointer = null;
  saveRecordNow();
}

function canvasKeyDown(event) {
  const photo = selectedPhoto();
  if (!photo || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 3;
  const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
  const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
  if (state.editMode === "photo") {
    photo.offsetX += dx;
    photo.offsetY += dy;
    clampOffsets(photo, state.images.get(photo.id)?.image);
  } else {
    photo.x = Math.max(0, Math.min(600 - photo.w, photo.x + dx));
    photo.y = Math.max(0, Math.min(800 - photo.h, photo.y + dy));
  }
  renderCanvas();
  markDirty();
}

function updateSelectedZoom() {
  const photo = selectedPhoto();
  if (!photo) return;
  photo.zoom = Number(els.zoomInput.value);
  clampOffsets(photo, state.images.get(photo.id)?.image);
  els.zoomOutput.textContent = `${Math.round(photo.zoom * 100)}%`;
  renderCanvas();
  markDirty();
}

function resetSelectedPhoto() {
  const photo = selectedPhoto();
  if (!photo) return;
  photo.zoom = 1;
  photo.offsetX = 0;
  photo.offsetY = 0;
  updateEditorUi();
  renderCanvas();
  markDirty();
}

function deleteSelectedPhoto() {
  const photo = selectedPhoto();
  if (!photo || !state.record) return;
  const index = state.record.photos.indexOf(photo);
  state.record.photos.splice(index, 1);
  const entry = state.images.get(photo.id);
  if (entry) URL.revokeObjectURL(entry.url);
  state.images.delete(photo.id);
  state.selectedId = state.record.photos[0]?.id || null;
  state.record.photos.forEach((item, order) => { item.z = order; });
  updateEditorUi();
  renderCanvas();
  markDirty();
}

function shiftSelectedLayer(direction) {
  const photo = selectedPhoto();
  if (!photo || !state.record) return;
  const ordered = [...state.record.photos].sort((a, b) => a.z - b.z);
  const currentIndex = ordered.indexOf(photo);
  const targetIndex = direction === "front" ? ordered.length - 1 : 0;
  ordered.splice(currentIndex, 1);
  ordered.splice(targetIndex, 0, photo);
  ordered.forEach((item, index) => { item.z = index; });
  renderCanvas();
  renderPhotoStrip();
  markDirty();
}

function openSettings() {
  els.startYearInput.value = String(state.settings.startYear);
  els.endYearInput.value = String(state.settings.endYear);
  els.tepraModelInput.value = state.settings.tepraModel;
  els.tapeWidthInput.value = String(state.settings.tapeWidth);
  els.settingsDialog.showModal();
}

async function saveSettingsFromDialog(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    els.settingsDialog.close();
    return;
  }
  const startYear = safeYear(els.startYearInput.value, state.settings.startYear);
  const endYear = safeYear(els.endYearInput.value, state.settings.endYear);
  if (endYear < startYear) {
    showToast("終了年は開始年以降にしてください");
    return;
  }
  state.settings = {
    key: "main", startYear, endYear,
    tepraModel: els.tepraModelInput.value,
    tepraModelRevision: DEFAULT_SETTINGS.tepraModelRevision,
    tapeWidth: Number(els.tapeWidthInput.value)
  };
  if (state.db) await putSettings(state.settings);
  els.settingsDialog.close();
  renderTimeline();
  updateEditorUi();
  showToast("設定を保存しました");
}

async function copyText(text, successMessage) {
  if (!text) {
    showToast("コピーする内容がありません");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast(successMessage);
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function exportLabelsCsv() {
  const records = [...state.records.values()].filter(record => record.photos?.length || record.events?.trim()).sort((a, b) => a.key.localeCompare(b.key));
  if (!records.length) {
    showToast("ラベルにする月がありません");
    return;
  }
  const lines = ["年月,出来事,テープ幅(mm),機種", ...records.map(record => [
    `${record.year}.${pad2(record.month)}`,
    (record.events || "").replace(/\n/g, "／"),
    state.settings.tapeWidth,
    state.settings.tepraModel
  ].map(csvEscape).join(","))];
  downloadBlob(new Blob(["\ufeff" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), "omoide-tepra-labels.csv");
  showToast("テプラ用ラベル一覧を保存しました");
}

function canvasBlob(canvas, type = "image/jpeg", quality = .96) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("画像を作成できませんでした")), type, quality));
}

async function outputCurrentBlob() {
  if (!state.record?.photos.length) throw new Error("写真を追加してください");
  const canvas = document.createElement("canvas");
  canvas.width = 600;
  canvas.height = 800;
  drawRecord(canvas, state.record, state.images, false);
  return canvasBlob(canvas);
}

async function downloadCurrentImage() {
  try {
    const blob = await outputCurrentBlob();
    downloadBlob(blob, `${state.record.key}-omoide-instax.jpg`);
    state.record.status = "exported";
    await saveRecordNow();
    updateEditorUi();
    showToast("600×800pxの画像を保存しました");
  } catch (error) {
    showToast(error.message);
  }
}

async function shareCurrentImage() {
  try {
    const blob = await outputCurrentBlob();
    const file = new File([blob], `${state.record.key}-omoide-instax.jpg`, { type: "image/jpeg" });
    if (isAndroidApp()) {
      const dataUrl = await blobToDataUrl(blob);
      window.AndroidBridge.shareImage(dataUrl, file.name, `${state.record.year}年${state.record.month}月の思い出`);
      state.record.status = "exported";
      await saveRecordNow();
      updateEditorUi();
      showToast("instax mini Linkアプリへ共有します");
    } else if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: `${state.record.year}年${state.record.month}月の思い出` });
      state.record.status = "exported";
      await saveRecordNow();
      updateEditorUi();
    } else {
      downloadBlob(blob, file.name);
      state.record.status = "exported";
      await saveRecordNow();
      updateEditorUi();
      showToast("画像を保存しました。mini Linkアプリから選択してください。", 4200);
    }
  } catch (error) {
    if (error.name !== "AbortError") showToast(error.message || "共有できませんでした");
  }
}

async function downloadBlob(blob, filename) {
  if (isAndroidApp()) {
    const dataUrl = await blobToDataUrl(blob);
    window.AndroidBridge.saveFile(dataUrl, blob.type || "application/octet-stream", filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function togglePrinted() {
  if (!state.record) return;
  state.record.status = state.record.status === "printed" ? "draft" : "printed";
  await saveRecordNow();
  updateEditorUi();
  showToast(state.record.status === "printed" ? "印刷済みにしました" : "印刷済みを解除しました");
}

function openPrintDialog(preselectKey) {
  state.printUrls.forEach(URL.revokeObjectURL);
  state.printUrls = [];
  els.printMonthList.replaceChildren();
  const records = [...state.records.values()].filter(record => record.photos?.length).sort((a, b) => a.key.localeCompare(b.key));
  if (state.record?.photos?.length && !state.records.has(state.record.key)) records.push(state.record);
  if (!records.length) {
    showToast("印刷できる月がまだありません");
    return;
  }
  records.forEach(record => {
    const label = document.createElement("label");
    label.className = "print-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = record.key;
    checkbox.checked = preselectKey ? record.key === preselectKey : record.status !== "printed";
    const first = [...record.photos].sort((a, b) => a.z - b.z)[0];
    const image = document.createElement("img");
    const url = URL.createObjectURL(first.blob);
    state.printUrls.push(url);
    image.src = url;
    image.alt = "";
    const text = document.createElement("span");
    const strong = document.createElement("b");
    strong.textContent = `${record.year}年${record.month}月`;
    const small = document.createElement("small");
    small.textContent = record.events?.trim().replace(/\n/g, "／") || statusText(record.status);
    text.append(strong, small);
    label.append(checkbox, image, text);
    els.printMonthList.append(label);
  });
  els.printDialog.showModal();
}

function setPrintChecks(mode) {
  $$("#printMonthList input[type=checkbox]").forEach(checkbox => {
    const record = state.records.get(checkbox.value) || (state.record?.key === checkbox.value ? state.record : null);
    checkbox.checked = mode === "all" || (mode === "unprinted" && record?.status !== "printed");
  });
}

async function startSelectedPrint(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    els.printDialog.close();
    return;
  }
  const keys = $$("#printMonthList input[type=checkbox]:checked").map(input => input.value);
  if (!keys.length) {
    showToast("印刷する月を選んでください");
    return;
  }
  els.printDialog.close();
  await printRecords(keys);
}

async function imagesForRecord(record) {
  if (state.record?.key === record.key && state.images.size) return { map: state.images, cleanup: () => {} };
  const map = new Map();
  for (const photo of record.photos) {
    try { map.set(photo.id, await loadImageBlob(photo.blob)); } catch {}
  }
  return { map, cleanup: () => map.forEach(entry => URL.revokeObjectURL(entry.url)) };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

async function printRecords(keys) {
  const nativePrint = isAndroidApp();
  const printWindow = nativePrint ? null : window.open("", "_blank");
  if (!nativePrint && !printWindow) {
    showToast("ポップアップを許可して、もう一度お試しください", 4200);
    return;
  }
  if (printWindow) printWindow.document.write("<!doctype html><title>準備中</title><p style='font-family:sans-serif;padding:2rem'>印刷データを準備しています…</p>");
  const cards = [];
  for (const key of keys) {
    const record = state.records.get(key) || (state.record?.key === key ? state.record : null);
    if (!record) continue;
    const loaded = await imagesForRecord(record);
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 800;
    drawRecord(canvas, record, loaded.map, false);
    const dataUrl = canvas.toDataURL("image/jpeg", .96);
    loaded.cleanup();
    cards.push({ record, dataUrl });
  }
  const pages = [];
  for (let index = 0; index < cards.length; index += 9) pages.push(cards.slice(index, index + 9));
  const cardHtml = card => `<article class="card"><img src="${card.dataUrl}" alt=""><div class="caption"><b>${card.record.year}.${pad2(card.record.month)}</b><span>${escapeHtml((card.record.events || "").replace(/\n/g, "／"))}</span></div></article>`;
  const autoPrintScript = nativePrint ? "" : "<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350))<\\/script>";
  const printHtml = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>おもいで年表・原寸印刷</title><style>
    @page{size:A4 portrait;margin:11mm 20mm}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;font-family:"Yu Gothic",sans-serif}.page{width:170mm;min-height:275mm;display:grid;grid-template-columns:repeat(3,54mm);grid-auto-rows:86mm;gap:3mm;align-content:start;page-break-after:always}.page:last-child{page-break-after:auto}.card{width:54mm;height:86mm;margin:0;overflow:hidden;background:white;outline:.2mm dashed #aeb5bc;position:relative}.card>img{display:block;width:46mm;height:62mm;margin:4mm 4mm 0;object-fit:cover}.caption{height:20mm;padding:2.5mm 4mm 2mm;overflow:hidden;display:flex;flex-direction:column;gap:1mm;color:#111}.caption b{font-size:9pt;line-height:1}.caption span{font-size:6.7pt;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}@media screen{body{padding:10mm;background:#e9edf2}.page{margin:0 auto 10mm;padding:0;background:white;box-shadow:0 8px 30px #8b96a555}}@media print{.page{break-after:page}}
  </style></head><body>${pages.map(page => `<section class="page">${page.map(cardHtml).join("")}</section>`).join("")}${autoPrintScript}</body></html>`;
  if (nativePrint) {
    window.AndroidBridge.printHtml(printHtml, "おもいで年表・原寸印刷");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const type = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function exportBackup() {
  if (!state.db) return;
  let nativeToken = "";
  try {
    els.backupButton.disabled = true;
    showToast("写真を含むバックアップを作成しています…", 8000);
    await saveRecordNow();
    const records = await getAllMonths();
    const candidates = await getAllCandidates();
    const calendarMonths = await getAllCalendarMonths();
    const native = isAndroidApp() && state.nativeInfo?.zipBackup;
    const photoFiles = [];
    let photoIndex = 0;
    const serializedRecords = [];
    for (const record of records) {
      const photos = [];
      for (const photo of record.photos || []) {
        const { blob, ...metadata } = photo;
        if (native) {
          const blobPath = `photos/months/${String(++photoIndex).padStart(5, "0")}.jpg`;
          photos.push({ ...metadata, blobPath });
          photoFiles.push({ path: blobPath, blob });
        } else {
          photos.push({ ...metadata, blob: await blobToDataUrl(blob) });
        }
      }
      serializedRecords.push({ ...record, photos });
    }
    const serializedCandidates = [];
    for (const candidate of candidates) {
      const { blob, ...metadata } = candidate;
      if (native) {
        const blobPath = `photos/candidates/${String(++photoIndex).padStart(5, "0")}.jpg`;
        serializedCandidates.push({ ...metadata, blobPath });
        photoFiles.push({ path: blobPath, blob });
      } else {
        serializedCandidates.push({ ...metadata, blob: await blobToDataUrl(blob) });
      }
    }
    const payload = {
      app: "omoide-timeline",
      version: 2,
      appVersion: "1.1.0",
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      records: serializedRecords,
      candidates: serializedCandidates,
      calendarMonths
    };
    const date = new Date().toISOString().slice(0, 10);
    if (native) {
      nativeToken = window.AndroidBridge.beginBackup(JSON.stringify(payload), `omoide-backup-${date}.omoide.zip`);
      if (!nativeToken) throw new Error("ZIPバックアップを開始できませんでした");
      for (let index = 0; index < photoFiles.length; index += 1) {
        const item = photoFiles[index];
        const success = window.AndroidBridge.addBackupPhoto(nativeToken, item.path, await blobToDataUrl(item.blob));
        if (!success) throw new Error("写真をバックアップへ追加できませんでした");
        if (index > 0 && index % 10 === 0) showToast(`バックアップ中… ${index}/${photoFiles.length}枚`, 5000);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (!window.AndroidBridge.finishBackup(nativeToken)) throw new Error("ZIPバックアップを保存できませんでした");
      nativeToken = "";
    } else {
      downloadBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), `omoide-backup-${date}.omoide.json`);
      showToast("バックアップを保存しました");
    }
  } catch (error) {
    console.error(error);
    if (nativeToken) window.AndroidBridge.cancelBackup(nativeToken);
    showToast(error.message || "バックアップを作成できませんでした", 4800);
  } finally {
    els.backupButton.disabled = false;
  }
}

async function importBackup(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file || !state.db) return;
  try {
    if (file.name.toLowerCase().endsWith(".zip")) throw new Error("ZIP復元はAPK版の「復元」から利用できます");
    const payload = JSON.parse(await file.text());
    await restoreBackupPayload(payload);
  } catch (error) {
    console.error(error);
    showToast(error.message || "バックアップを復元できませんでした", 4500);
  }
}

async function restoreBackupPayload(payload, photoResolver = null) {
  if (payload?.app !== "omoide-timeline" || ![1, 2].includes(Number(payload.version)) || !Array.isArray(payload.records)) {
    throw new Error("このアプリのバックアップではありません");
  }
  if (!confirm("現在の年表・候補箱・カレンダー情報を、バックアップの内容で置き換えます。よろしいですか？")) return false;
  showToast("バックアップを復元しています…", 8000);
  await saveRecordNow();
  const restoredRecords = [];
  for (const raw of payload.records) {
    const year = safeYear(raw.year, null);
    const month = Number(raw.month);
    if (!year || month < 1 || month > 12 || !Array.isArray(raw.photos)) continue;
    const photos = [];
    for (const rawPhoto of raw.photos) {
      const dataUrl = typeof rawPhoto.blob === "string" ? rawPhoto.blob : photoResolver?.(rawPhoto.blobPath);
      if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) throw new Error("バックアップ内の写真が不足しています");
      const { blob, blobPath, ...metadata } = rawPhoto;
      photos.push({ ...metadata, blob: dataUrlToBlob(dataUrl) });
    }
    const record = { ...makeRecord(year, month), ...raw, key: monthKey(year, month), year, month, photos };
    restoredRecords.push(record);
  }
  const restoredCandidates = [];
  for (const raw of Array.isArray(payload.candidates) ? payload.candidates : []) {
    const dataUrl = typeof raw.blob === "string" ? raw.blob : photoResolver?.(raw.blobPath);
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) throw new Error("候補箱の写真が不足しています");
    const { blob, blobPath, ...metadata } = raw;
    const candidate = makeCandidate({ ...metadata, blob: dataUrlToBlob(dataUrl) });
    restoredCandidates.push(candidate);
  }
  const restoredCalendar = [];
  for (const value of Array.isArray(payload.calendarMonths) ? payload.calendarMonths : []) {
    if (!parseMonthValue(value?.key) || !Array.isArray(value.events)) continue;
    const monthData = { key: value.key, events: value.events, syncedAt: value.syncedAt || payload.exportedAt || new Date().toISOString() };
    restoredCalendar.push(monthData);
  }
  let restoredSettings = { ...state.settings };
  if (payload.settings) {
    restoredSettings = { ...DEFAULT_SETTINGS, ...payload.settings, key: "main" };
    if ((payload.settings.tepraModelRevision || 0) < DEFAULT_SETTINGS.tepraModelRevision) {
      restoredSettings.tepraModel = DEFAULT_SETTINGS.tepraModel;
      restoredSettings.tepraModelRevision = DEFAULT_SETTINGS.tepraModelRevision;
    }
  }
  state.settings = restoredSettings;
  await replaceAllData(restoredRecords, restoredCandidates, restoredCalendar, state.settings);
  clearEditorImages();
  clearCandidateUrls();
  state.record = null;
  state.records = new Map(restoredRecords.map(record => [record.key, record]));
  state.candidates = new Map(restoredCandidates.map(candidate => [candidate.id, candidate]));
  state.calendarMonths = new Map(restoredCalendar.map(value => [value.key, value]));
  state.selectedCandidates.clear();
  els.editorView.hidden = true;
  els.candidateView.hidden = true;
  els.timelineView.hidden = false;
  renderTimeline();
  renderCandidateBadge();
  showToast("バックアップを復元しました");
  return true;
}

window.onAndroidBackupReady = async manifestJson => {
  try {
    const payload = typeof manifestJson === "string" ? JSON.parse(manifestJson) : manifestJson;
    await restoreBackupPayload(payload, path => window.AndroidBridge.getBackupPhoto(path));
  } catch (error) {
    console.error(error);
    showToast(error.message || "ZIPバックアップを復元できませんでした", 4800);
  } finally {
    window.AndroidBridge.clearBackupRestore();
  }
};

window.onAndroidLegacyBackup = async json => {
  try {
    await restoreBackupPayload(typeof json === "string" ? JSON.parse(json) : json);
  } catch (error) {
    console.error(error);
    showToast(error.message || "バックアップを復元できませんでした", 4800);
  }
};

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  state.webMcpAbort?.abort();
  const lifecycle = new AbortController();
  state.webMcpAbort = lifecycle;
  const register = tool => {
    try { Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(console.warn); } catch (error) { console.warn(error); }
  };
  register({
    name: "read_memory_timeline_summary",
    title: "年表の概要を読む",
    description: "端末内の思い出年表について、登録済みの年月と状態を読み取ります。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      return { months: [...state.records.values()].filter(record => record.photos?.length || record.events?.trim()).map(record => ({ year: record.year, month: record.month, event: record.events, photoCount: record.photos?.length || 0, status: record.status })) };
    }
  });
  register({
    name: "start_month_card_editing",
    title: "月カードを開く",
    description: "指定した年月の写真カード編集画面を開きます。データの保存はまだ行いません。",
    inputSchema: { type: "object", properties: { year: { type: "integer", minimum: 1900, maximum: 2200 }, month: { type: "integer", minimum: 1, maximum: 12 } }, required: ["year", "month"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input) {
      if (!Number.isInteger(input?.year) || !Number.isInteger(input?.month) || input.month < 1 || input.month > 12) throw new Error("年月が正しくありません");
      await openEditor(input.year, input.month);
      return { opened: monthKey(input.year, input.month) };
    }
  });
  register({
    name: "set_month_event_label",
    title: "月の出来事を設定",
    description: "指定した年月の出来事ラベルを設定し、端末内に保存します。",
    inputSchema: { type: "object", properties: { year: { type: "integer", minimum: 1900, maximum: 2200 }, month: { type: "integer", minimum: 1, maximum: 12 }, event: { type: "string", maxLength: 200 } }, required: ["year", "month", "event"], additionalProperties: false },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input) {
      if (!Number.isInteger(input?.year) || !Number.isInteger(input?.month) || input.month < 1 || input.month > 12 || typeof input.event !== "string") throw new Error("入力が正しくありません");
      const key = monthKey(input.year, input.month);
      const record = state.records.get(key) || makeRecord(input.year, input.month);
      record.events = input.event.slice(0, 200);
      record.status = "draft";
      record.updatedAt = new Date().toISOString();
      if (state.db) await putMonth(record);
      state.records.set(key, record);
      if (state.record?.key === key) {
        state.record = record;
        els.eventsInput.value = record.events;
        updateEditorUi();
      } else if (!els.timelineView.hidden) renderTimeline();
      return { saved: key, event: record.events };
    }
  });
}

init();
