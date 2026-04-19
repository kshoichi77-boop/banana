"use strict";

const STORAGE_KEY = "personalDeadlineCalendarTasks";
const EXPORT_VERSION = 1;
const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MAX_UPCOMING_TASKS = 8;

const STATUS = {
  PENDING: "pending",
  DONE: "done"
};

const STATUS_LABELS = {
  [STATUS.PENDING]: "未提出",
  [STATUS.DONE]: "提出済み"
};

const SUBJECTS = ["国語", "数学", "英語", "理科", "社会", "情報", "その他"];
const DEFAULT_SUBJECT = SUBJECTS[0];

const FILTER_LABELS = {
  all: "すべて",
  pending: "未提出",
  today: "今日締切",
  soon: "3日以内",
  overdue: "期限切れ",
  done: "提出済み"
};

// 文字化けしていた旧データをできる範囲で現在の値へ寄せます。
const LEGACY_SUBJECT_MAP = new Map([
  ["蝗ｽ隱・", "国語"],
  ["謨ｰ蟄ｦ", "数学"],
  ["闍ｱ隱・", "英語"],
  ["逅・ｧ・", "理科"],
  ["遉ｾ莨・", "社会"],
  ["諠・ｱ", "情報"],
  ["縺昴・莉・", "その他"]
]);

const LEGACY_STATUS_MAP = new Map([
  [STATUS.PENDING, STATUS.PENDING],
  [STATUS.DONE, STATUS.DONE],
  ["未提出", STATUS.PENDING],
  ["提出済み", STATUS.DONE],
  ["譛ｪ謠仙・", STATUS.PENDING],
  ["謠仙・貂医∩", STATUS.DONE]
]);

const state = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedDate: "",
  currentFilter: "all",
  editingTaskId: null,
  tasks: []
};

const elements = {};

// 保存処理はこのオブジェクトに集約します。将来Firebase等へ移す場合もここを差し替えます。
const storage = {
  getTasks() {
    try {
      const storedValue = localStorage.getItem(STORAGE_KEY);

      if (!storedValue) {
        return [];
      }

      const parsedValue = JSON.parse(storedValue);
      const sourceTasks = getTaskArrayFromData(parsedValue);
      return sourceTasks.map(normalizeTask).filter(Boolean);
    } catch (error) {
      console.warn("課題データを読み込めませんでした。", error);
      return [];
    }
  },

  saveTasks(tasks) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
      return true;
    } catch (error) {
      console.warn("課題データを保存できませんでした。", error);
      return false;
    }
  },

  exportData() {
    return {
      app: "assignment-deadline-calendar",
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      tasks: state.tasks.map((task) => ({ ...task }))
    };
  },

  importData(data) {
    const sourceTasks = getTaskArrayFromData(data);
    const importedTasks = sourceTasks.map(normalizeTask).filter(Boolean);

    if (sourceTasks.length > 0 && importedTasks.length === 0) {
      throw new Error("読み込める課題がありませんでした。JSONの中身を確認してください。");
    }

    this.saveTasks(importedTasks);
    return importedTasks;
  },

  clearTasks() {
    return this.saveTasks([]);
  }
};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  initializeApp();
  bindEvents();
  refreshUI();
});

