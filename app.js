/* ===== Remember — Tasks & Notes (Cloud Sync via Firestore) =====
 *
 * Architecture:
 *  - One Firestore document per room: rooms/{roomCode}
 *    { items: [...], updatedAt: <timestamp> }
 *  - We listen to that doc in realtime (onSnapshot). Any device that
 *    edits the doc triggers a sync to all other devices in the same room.
 *    Room code is saved in localStorage so reopening keeps you in the room.
 */

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCQWbGo9ZiVWi9yA_cjTtnbU9OmqExBSOw",
  authDomain: "remember-app-23675.firebaseapp.com",
  projectId: "remember-app-23675",
  storageBucket: "remember-app-23675.firebasestorage.app",
  messagingSenderId: "336133095619",
  appId: "1:336133095619:web:fd3093001828fdb5bea276",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ---------- Theme Management ---------- */

const THEME_KEY = "rememberApp.theme";
let currentTheme = localStorage.getItem(THEME_KEY) || "dark";
document.body.className = currentTheme === "light" ? "light-theme" : "dark-theme";

function toggleTheme() {
  currentTheme = currentTheme === "dark" ? "light" : "dark";
  document.body.className = currentTheme === "light" ? "light-theme" : "dark-theme";
  localStorage.setItem(THEME_KEY, currentTheme);
  render(); // Re-render to update dynamic tag colors if theme changes
}

document.getElementById("themeToggleWelcome").addEventListener("click", toggleTheme);
document.getElementById("themeToggleApp").addEventListener("click", toggleTheme);

/* ---------- Custom Modal Dialogs ---------- */

function showCustomAlert(title, message) {
  return new Promise((resolve) => {
    const alertEl = document.getElementById("customAlert");
    const titleEl = document.getElementById("customAlertTitle");
    const msgEl = document.getElementById("customAlertMessage");
    const okBtn = document.getElementById("customAlertOk");

    titleEl.textContent = title;
    msgEl.textContent = message;
    alertEl.style.display = "flex";
    
    okBtn.focus();

    function close() {
      alertEl.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      resolve();
    }

    function onOk() {
      close();
    }

    okBtn.addEventListener("click", onOk);
  });
}

function showCustomConfirm(title, message) {
  return new Promise((resolve) => {
    const confirmEl = document.getElementById("customConfirm");
    const titleEl = document.getElementById("customConfirmTitle");
    const msgEl = document.getElementById("customConfirmMessage");
    const okBtn = document.getElementById("customConfirmOk");
    const cancelBtn = document.getElementById("customConfirmCancel");

    titleEl.textContent = title;
    msgEl.textContent = message;
    confirmEl.style.display = "flex";
    
    okBtn.focus();

    function cleanUp() {
      confirmEl.style.display = "none";
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
    }

    function onOk() {
      cleanUp();
      resolve(true);
    }

    function onCancel() {
      cleanUp();
      resolve(false);
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  });
}

/* ---------- Toast Notification ---------- */

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.style.display = "block";
  toast.className = "toast show";
  setTimeout(() => {
    toast.className = "toast";
    setTimeout(() => {
      toast.style.display = "none";
    }, 300);
  }, 2000);
}

/* ---------- State ---------- */

const ROOM_KEY = "rememberApp.room";
let state = {
  room: "", // current room code
  items: [], // { id, type, text, tag, done, priority, dueDate, createdAt }
  search: "", // current search text
  activeTag: "", // "" = All
  activeTab: "all", // "all" | "tasks" | "notes" | "completed"
  unsub: null, // unsubscribe from onSnapshot
  ready: false, // got first snapshot?
  editingId: null, // ID of the item currently being edited
};

/* ---------- DOM ---------- */

const welcomeScreen = document.getElementById("welcomeScreen");
const appEl = document.getElementById("app");
const roomForm = document.getElementById("roomForm");
const roomInput = document.getElementById("roomInput");

const roomDisplay = document.getElementById("roomDisplay");
const roomCodeText = document.getElementById("roomCodeText");
const shareBtn = document.getElementById("shareBtn");

const form = document.getElementById("addForm");
const textInput = document.getElementById("textInput");
const tagSelect = document.getElementById("tagSelect");
const dueDateInput = document.getElementById("dueDateInput");
const prioritySelect = document.getElementById("prioritySelect");
const searchInput = document.getElementById("searchInput");
const tagFiltersEl = document.getElementById("tagFilters");
const itemListEl = document.getElementById("itemList");
const emptyStateEl = document.getElementById("emptyState");
const counterEl = document.getElementById("counter");
const clearDoneBtn = document.getElementById("clearDone");

const syncDot = document.getElementById("syncDot");
const syncText = document.getElementById("syncText");
const syncBtn = document.getElementById("syncBtn");

const getSelectedType = () => document.querySelector('input[name="itemType"]:checked')?.value || "task";

// Visibility trigger for priority & due dates based on form item type selection
const typeTaskRadio = document.getElementById("typeTask");
const typeNoteRadio = document.getElementById("typeNote");
const dueDateWrap = document.querySelector(".date-input-wrap");
const priorityWrap = document.querySelector(".priority-input-wrap");

function updateFormFieldsVisibility() {
  const selectedType = getSelectedType();
  if (selectedType === "note") {
    dueDateWrap.style.opacity = "0.3";
    dueDateWrap.style.pointerEvents = "none";
    priorityWrap.style.opacity = "0.3";
    priorityWrap.style.pointerEvents = "none";
  } else {
    dueDateWrap.style.opacity = "1";
    dueDateWrap.style.pointerEvents = "auto";
    priorityWrap.style.opacity = "1";
    priorityWrap.style.pointerEvents = "auto";
  }
}
typeTaskRadio.addEventListener("change", updateFormFieldsVisibility);
typeNoteRadio.addEventListener("change", updateFormFieldsVisibility);

/* ---------- Utilities & Colors ---------- */

function uniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function setSyncStatus(status) {
  // status: "connecting" | "saving" | "saved" | "error"
  syncDot.className = "sync-dot " + status;
  const labels = {
    connecting: "connecting…",
    saving: "saving…",
    saved: "synced",
    error: "sync error",
  };
  syncText.textContent = labels[status] || status;
  syncBtn.title =
    status === "saved"
      ? "Your data is saved in the cloud and synced across devices."
      : labels[status];
}

// Generate tags styles dynamically based on hashing strings
function getTagColorStyles(tag) {
  if (!tag) return "";
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);
  
  if (document.body.classList.contains("light-theme")) {
    const bg = `hsla(${hue}, 80%, 94%, 1)`;
    const text = `hsl(${hue}, 90%, 25%)`;
    const border = `hsla(${hue}, 80%, 86%, 1)`;
    return `background-color: ${bg}; color: ${text}; border: 1px solid ${border};`;
  } else {
    const bg = `hsla(${hue}, 65%, 45%, 0.14)`;
    const text = `hsl(${hue}, 85%, 78%)`;
    const border = `hsla(${hue}, 65%, 45%, 0.28)`;
    return `background-color: ${bg}; color: ${text}; border: 1px solid ${border};`;
  }
}

// Evaluates a due date and returns badge configurations
function getDueDateInfo(dueDateStr) {
  if (!dueDateStr) return null;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // input is YYYY-MM-DD local time, parse carefully:
  const parts = dueDateStr.split("-");
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  due.setHours(0, 0, 0, 0);
  
  const diffTime = due - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  const options = { month: "short", day: "numeric" };
  const formattedDate = due.toLocaleDateString("en-US", options);
  
  if (diffDays < 0) {
    return { text: `Overdue (${formattedDate})`, class: "overdue" };
  } else if (diffDays === 0) {
    return { text: "Today", class: "today" };
  } else if (diffDays === 1) {
    return { text: "Tomorrow", class: "tomorrow" };
  } else {
    return { text: formattedDate, class: "future" };
  }
}

/* ---------- Room management ---------- */

function loadSavedRoom() {
  try {
    return localStorage.getItem(ROOM_KEY) || "";
  } catch {
    return "";
  }
}

function joinRoom(roomCode) {
  const code = roomCode.trim().toLowerCase();
  if (!code) return;
  
  if (state.unsub) {
    state.unsub();
    state.unsub = null;
  }
  state.room = code;
  state.ready = false;
  try {
    localStorage.setItem(ROOM_KEY, code);
  } catch {}
  
  welcomeScreen.style.display = "none";
  appEl.style.display = "block";
  setSyncStatus("connecting");
  
  // Set room texts
  roomCodeText.textContent = code;
  roomDisplay.style.display = "flex";

  // subscribe to room doc
  const ref = doc(db, "rooms", code);
  state.unsub = onSnapshot(
    ref,
    (snap) => {
      const data = snap.data();
      state.items = data && Array.isArray(data.items) ? data.items : [];
      state.ready = true;
      setSyncStatus("saved");
      render();
    },
    async (err) => {
      console.error("Sync error:", err);
      setSyncStatus("error");
      await showCustomAlert("Sync Error", (err && err.message ? err.message : String(err)));
    }
  );
}