function cacheElements() {
  const ids = [
    "todayDateText",
    "goTodayButton",
    "summaryPending",
    "summaryToday",
    "summarySoon",
    "summaryOverdue",
    "filterTabs",
    "prevMonthButton",
    "nextMonthButton",
    "currentMonthText",
    "calendarGrid",
    "selectedDateTitle",
    "selectedDateSubtitle",
    "selectedDateTasks",
    "deadlineSubtitle",
    "deadlineList",
    "taskFormPanel",
    "taskFormTitle",
    "taskForm",
    "taskId",
    "taskSubject",
    "taskTitle",
    "taskDueDate",
    "taskStatus",
    "taskMemo",
    "taskFormError",
    "taskSubmitButton",
    "cancelEditButton",
    "editStateText",
    "exportButton",
    "importFileInput",
    "clearDataButton",
    "dataMessage"
  ];

  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function initializeApp() {
  state.selectedDate = getTodayDateString();
  state.tasks = storage.getTasks();
  resetTaskForm();
}

function bindEvents() {
  elements.filterTabs.addEventListener("click", handleFilterClick);
  elements.prevMonthButton.addEventListener("click", () => handleMonthChange(-1));
  elements.nextMonthButton.addEventListener("click", () => handleMonthChange(1));
  elements.goTodayButton.addEventListener("click", handleGoTodayClick);
  elements.calendarGrid.addEventListener("click", handleCalendarClick);
  elements.selectedDateTasks.addEventListener("click", handleTaskAction);
  elements.deadlineList.addEventListener("click", handleTaskAction);
  elements.taskForm.addEventListener("submit", handleTaskSubmit);
  elements.cancelEditButton.addEventListener("click", resetTaskForm);
  elements.exportButton.addEventListener("click", handleExportClick);
  elements.importFileInput.addEventListener("change", handleImportChange);
  elements.clearDataButton.addEventListener("click", handleClearDataClick);
}

function refreshUI() {
  elements.todayDateText.textContent = `今日: ${formatDisplayDate(getTodayDateString())}`;
  renderFilterButtons();
  renderSummary();
  renderCalendar();
  renderSelectedDateTasks();
  renderDeadlineList();
  renderTaskFormState();
}

function renderFilterButtons() {
  elements.filterTabs.querySelectorAll(".filter-button").forEach((button) => {
    const isActive = button.dataset.filter === state.currentFilter;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function renderSummary() {
  const pendingTasks = state.tasks.filter(isPendingTask);
  const todayCount = pendingTasks.filter((task) => getDaysRemaining(task.dueDate) === 0).length;
  const soonCount = pendingTasks.filter((task) => {
    const daysRemaining = getDaysRemaining(task.dueDate);
    return daysRemaining >= 1 && daysRemaining <= 3;
  }).length;
  const overdueCount = pendingTasks.filter((task) => getDaysRemaining(task.dueDate) < 0).length;

  elements.summaryPending.textContent = String(pendingTasks.length);
  elements.summaryToday.textContent = String(todayCount);
  elements.summarySoon.textContent = String(soonCount);
  elements.summaryOverdue.textContent = String(overdueCount);
}

function renderCalendar() {
  const visibleTasks = getFilteredTasks(state.currentFilter, state.tasks);
  const firstDate = new Date(state.currentYear, state.currentMonth, 1);
  const firstWeekday = firstDate.getDay();
  const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const todayString = getTodayDateString();
  const calendarCells = [];

  elements.currentMonthText.textContent = `${state.currentYear}年${state.currentMonth + 1}月`;

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    if (cellIndex < firstWeekday || cellIndex >= firstWeekday + daysInMonth) {
      calendarCells.push('<div class="calendar-blank" aria-hidden="true"></div>');
      continue;
    }

    const dayNumber = cellIndex - firstWeekday + 1;
    const dateString = formatDateForInput(new Date(state.currentYear, state.currentMonth, dayNumber));
    const dayTasks = getTasksByDate(dateString, visibleTasks).sort(compareTasksByDeadline);
    const risk = getDateRiskInfo(dateString, dayTasks);
    const previewTasks = dayTasks.slice(0, 2);
    const hiddenTaskCount = Math.max(0, dayTasks.length - previewTasks.length);
    const ariaLabel = `${formatDisplayDate(dateString)}、${dayTasks.length}件${risk.label ? `、${risk.label}` : ""}`;

    calendarCells.push(`
      <button
        class="calendar-day ${risk.className} ${dateString === todayString ? "is-today" : ""} ${dateString === state.selectedDate ? "is-selected" : ""}"
        type="button"
        data-date="${escapeAttribute(dateString)}"
        aria-label="${escapeAttribute(ariaLabel)}"
      >
        <span class="date-number-row">
          <span class="date-number">${dayNumber}</span>
          ${dayTasks.length > 0 ? `<span class="count-badge">${dayTasks.length}件</span>` : ""}
        </span>
        <span class="day-info-row">
          ${risk.label ? `<span class="day-risk">${escapeHtml(risk.label)}</span>` : ""}
        </span>
        <span class="calendar-task-preview">
          ${previewTasks.map(createCalendarTaskSnippet).join("")}
          ${hiddenTaskCount > 0 ? `<span class="more-count">+${hiddenTaskCount}件</span>` : ""}
        </span>
      </button>
    `);
  }

  elements.calendarGrid.innerHTML = calendarCells.join("");
}

function renderSelectedDateTasks() {
  const visibleTasks = getFilteredTasks(state.currentFilter, state.tasks);
  const selectedTasks = getTasksByDate(state.selectedDate, visibleTasks).sort(compareTasksByDeadline);
  const filterLabel = FILTER_LABELS[state.currentFilter] || FILTER_LABELS.all;

  elements.selectedDateTitle.textContent = `${formatDisplayDate(state.selectedDate)} の課題`;
  elements.selectedDateSubtitle.textContent = `${filterLabel}で${selectedTasks.length}件表示しています。`;

  if (selectedTasks.length === 0) {
    elements.selectedDateTasks.innerHTML = `<p class="empty-message">${escapeHtml(getSelectedDateEmptyMessage())}</p>`;
    return;
  }

  elements.selectedDateTasks.innerHTML = selectedTasks.map((task) => createTaskCardHtml(task, "detail")).join("");
}

function renderDeadlineList() {
  const visibleTasks = getFilteredTasks(state.currentFilter, state.tasks);
  const deadlineTasks = getDeadlineListTasks(visibleTasks);
  const visibleDeadlineTasks = deadlineTasks.slice(0, MAX_UPCOMING_TASKS);
  const hiddenCount = Math.max(0, deadlineTasks.length - visibleDeadlineTasks.length);

  elements.deadlineSubtitle.textContent = state.currentFilter === "done"
    ? "提出済みの課題を期限順に表示します。"
    : "未提出の課題を危険度と期限順に表示します。";

  if (state.tasks.length === 0) {
    elements.deadlineList.innerHTML = '<p class="empty-message">まだ課題が登録されていません。下のフォームから追加できます。</p>';
    return;
  }

  if (deadlineTasks.length === 0) {
    elements.deadlineList.innerHTML = `<p class="empty-message">${escapeHtml(getDeadlineEmptyMessage())}</p>`;
    return;
  }

  const listHtml = visibleDeadlineTasks.map((task) => createTaskCardHtml(task, "compact")).join("");
  const noteHtml = hiddenCount > 0 ? `<p class="list-note">さらに${hiddenCount}件あります。フィルタやカレンダーで確認できます。</p>` : "";
  elements.deadlineList.innerHTML = `${listHtml}${noteHtml}`;
}

function renderTaskFormState() {
  const isEditing = Boolean(state.editingTaskId);
  const editingTask = state.tasks.find((task) => task.id === state.editingTaskId);

  elements.taskFormPanel.classList.toggle("is-editing", isEditing);
  elements.cancelEditButton.classList.toggle("hidden", !isEditing);
  elements.taskFormTitle.textContent = isEditing ? "課題を編集する" : "課題を登録する";
  elements.taskSubmitButton.textContent = isEditing ? "課題を更新" : "課題を追加";
  elements.editStateText.textContent = isEditing && editingTask
    ? `「${editingTask.title}」を編集中です。更新するか、キャンセルしてください。`
    : "課題名と提出期限を入力してください。";
}

function handleFilterClick(event) {
  const button = event.target.closest("button[data-filter]");

  if (!button) {
    return;
  }

  state.currentFilter = button.dataset.filter;
  refreshUI();
}

function handleMonthChange(amount) {
  const nextMonthDate = new Date(state.currentYear, state.currentMonth + amount, 1);
  state.currentYear = nextMonthDate.getFullYear();
  state.currentMonth = nextMonthDate.getMonth();
  refreshUI();
}

function handleGoTodayClick() {
  const todayString = getTodayDateString();
  state.selectedDate = todayString;
  setCalendarMonthFromDate(todayString);

  if (!state.editingTaskId) {
    elements.taskDueDate.value = todayString;
  }

  refreshUI();
}

function handleCalendarClick(event) {
  const button = event.target.closest("button[data-date]");

  if (!button) {
    return;
  }

  state.selectedDate = button.dataset.date;

  if (!state.editingTaskId) {
    elements.taskDueDate.value = state.selectedDate;
  }

  refreshUI();
}

function handleTaskAction(event) {
  const button = event.target.closest("button[data-action]");

  if (!button) {
    return;
  }

  const taskId = button.dataset.id;
  const action = button.dataset.action;

  if (action === "toggle-status") {
    toggleTaskStatus(taskId);
    return;
  }

  if (action === "edit") {
    handleEditTask(taskId);
    return;
  }

  if (action === "delete") {
    handleDeleteTask(taskId);
  }
}

function handleTaskSubmit(event) {
  event.preventDefault();

  const formData = getTaskFormData();
  const errors = validateTask(formData);

  if (errors.length > 0) {
    elements.taskFormError.textContent = errors.join(" / ");
    return;
  }

  const now = new Date().toISOString();

  if (state.editingTaskId) {
    const targetTask = state.tasks.find((task) => task.id === state.editingTaskId);

    if (!targetTask) {
      elements.taskFormError.textContent = "編集中の課題が見つかりませんでした。もう一度選び直してください。";
      return;
    }

    state.tasks = state.tasks.map((task) => task.id === state.editingTaskId
      ? { ...task, ...formData, updatedAt: now }
      : task);
  } else {
    state.tasks.push({
      id: generateId(),
      ...formData,
      createdAt: now,
      updatedAt: now
    });
  }

  state.selectedDate = formData.dueDate;
  setCalendarMonthFromDate(formData.dueDate);
  persistTasks("課題を保存しました。");
  resetTaskForm();
  refreshUI();
}

function handleEditTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) {
    return;
  }

  state.editingTaskId = task.id;
  state.selectedDate = task.dueDate;
  setCalendarMonthFromDate(task.dueDate);
  fillTaskForm(task);
  refreshUI();
  elements.taskFormPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  elements.taskTitle.focus();
}

function handleDeleteTask(taskId) {
  const task = state.tasks.find((item) => item.id === taskId);

  if (!task) {
    return;
  }

  const confirmed = confirm(`「${task.title}」を削除します。この操作は元に戻せません。よろしいですか？`);

  if (!confirmed) {
    return;
  }

  state.tasks = state.tasks.filter((item) => item.id !== taskId);

  if (state.editingTaskId === taskId) {
    resetTaskForm();
  }

  persistTasks("課題を削除しました。");
  refreshUI();
}

function toggleTaskStatus(taskId) {
  let updatedTask = null;

  state.tasks = state.tasks.map((task) => {
    if (task.id !== taskId) {
      return task;
    }

    updatedTask = {
      ...task,
      status: task.status === STATUS.PENDING ? STATUS.DONE : STATUS.PENDING,
      updatedAt: new Date().toISOString()
    };

    return updatedTask;
  });

  if (updatedTask && state.editingTaskId === updatedTask.id) {
    fillTaskForm(updatedTask);
  }

  persistTasks("提出状況を更新しました。");
  refreshUI();
}

function handleExportClick() {
  const data = storage.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `deadline-calendar-${getTodayDateString()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showDataMessage("JSONファイルを書き出しました。");
}

function handleImportChange(event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      const parsedData = JSON.parse(String(reader.result));
      const confirmed = confirm("現在の課題データを、インポートした内容で上書きします。よろしいですか？");

      if (!confirmed) {
        return;
      }

      state.tasks = storage.importData(parsedData);
      state.editingTaskId = null;
      state.currentFilter = "all";
      state.selectedDate = getTodayDateString();
      setCalendarMonthFromDate(state.selectedDate);
      resetTaskForm();
      refreshUI();
      showDataMessage(`${state.tasks.length}件の課題をインポートしました。`);
    } catch (error) {
      showDataMessage(`インポートに失敗しました。${error.message}`);
    } finally {
      elements.importFileInput.value = "";
    }
  });

  reader.addEventListener("error", () => {
    showDataMessage("ファイルを読み込めませんでした。別のJSONファイルを選んでください。");
    elements.importFileInput.value = "";
  });

  reader.readAsText(file);
}

function handleClearDataClick() {
  const confirmed = confirm("すべての課題データを削除します。この操作は元に戻せません。よろしいですか？");

  if (!confirmed) {
    return;
  }

  state.tasks = [];
  state.editingTaskId = null;
  storage.clearTasks();
  resetTaskForm();
  refreshUI();
  showDataMessage("すべての課題データを削除しました。");
}

function resetTaskForm() {
  state.editingTaskId = null;
  elements.taskForm.reset();
  elements.taskId.value = "";
  elements.taskSubject.value = DEFAULT_SUBJECT;
  elements.taskDueDate.value = state.selectedDate || getTodayDateString();
  elements.taskStatus.value = STATUS.PENDING;
  elements.taskFormError.textContent = "";
  renderTaskFormState();
}

function fillTaskForm(task) {
  elements.taskId.value = task.id;
  elements.taskSubject.value = task.subject;
  elements.taskTitle.value = task.title;
  elements.taskDueDate.value = task.dueDate;
  elements.taskStatus.value = task.status;
  elements.taskMemo.value = task.memo || "";
  elements.taskFormError.textContent = "";
}

function getTaskFormData() {
  return {
    subject: elements.taskSubject.value,
    title: elements.taskTitle.value.trim(),
    dueDate: elements.taskDueDate.value,
    status: elements.taskStatus.value,
    memo: elements.taskMemo.value.trim()
  };
}

function validateTask(task) {
  const errors = [];

  if (!SUBJECTS.includes(task.subject)) {
    errors.push("教科を正しく選んでください。");
  }

  if (!task.title) {
    errors.push("課題名を入力してください。");
  } else if (task.title.length > 80) {
    errors.push("課題名は80文字以内にしてください。");
  }

  if (!task.dueDate) {
    errors.push("提出期限を入力してください。");
  } else if (!isValidDateString(task.dueDate)) {
    errors.push("提出期限の日付が正しくありません。");
  }

  if (!Object.values(STATUS).includes(task.status)) {
    errors.push("提出状況を正しく選んでください。");
  }

  if (task.memo.length > 300) {
    errors.push("メモは300文字以内にしてください。");
  }

  return errors;
}

function getFilteredTasks(filterType, tasks) {
  return tasks.filter((task) => {
    const daysRemaining = getDaysRemaining(task.dueDate);

    if (filterType === "pending") {
      return task.status === STATUS.PENDING;
    }

    if (filterType === "today") {
      return task.status === STATUS.PENDING && daysRemaining === 0;
    }

    if (filterType === "soon") {
      return task.status === STATUS.PENDING && daysRemaining >= 1 && daysRemaining <= 3;
    }

    if (filterType === "overdue") {
      return task.status === STATUS.PENDING && daysRemaining < 0;
    }

    if (filterType === "done") {
      return task.status === STATUS.DONE;
    }

    return true;
  });
}

function getTasksByDate(dateString, tasks) {
  return tasks.filter((task) => task.dueDate === dateString);
}

function getDeadlineListTasks(visibleTasks) {
  if (state.currentFilter === "done") {
    return [...visibleTasks].sort(compareTasksByDeadline);
  }

  return visibleTasks.filter(isPendingTask).sort(compareTasksByDeadline);
}

function getDateRiskInfo(dateString, tasks) {
  const pendingTasks = tasks.filter(isPendingTask);
  const doneTasks = tasks.filter((task) => task.status === STATUS.DONE);

  if (pendingTasks.length === 0 && doneTasks.length > 0) {
    return { className: "level-done", label: "提出済み" };
  }

  if (pendingTasks.length === 0) {
    return { className: "level-none", label: "" };
  }

  const daysRemaining = getDaysRemaining(dateString);

  if (daysRemaining < 0) {
    return { className: "level-overdue", label: "期限切れ" };
  }

  if (daysRemaining === 0) {
    return { className: "level-today", label: "今日締切" };
  }

  if (daysRemaining <= 3) {
    return { className: "level-soon", label: "3日以内" };
  }

  return { className: "level-pending", label: "未提出" };
}

function getSelectedDateEmptyMessage() {
  if (state.currentFilter === "all") {
    return "この日に登録された課題はありません。日付を選んだまま下のフォームから追加できます。";
  }

  return `この日に「${FILTER_LABELS[state.currentFilter]}」の課題はありません。`;
}

function getDeadlineEmptyMessage() {
  if (state.currentFilter === "done") {
    return "提出済みの課題はありません。";
  }

  if (state.currentFilter === "all" || state.currentFilter === "pending") {
    return "未提出の課題はありません。";
  }

  return `「${FILTER_LABELS[state.currentFilter]}」の課題はありません。`;
}

function createCalendarTaskSnippet(task) {
  const title = `${task.subject} ${task.title}`;
  return `<span class="task-snippet">${escapeHtml(title)}</span>`;
}

function createTaskCardHtml(task, variant) {
  const isCompact = variant === "compact";
  const riskClass = getTaskRiskClass(task);
  const statusLabel = STATUS_LABELS[task.status];
  const toggleLabel = task.status === STATUS.PENDING ? "提出済みにする" : "未提出に戻す";
  const toggleButtonClass = task.status === STATUS.PENDING ? "button-primary" : "button-secondary";
  const memoHtml = !isCompact
    ? `<p class="memo-text">${escapeHtml(task.memo || "メモなし")}</p>`
    : "";

  return `
    <article class="task-card ${riskClass}">
      <h3 class="task-title">
        <span class="task-subject">${escapeHtml(task.subject)}</span>
        <span class="task-title-main">${escapeHtml(task.title)}</span>
      </h3>
      <p class="task-meta">
        <span class="meta-chip">期限: ${escapeHtml(formatDisplayDate(task.dueDate))}</span>
        <span class="meta-chip">${escapeHtml(getTimingLabel(task))}</span>
        <span class="status-chip ${task.status === STATUS.DONE ? "status-done" : "status-pending"}">${escapeHtml(statusLabel)}</span>
      </p>
      ${memoHtml}
      <div class="task-actions">
        <button class="button button-small ${toggleButtonClass}" type="button" data-action="toggle-status" data-id="${escapeAttribute(task.id)}">${toggleLabel}</button>
        <button class="button button-small button-secondary" type="button" data-action="edit" data-id="${escapeAttribute(task.id)}">編集</button>
        <button class="button button-small button-danger" type="button" data-action="delete" data-id="${escapeAttribute(task.id)}">削除</button>
      </div>
    </article>
  `;
}

function getTaskRiskClass(task) {
  if (task.status === STATUS.DONE) {
    return "is-done";
  }

  const daysRemaining = getDaysRemaining(task.dueDate);

  if (daysRemaining < 0) {
    return "is-overdue";
  }

  if (daysRemaining === 0) {
    return "is-today";
  }

  if (daysRemaining <= 3) {
    return "is-soon";
  }

  return "";
}

function getTimingLabel(task) {
  if (task.status === STATUS.DONE) {
    return "提出済み";
  }

  return formatRemainingLabel(task.dueDate);
}

function formatRemainingLabel(dateString) {
  const daysRemaining = getDaysRemaining(dateString);

  if (daysRemaining < 0) {
    return `${Math.abs(daysRemaining)}日遅れ`;
  }

  if (daysRemaining === 0) {
    return "今日締切";
  }

  if (daysRemaining === 1) {
    return "明日締切";
  }

  return `あと${daysRemaining}日`;
}

function compareTasksByDeadline(a, b) {
  const rankDifference = getDeadlineRank(a) - getDeadlineRank(b);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  const dateDifference = a.dueDate.localeCompare(b.dueDate);

  if (dateDifference !== 0) {
    return dateDifference;
  }

  return a.title.localeCompare(b.title, "ja");
}

function getDeadlineRank(task) {
  if (task.status === STATUS.DONE) {
    return 4;
  }

  const daysRemaining = getDaysRemaining(task.dueDate);

  if (daysRemaining < 0) {
    return 0;
  }

  if (daysRemaining === 0) {
    return 1;
  }

  if (daysRemaining <= 3) {
    return 2;
  }

  return 3;
}

function isPendingTask(task) {
  return task.status === STATUS.PENDING;
}

function persistTasks(successMessage) {
  const saved = storage.saveTasks(state.tasks);

  if (saved) {
    showDataMessage(successMessage);
    return;
  }

  showDataMessage("ブラウザへの保存に失敗しました。空き容量やプライベートブラウズ設定を確認してください。");
}

function showDataMessage(message) {
  elements.dataMessage.textContent = message;
}

function normalizeTask(task) {
  if (!task || typeof task !== "object") {
    return null;
  }

  const normalizedTask = {
    id: typeof task.id === "string" && task.id.trim() ? task.id : generateId(),
    subject: normalizeSubject(task.subject),
    title: typeof task.title === "string" ? task.title.trim() : "",
    dueDate: isValidDateString(task.dueDate) ? task.dueDate : "",
    status: normalizeStatus(task.status, task.done),
    memo: typeof task.memo === "string" ? task.memo.trim() : "",
    createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date().toISOString(),
    updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : new Date().toISOString()
  };

  return validateTask(normalizedTask).length === 0 ? normalizedTask : null;
}

function normalizeSubject(value) {
  if (typeof value !== "string") {
    return DEFAULT_SUBJECT;
  }

  const trimmedValue = value.trim();

  if (SUBJECTS.includes(trimmedValue)) {
    return trimmedValue;
  }

  return LEGACY_SUBJECT_MAP.get(trimmedValue) || "その他";
}

function normalizeStatus(value, doneValue) {
  if (typeof value === "string" && LEGACY_STATUS_MAP.has(value.trim())) {
    return LEGACY_STATUS_MAP.get(value.trim());
  }

  if (typeof doneValue === "boolean") {
    return doneValue ? STATUS.DONE : STATUS.PENDING;
  }

  return STATUS.PENDING;
}

function getTaskArrayFromData(data) {
  if (Array.isArray(data)) {
    return data;
  }

  if (data && typeof data === "object" && Array.isArray(data.tasks)) {
    return data.tasks;
  }

  throw new Error("JSONの形式が正しくありません。tasks配列を含むデータを選んでください。");
}

function setCalendarMonthFromDate(dateString) {
  if (!isValidDateString(dateString)) {
    return;
  }

  const date = parseDateString(dateString);
  state.currentYear = date.getFullYear();
  state.currentMonth = date.getMonth();
}

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }

  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function getTodayDateString() {
  return formatDateForInput(new Date());
}

function getDaysRemaining(dateString) {
  const today = parseDateString(getTodayDateString());
  const targetDate = parseDateString(dateString);
  return Math.round((targetDate.getTime() - today.getTime()) / DAY_IN_MS);
}

function parseDateString(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDateForInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidDateString(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString))) {
    return false;
  }

  const date = parseDateString(dateString);
  return !Number.isNaN(date.getTime()) && formatDateForInput(date) === dateString;
}

function formatDisplayDate(dateString) {
  if (!isValidDateString(dateString)) {
    return "日付不明";
  }

  const date = parseDateString(dateString);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