async function persist() {
  if (!state.room) return;
  setSyncStatus("saving");
  try {
    const ref = doc(db, "rooms", state.room);
    await setDoc(ref, { items: state.items, updatedAt: Date.now() });
    setTimeout(() => {
      if (syncDot.className.indexOf("saving") !== -1) setSyncStatus("saved");
    }, 1500);
  } catch (err) {
    console.error("Save failed:", err);
    setSyncStatus("error");
    showCustomAlert("Connection Offline", "Could not save your changes. Please check your internet connection.");
  }
}

function copyRoomLink() {
  if (!state.room) return;
  const inviteUrl = window.location.origin + window.location.pathname + "?room=" + encodeURIComponent(state.room);
  navigator.clipboard.writeText(inviteUrl)
    .then(() => {
      showToast("Invite Link Copied!");
    })
    .catch((err) => {
      console.error("Failed to copy:", err);
      // Fallback: copy room code
      navigator.clipboard.writeText(state.room);
      showToast("Room Code Copied!");
    });
}
shareBtn.addEventListener("click", copyRoomLink);

/* ---------- Core actions ---------- */

function addItem(text, tag, type) {
  const trimmed = text.trim();
  if (!trimmed) return;
  
  const selectedType = type === "note" ? "note" : "task";
  
  const item = {
    id: uniqueId(),
    type: selectedType,
    text: trimmed,
    tag: (tag || "").trim().replace(/^#/, ""),
    done: false,
    priority: selectedType === "task" ? prioritySelect.value : null,
    dueDate: selectedType === "task" ? dueDateInput.value : null,
    createdAt: Date.now(),
  };
  
  state.items.unshift(item);
  persist();
  render();
}

function toggleDone(id) {
  const item = state.items.find((i) => i.id === id);
  if (item) {
    item.done = !item.done;
    persist();
    render();
  }
}

function updateItemText(id, newText) {
  const item = state.items.find((i) => i.id === id);
  const trimmed = newText.trim();
  if (item && trimmed && item.text !== trimmed) {
    item.text = trimmed;
    persist();
  }
  render();
}

function deleteItem(id) {
  state.items = state.items.filter((i) => i.id !== id);
  persist();
  render();
}

function clearDone() {
  const before = state.items.length;
  state.items = state.items.filter((i) => !(i.type === "task" && i.done));
  if (state.items.length !== before) {
    persist();
    render();
  }
}

/* ---------- Sorting & filtering ---------- */

function sortedItems() {
  const items = state.items.slice();
  items.sort((a, b) => {
    // Notes always go below Tasks
    if (a.type !== b.type) return a.type === "task" ? -1 : 1;
    
    // Checked tasks always go to bottom
    const aDone = a.type === "task" && a.done ? 1 : 0;
    const bDone = b.type === "task" && b.done ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    
    // Sort tasks by priority (high > medium > low)
    if (a.type === "task" && a.priority !== b.priority) {
      const pMap = { high: 3, medium: 2, low: 1 };
      const aVal = pMap[a.priority || "medium"];
      const bVal = pMap[b.priority || "medium"];
      return bVal - aVal;
    }
    
    // Sort by due dates next
    if (a.type === "task" && a.dueDate !== b.dueDate) {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    
    // Default sorting: newest first
    return b.createdAt - a.createdAt;
  });
  return items;
}

function visibleItems() {
  const q = state.search.trim().toLowerCase();
  return sortedItems().filter((item) => {
    // 1. Tab categorizations
    if (state.activeTab === "tasks" && item.type !== "task") return false;
    if (state.activeTab === "notes" && item.type !== "note") return false;
    if (state.activeTab === "completed" && !(item.type === "task" && item.done)) return false;
    
    // 2. Tag filter
    if (state.activeTag && item.tag !== state.activeTag) return false;
    
    // 3. Search queries
    if (q) {
      const hay = (item.text + " " + (item.tag || "")).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function allTags() {
  const seen = {};
  const tags = [];
  state.items.forEach((item) => {
    if (item.tag && !seen[item.tag]) {
      seen[item.tag] = true;
      tags.push(item.tag);
    }
  });
  tags.sort();
  return tags;
}

/* ---------- Rendering ---------- */

function renderTagFilters() {
  const tags = allTags();
  tagFiltersEl.innerHTML = "";

  function makeChip(label, tag) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (state.activeTag === tag ? " active" : "");
    chip.textContent = label;
    
    if (tag && state.activeTag !== tag) {
      chip.style = getTagColorStyles(tag);
    }
    
    chip.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag ? "" : tag;
      render();
    });
    tagFiltersEl.appendChild(chip);
  }

  makeChip("All Tags", "");
  tags.forEach((tag) => makeChip("#" + tag, tag));

  const datalist = document.getElementById("tagList");
  if (datalist) {
    datalist.innerHTML = "";
    tags.forEach((tag) => {
      const opt = document.createElement("option");
      opt.value = tag;
      datalist.appendChild(opt);
    });
  }
}

function renderItem(item) {
  const li = document.createElement("li");
  li.className = "item" + (item.done ? " done" : "");
  
  if (item.type === "task") {
    const p = item.priority || "medium";
    li.classList.add("priority-" + p);
  }

  // Render Checkbox/Note Icon
  if (item.type === "task") {
    const customCheckbox = document.createElement("button");
    customCheckbox.type = "button";
    customCheckbox.className = "custom-checkbox" + (item.done ? " checked" : "");
    customCheckbox.setAttribute("aria-label", item.done ? "Mark as incomplete" : "Mark as complete");
    customCheckbox.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="check-icon"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    customCheckbox.addEventListener("click", () => toggleDone(item.id));
    li.appendChild(customCheckbox);
  } else {
    const noteIcon = document.createElement("div");
    noteIcon.className = "item-note-icon";
    noteIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>`;
    li.appendChild(noteIcon);
  }

  const isEditing = state.editingId === item.id;
  const body = document.createElement("div");
  body.className = "item-body";

  if (isEditing) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "item-edit-input";
    input.value = item.text;
    
    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    const saveEdit = () => {
      const val = input.value.trim();
      state.editingId = null;
      if (val && val !== item.text) {
        updateItemText(item.id, val);
      } else {
        render();
      }
    };

    const cancelEdit = () => {
      state.editingId = null;
      render();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        saveEdit();
      } else if (e.key === "Escape") {
        cancelEdit();
      }
    });

    input.addEventListener("blur", saveEdit);
    body.appendChild(input);
  } else {
    const text = document.createElement("div");
    text.className = "item-text";
    text.textContent = item.text;
    text.addEventListener("dblclick", () => {
      if (!item.done) {
        state.editingId = item.id;
        render();
      }
    });
    body.appendChild(text);
  }

  // Meta row for badges (Tags, Priority, Due dates)
  const metaContainer = document.createElement("div");
  metaContainer.className = "item-meta";
  
  // 1. Tag
  if (item.tag && !isEditing) {
    const tagEl = document.createElement("span");
    tagEl.className = "item-tag";
    tagEl.textContent = "#" + item.tag;
    tagEl.style = getTagColorStyles(item.tag);
    metaContainer.appendChild(tagEl);
  }
  
  // 2. Priority Label
  if (item.type === "task" && !isEditing) {
    const prio = item.priority || "medium";
    const prioBadge = document.createElement("span");
    prioBadge.className = "priority-badge " + prio;
    prioBadge.textContent = prio.toUpperCase();
    metaContainer.appendChild(prioBadge);
  }

  // 3. Due Date Badge
  if (item.type === "task" && item.dueDate && !isEditing) {
    const dueInfo = getDueDateInfo(item.dueDate);
    if (dueInfo) {
      const dueBadge = document.createElement("span");
      dueBadge.className = "due-date-badge " + dueInfo.class + (item.done ? " done" : "");
      dueBadge.innerHTML = `<svg class="calendar-icon" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${dueInfo.text}`;
      metaContainer.appendChild(dueBadge);
    }
  }

  if (metaContainer.children.length > 0) {
    body.appendChild(metaContainer);
  }

  li.appendChild(body);

  // Actions Container (Edit + Delete)
  const actions = document.createElement("div");
  actions.className = "item-actions";

  if (!item.done && !isEditing) {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "item-action-btn edit-btn";
    editBtn.title = "Edit item";
    editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`;
    editBtn.addEventListener("click", () => {
      state.editingId = item.id;
      render();
    });
    actions.appendChild(editBtn);
  }

  if (!isEditing) {
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "item-action-btn copy-btn";
    copyBtn.title = "Copy content";
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(item.text)
        .then(() => showToast("Copied to clipboard!"))
        .catch((err) => console.error("Copy failed:", err));
    });
    actions.appendChild(copyBtn);

    const waBtn = document.createElement("button");
    waBtn.type = "button";
    waBtn.className = "item-action-btn wa-btn";
    waBtn.title = "Share on WhatsApp";
    waBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>`;
    waBtn.addEventListener("click", () => {
      const textToShare = encodeURIComponent(item.text);
      const waUrl = `https://wa.me/?text=${textToShare}`;
      window.open(waUrl, "_blank");
    });
    actions.appendChild(waBtn);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "item-action-btn delete-btn";
  del.title = "Delete item";
  del.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  del.addEventListener("click", () => deleteItem(item.id));
  actions.appendChild(del);

  li.appendChild(actions);

  return li;
}

function renderCounter() {
  const total = state.items.length;
  const tasks = state.items.filter((i) => i.type === "task").length;
  const doneTasks = state.items.filter((i) => i.type === "task" && i.done).length;
  if (total === 0) {
    counterEl.textContent = "";
    return;
  }
  counterEl.textContent =
    tasks > 0
      ? doneTasks + "/" + tasks + " tasks done · " + total + " items"
      : total + (total === 1 ? " item" : " items");
}

function render() {
  renderTagFilters();

  const visible = visibleItems();
  itemListEl.innerHTML = "";
  if (visible.length === 0) {
    itemListEl.style.display = "none";
    emptyStateEl.style.display = "flex";
    emptyStateEl.querySelector("p").textContent =
      state.items.length === 0
        ? "Nothing here yet. Add your first task or note above! 👆"
        : "No items match your filters. 🔍";
  } else {
    itemListEl.style.display = "";
    emptyStateEl.style.display = "none";
    const frag = document.createDocumentFragment();
    visible.forEach((item) => frag.appendChild(renderItem(item)));
    itemListEl.appendChild(frag);
  }

  renderCounter();
  
  clearDoneBtn.style.display = state.items.some(
    (i) => i.type === "task" && i.done
  )
    ? "inline-block"
    : "none";

  // Re-adjust active tab slider position
  const activeTabBtn = document.querySelector(".tab-link.active");
  if (activeTabBtn) {
    updateTabsSliderPosition(activeTabBtn);
  }
}

/* ---------- Tabs System ---------- */

function updateTabsSliderPosition(activeBtn) {
  const slider = document.querySelector(".tabs-slider");
  if (slider && activeBtn) {
    slider.style.width = activeBtn.offsetWidth + "px";
    slider.style.left = activeBtn.offsetLeft + "px";
  }
}

document.querySelectorAll(".tab-link").forEach((tabBtn) => {
  tabBtn.addEventListener("click", () => {
    document.querySelectorAll(".tab-link").forEach((btn) => btn.classList.remove("active"));
    tabBtn.classList.add("active");
    state.activeTab = tabBtn.getAttribute("data-tab");
    updateTabsSliderPosition(tabBtn);
    render();
  });
});

window.addEventListener("resize", () => {
  const activeTabBtn = document.querySelector(".tab-link.active");
  if (activeTabBtn) {
    updateTabsSliderPosition(activeTabBtn);
  }
});

/* ---------- Event handlers ---------- */

roomForm.addEventListener("submit", (e) => {
  e.preventDefault();
  joinRoom(roomInput.value);
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  addItem(textInput.value, tagSelect.value, getSelectedType());
  textInput.value = "";
  tagSelect.value = "";
  dueDateInput.value = "";
  prioritySelect.value = "medium";
  textInput.focus();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  render();
});

clearDoneBtn.addEventListener("click", clearDone);

function leaveRoom() {
  showCustomConfirm("Leave Room?", "Are you sure you want to leave this room and join a different one? Your code keeps your room accessible.").then((confirmed) => {
    if (confirmed) {
      if (state.unsub) state.unsub();
      state.unsub = null;
      state.room = "";
      state.items = [];
      try {
        localStorage.removeItem(ROOM_KEY);
      } catch {}
      
      // Clear room query parameter from the URL
      const url = new URL(window.location);
      url.searchParams.delete("room");
      window.history.pushState({}, "", url);
      
      appEl.style.display = "none";
      welcomeScreen.style.display = "flex";
      roomDisplay.style.display = "none";
      roomInput.value = "";
      roomInput.focus();
    }
  });
}

const leaveRoomBtn = document.getElementById("leaveRoomBtn");
leaveRoomBtn.addEventListener("click", leaveRoom);

// click sync button to leave room (change room)
let syncClicks = 0;
let syncClickTimer = null;
syncBtn.addEventListener("click", () => {
  syncClicks++;
  clearTimeout(syncClickTimer);
  syncClickTimer = setTimeout(() => (syncClicks = 0), 600);
  if (syncClicks >= 3) {
    syncClicks = 0;
    leaveRoom();
  }
});

/* ---------- Init ---------- */

const savedRoom = loadSavedRoom();
const params = new URLSearchParams(window.location.search);
const roomParam = params.get("room");

if (roomParam) {
  joinRoom(roomParam);
} else if (savedRoom) {
  joinRoom(savedRoom);
} else {
  roomInput.focus();
}

// Initial form inputs state
updateFormFieldsVisibility();
