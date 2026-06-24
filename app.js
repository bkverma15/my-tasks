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

/* ---------- State & Upload variables ---------- */

const ROOM_KEY = "rememberApp.room";
let state = {
  room: "", // current room code
  items: [], // { id, type, text, tag, done, priority, dueDate, createdAt, image, pinned }
  trash: [], // deleted items (can be restored)
  activities: [], // { id, text, detail, time } (history logs)
  search: "", // current search text
  activeTag: "", // "" = All
  activeTab: "dashboard", // Default to dashboard! "dashboard" | "tasks" | "notes" | "completed" | "trash"
  unsub: null, // unsubscribe from onSnapshot
  ready: false, // got first snapshot?
  editingId: null, // ID of the item currently being edited
};

let currentBase64Image = null; // Stores temporary image file before submission

/* ---------- DOM Selectors ---------- */

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
const repeatSelect = document.getElementById("repeatSelect");
const searchInput = document.getElementById("searchInput");
const tagFiltersEl = document.getElementById("tagFilters");
const itemListEl = document.getElementById("itemList");
const emptyStateEl = document.getElementById("emptyState");
const counterEl = document.getElementById("counter");
const clearDoneBtn = document.getElementById("clearDone");

const syncDot = document.getElementById("syncDot");
const syncText = document.getElementById("syncText");
const syncBtn = document.getElementById("syncBtn");

// Image uploader DOM elements
const imageInput = document.getElementById("imageInput");
const attachBtn = document.getElementById("attachBtn");
const formImagePreview = document.getElementById("formImagePreview");
const previewImg = document.getElementById("previewImg");
const removePreviewBtn = document.getElementById("removePreviewBtn");

// New Redesign Selectors
const quickAddModal = document.getElementById("quickAddModal");
const quickAddBtn = document.getElementById("quickAddBtn");
const mobileQuickAddBtn = document.getElementById("mobileQuickAddBtn");
const closeQuickAdd = document.getElementById("closeQuickAdd");
const greetingText = document.getElementById("greetingText");
const greetingSubText = document.getElementById("greetingSubText");
const dashboardView = document.getElementById("dashboardView");
const listViewPanel = document.getElementById("listViewPanel");
const upcomingTasksList = document.getElementById("upcomingTasksList");
const upcomingTasksBadge = document.getElementById("upcomingTasksBadge");
const viewAllTasksLink = document.getElementById("viewAllTasksLink");
const pinnedNotesList = document.getElementById("pinnedNotesList");
const activityList = document.getElementById("activityList");
const clearHistoryLink = document.getElementById("clearHistoryLink");
const topSyncStatusText = document.getElementById("topSyncStatusText");

/* ---------- Image Compressor Utility ---------- */

function compressImage(file, maxWidth = 600, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        
        // Output compressed JPEG
        const compressedBase64 = canvas.toDataURL("image/jpeg", quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

const getSelectedType = () => document.querySelector('input[name="itemType"]:checked')?.value || "task";

// Visibility trigger for priority & due dates based on form item type selection
const typeTaskRadio = document.getElementById("typeTask");
const typeNoteRadio = document.getElementById("typeNote");
const dueDateWrap = document.querySelector(".date-input-wrap");
const priorityWrap = document.querySelector(".priority-input-wrap");
const repeatWrap = document.querySelector(".repeat-input-wrap");

function updateFormFieldsVisibility() {
  const selectedType = getSelectedType();
  if (selectedType === "note") {
    dueDateWrap.style.opacity = "0.3";
    dueDateWrap.style.pointerEvents = "none";
    priorityWrap.style.opacity = "0.3";
    priorityWrap.style.pointerEvents = "none";
    repeatWrap.style.opacity = "0.3";
    repeatWrap.style.pointerEvents = "none";
  } else {
    dueDateWrap.style.opacity = "1";
    dueDateWrap.style.pointerEvents = "auto";
    priorityWrap.style.opacity = "1";
    priorityWrap.style.pointerEvents = "auto";
    repeatWrap.style.opacity = "1";
    repeatWrap.style.pointerEvents = "auto";
  }
}
typeTaskRadio.addEventListener("change", updateFormFieldsVisibility);
typeNoteRadio.addEventListener("change", updateFormFieldsVisibility);

/* ---------- Utilities & Colors ---------- */

function uniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function logActivity(text, detail = "") {
  const activity = {
    id: uniqueId(),
    text: text,
    detail: detail,
    time: Date.now(),
  };
  state.activities.unshift(activity);
  if (state.activities.length > 5) {
    state.activities = state.activities.slice(0, 5);
  }
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

  if (topSyncStatusText) {
    if (status === "saved") {
      topSyncStatusText.textContent = "Syncing complete";
    } else if (status === "saving" || status === "connecting") {
      topSyncStatusText.textContent = "Syncing...";
    } else {
      topSyncStatusText.textContent = "Sync error";
    }
  }
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

// Calculates the next due date based on the current due date and repeat interval
function calculateNextDueDate(currentDueDateStr, repeatInterval) {
  let baseDate = new Date();
  if (currentDueDateStr) {
    const parts = currentDueDateStr.split("-");
    baseDate = new Date(parts[0], parts[1] - 1, parts[2]);
  }
  baseDate.setHours(0, 0, 0, 0);

  switch (repeatInterval) {
    case "daily":
      baseDate.setDate(baseDate.getDate() + 1);
      break;
    case "weekly":
      baseDate.setDate(baseDate.getDate() + 7);
      break;
    case "monthly":
      baseDate.setMonth(baseDate.getMonth() + 1);
      break;
    case "yearly":
      baseDate.setFullYear(baseDate.getFullYear() + 1);
      break;
    default:
      break;
  }

  const yyyy = baseDate.getFullYear();
  const mm = String(baseDate.getMonth() + 1).padStart(2, '0');
  const dd = String(baseDate.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
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
  appEl.style.display = "flex";
  const welcomeThemeToggle = document.getElementById("themeToggleWelcome");
  if (welcomeThemeToggle) welcomeThemeToggle.style.display = "none";
  // Reset window scroll position to prevent layout cut-off issues
  window.scrollTo(0, 0);
  document.body.scrollTop = 0;
  document.documentElement.scrollTop = 0;
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
      state.trash = data && Array.isArray(data.trash) ? data.trash : [];
      state.activities = data && Array.isArray(data.activities) ? data.activities : [];
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
    await setDoc(ref, {
      items: state.items,
      trash: state.trash,
      activities: state.activities,
      updatedAt: Date.now(),
    });
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

function addItem(text, tag, type, repeatVal) {
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
    repeat: selectedType === "task" ? (repeatVal || "none") : "none",
    image: currentBase64Image, // Save the image base64
    createdAt: Date.now(),
    pinned: false,
  };
  
  state.items.unshift(item);
  logActivity(`Created ${selectedType} '${trimmed}'`, selectedType === "task" ? "Added to tasks list" : "Added to notes list");
  persist();

  // Reset uploader inputs and preview container
  currentBase64Image = null;
  imageInput.value = "";
  formImagePreview.style.display = "none";
  previewImg.src = "";

  render();
}

function toggleDone(id) {
  const itemIndex = state.items.findIndex((i) => i.id === id);
  if (itemIndex !== -1) {
    const item = state.items[itemIndex];
    const originalDone = item.done;
    item.done = !item.done;

    logActivity(`${item.done ? "Completed" : "Reopened"} task '${item.text}'`, item.done ? "Marked as done" : "Marked as active");

    // If marked complete and it is a recurring task, schedule the next one
    if (!originalDone && item.done && item.type === "task" && item.repeat && item.repeat !== "none") {
      const baseDueDate = item.dueDate || new Date().toISOString().split("T")[0];
      const nextDueDate = calculateNextDueDate(baseDueDate, item.repeat);
      
      const nextOccurrence = {
        ...item,
        id: uniqueId(),
        done: false,
        dueDate: nextDueDate,
        createdAt: Date.now(),
        pinned: false,
      };
      
      // Clear recurrence from the completed instance to prevent duplicate triggers
      item.repeat = "none";
      
      state.items.unshift(nextOccurrence);
    }

    persist();
    render();
  }
}

function updateItemText(id, newText) {
  const item = state.items.find((i) => i.id === id);
  const trimmed = newText.trim();
  if (item && trimmed && item.text !== trimmed) {
    const oldText = item.text;
    item.text = trimmed;
    logActivity(`Edited item text`, `"${oldText.slice(0, 20)}..." -> "${trimmed.slice(0, 20)}..."`);
    persist();
  }
  render();
}

function togglePin(id) {
  const item = state.items.find((i) => i.id === id);
  if (item && item.type === "note") {
    item.pinned = !item.pinned;
    logActivity(`${item.pinned ? "Pinned" : "Unpinned"} note '${item.text}'`, item.pinned ? "Shown on dashboard" : "Removed from dashboard");
    persist();
    render();
  }
}

function deleteItem(id) {
  // Move to trash instead of permanent delete
  const item = state.items.find((i) => i.id === id);
  if (item) {
    state.trash.unshift({ ...item, deletedAt: Date.now() });
    state.items = state.items.filter((i) => i.id !== id);
    logActivity(`Deleted item '${item.text}'`, "Moved to Trash");
    persist();
    render();
    showToast("Moved to Trash 🗑️");
  }
}

function restoreItem(id) {
  const item = state.trash.find((i) => i.id === id);
  if (item) {
    // Remove deletedAt timestamp before restoring
    const { deletedAt, ...restored } = item;
    state.items.unshift(restored);
    state.trash = state.trash.filter((i) => i.id !== id);
    logActivity(`Restored item '${item.text}'`, "Moved back from Trash");
    persist();
    render();
    showToast("Restored! ✅");
  }
}

function permanentDelete(id) {
  const item = state.trash.find((i) => i.id === id);
  const title = item ? item.text : "item";
  state.trash = state.trash.filter((i) => i.id !== id);
  logActivity(`Permanently deleted item`, `"${title.slice(0, 20)}..."`);
  persist();
  render();
}

function emptyTrash() {
  const count = state.trash.length;
  state.trash = [];
  logActivity("Emptied Trash", `Permanently deleted ${count} items`);
  persist();
  render();
}

function clearDone() {
  const before = state.items.length;
  // Move completed tasks to trash instead of direct deletion
  const completedItems = state.items.filter((i) => i.type === "task" && i.done);
  completedItems.forEach((item) => {
    state.trash.unshift({ ...item, deletedAt: Date.now() });
  });
  state.items = state.items.filter((i) => !(i.type === "task" && i.done));
  if (state.items.length !== before) {
    logActivity("Cleared completed tasks", "Moved completed tasks to Trash");
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
  // Trash tab shows trash array, not items array
  if (state.activeTab === "trash") {
    const q = state.search.trim().toLowerCase();
    return state.trash.filter((item) => {
      if (q) {
        const hay = (item.text + " " + (item.tag || "")).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

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

function renderItem(item, isTrash = false) {
  const li = document.createElement("li");
  li.className = "item" + (item.done ? " done" : "") + (isTrash ? " trashed" : "");
  
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

  // 4. Repeat Badge
  if (item.type === "task" && item.repeat && item.repeat !== "none" && !isEditing) {
    const repeatLabels = {
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      yearly: "Yearly",
    };
    const repeatBadge = document.createElement("span");
    repeatBadge.className = "repeat-badge" + (item.done ? " done" : "");
    repeatBadge.innerHTML = `<svg class="repeat-icon" xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg> ${repeatLabels[item.repeat] || item.repeat}`;
    metaContainer.appendChild(repeatBadge);
  }

  if (metaContainer.children.length > 0) {
    body.appendChild(metaContainer);
  }

  // Append image attachment inside the card if present
  if (item.image && !isEditing) {
    const imgWrap = document.createElement("div");
    imgWrap.className = "item-image-wrap";
    
    const img = document.createElement("img");
    img.className = "item-img";
    img.src = item.image;
    img.alt = "Attachment";
    img.loading = "lazy";
    img.addEventListener("click", () => openLightbox(item.image));
    
    imgWrap.appendChild(img);
    body.appendChild(imgWrap);
  }

  li.appendChild(body);

  // Actions Container (Edit + Delete)
  const actions = document.createElement("div");
  actions.className = "item-actions";

  // Actions: show different buttons based on trash mode
  if (isTrash) {
    // RESTORE button
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "item-action-btn restore-btn";
    restoreBtn.title = "Restore item";
    restoreBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 .49-3.87"></path></svg>`;
    restoreBtn.addEventListener("click", () => restoreItem(item.id));
    actions.appendChild(restoreBtn);

    // PERMANENT DELETE button
    const permDel = document.createElement("button");
    permDel.type = "button";
    permDel.className = "item-action-btn delete-btn";
    permDel.title = "Delete permanently";
    permDel.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>`;
    permDel.addEventListener("click", async () => {
      const ok = await showCustomConfirm("Delete Forever?", `"${item.text.slice(0, 50)}" will be permanently deleted. This cannot be undone.`);
      if (ok) permanentDelete(item.id);
    });
    actions.appendChild(permDel);
  } else {
    // EDIT button (normal mode)
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
      // PIN button (only for notes)
      if (item.type === "note") {
        const pinBtn = document.createElement("button");
        pinBtn.type = "button";
        pinBtn.className = "item-action-btn pin-btn" + (item.pinned ? " pinned" : "");
        pinBtn.title = item.pinned ? "Unpin note" : "Pin note";
        pinBtn.innerHTML = item.pinned
          ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2L2 12h5l9 9v-5l5-5V2z"></path></svg>`
          : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="8" x2="22" y2="12"></line><line x1="12" y1="2" x2="22" y2="12"></line><path d="M12 2L2 12h5l9 9v-5l5-5V2z"></path></svg>`;
        pinBtn.addEventListener("click", () => togglePin(item.id));
        actions.appendChild(pinBtn);
      }

      // COPY button
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

      // WHATSAPP button
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

      // DELETE (move to trash) button
      const del = document.createElement("button");
      del.type = "button";
      del.className = "item-action-btn delete-btn";
      del.title = "Move to Trash";
      del.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>`;
      del.addEventListener("click", () => deleteItem(item.id));
      actions.appendChild(del);
    }
  }

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

function getGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return "Good Morning";
  if (hr < 17) return "Good Afternoon";
  return "Good Evening";
}

function updateGreetingText() {
  const greeting = getGreeting();
  greetingText.textContent = `${greeting}, User`;
  
  const activeTasks = state.items.filter((i) => i.type === "task" && !i.done).length;
  const pinnedNotes = state.items.filter((i) => i.type === "note" && i.pinned).length;
  
  if (state.ready) {
    greetingSubText.textContent = `Syncing complete. You have ${activeTasks} active task${activeTasks === 1 ? "" : "s"} and ${pinnedNotes} pinned note${pinnedNotes === 1 ? "" : "s"}.`;
  } else {
    greetingSubText.textContent = "Connecting to room...";
  }
}

function syncActiveTabHighlight(tab) {
  document.querySelectorAll(".tab-link").forEach((btn) => {
    if (btn.getAttribute("data-tab") === tab) {
      btn.classList.add("active");
      updateTabsSliderPosition(btn);
    } else {
      btn.classList.remove("active");
    }
  });
}

function renderDashboard() {
  // 1. Upcoming Tasks
  upcomingTasksList.innerHTML = "";
  const upcomingTasks = state.items.filter((item) => {
    if (item.type !== "task" || item.done) return false;
    if (!item.dueDate) return false;
    const dueInfo = getDueDateInfo(item.dueDate);
    return dueInfo && (dueInfo.class === "today" || dueInfo.class === "tomorrow" || dueInfo.class === "overdue");
  });
  
  upcomingTasks.sort((a, b) => {
    const aInfo = getDueDateInfo(a.dueDate);
    const bInfo = getDueDateInfo(b.dueDate);
    const order = { overdue: 1, today: 2, tomorrow: 3 };
    const aVal = order[aInfo?.class] || 4;
    const bVal = order[bInfo?.class] || 4;
    return aVal - bVal;
  });
  
  const displayTasks = upcomingTasks.slice(0, 4);
  const todayCount = upcomingTasks.filter(t => {
    const info = getDueDateInfo(t.dueDate);
    return info && (info.class === "today" || info.class === "overdue");
  }).length;
  
  upcomingTasksBadge.textContent = `${todayCount} Today`;
  
  if (displayTasks.length === 0) {
    upcomingTasksList.innerHTML = `<li class="empty-list-placeholder" style="padding: 12px; color: var(--text-secondary); text-align: center;">No upcoming tasks! 🎉</li>`;
  } else {
    displayTasks.forEach((task) => {
      const li = document.createElement("li");
      li.className = `dashboard-task-item priority-${task.priority || "medium"}`;
      
      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className = "task-check-btn";
      checkBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      checkBtn.addEventListener("click", () => toggleDone(task.id));
      
      const textSpan = document.createElement("span");
      textSpan.className = "task-text";
      textSpan.textContent = task.text;
      
      const dueSpan = document.createElement("span");
      const info = getDueDateInfo(task.dueDate);
      dueSpan.className = `task-due ${info.class}`;
      dueSpan.textContent = info.text;
      
      li.appendChild(checkBtn);
      li.appendChild(textSpan);
      li.appendChild(dueSpan);
      upcomingTasksList.appendChild(li);
    });
  }
  
  // 2. Pinned Notes
  pinnedNotesList.innerHTML = "";
  const pinnedNotes = state.items.filter((item) => item.type === "note" && item.pinned);
  
  if (pinnedNotes.length === 0) {
    pinnedNotesList.innerHTML = `<div class="empty-list-placeholder" style="padding: 12px; color: var(--text-secondary); text-align: center;">No pinned notes. Pin important notes in Notes tab to display them here!</div>`;
  } else {
    pinnedNotes.forEach((note) => {
      const card = document.createElement("div");
      card.className = "dashboard-note-card";
      
      const header = document.createElement("div");
      header.className = "dashboard-note-header";
      
      const title = document.createElement("div");
      title.className = "dashboard-note-title";
      const lines = note.text.split("\n");
      title.textContent = lines[0].slice(0, 30) + (lines[0].length > 30 ? "..." : "");
      
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "pin-toggle-btn pinned";
      pinBtn.title = "Unpin note";
      pinBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2L2 12h5l9 9v-5l5-5V2z"></path></svg>`;
      pinBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePin(note.id);
      });
      
      header.appendChild(title);
      header.appendChild(pinBtn);
      card.appendChild(header);
      
      if (lines.length > 1 || lines[0].length > 30) {
        const snippet = document.createElement("p");
        snippet.className = "dashboard-note-snippet";
        snippet.textContent = note.text;
        card.appendChild(snippet);
      }
      
      card.addEventListener("click", () => {
        state.activeTab = "notes";
        syncActiveTabHighlight("notes");
        state.editingId = note.id;
        render();
      });
      
      pinnedNotesList.appendChild(card);
    });
  }
  
  // 3. Recent Activity
  activityList.innerHTML = "";
  if (state.activities.length === 0) {
    activityList.innerHTML = `<li class="empty-list-placeholder" style="padding: 12px; color: var(--text-secondary); text-align: center;">No recent activity logs.</li>`;
  } else {
    state.activities.forEach((act) => {
      const li = document.createElement("li");
      li.className = "activity-item";
      
      const iconDiv = document.createElement("div");
      iconDiv.className = "activity-icon";
      let icon = "🔄";
      if (act.text.includes("Created task")) icon = "➕";
      else if (act.text.includes("Created note")) icon = "📝";
      else if (act.text.includes("Completed")) icon = "✔️";
      else if (act.text.includes("Reopened")) icon = "↩️";
      else if (act.text.includes("Deleted")) icon = "🗑️";
      else if (act.text.includes("Restored")) icon = "✅";
      else if (act.text.includes("Pinned")) icon = "📌";
      else if (act.text.includes("Unpinned")) icon = "📌";
      else if (act.text.includes("Edited")) icon = "✏️";
      iconDiv.textContent = icon;
      
      const detailsDiv = document.createElement("div");
      detailsDiv.className = "activity-details";
      
      const textDiv = document.createElement("div");
      textDiv.className = "activity-text";
      textDiv.textContent = act.text;
      
      const subtextDiv = document.createElement("div");
      subtextDiv.className = "activity-subtext";
      
      const elapsed = Date.now() - act.time;
      let timeStr = "just now";
      if (elapsed > 60000) {
        const mins = Math.floor(elapsed / 60000);
        if (mins < 60) {
          timeStr = `${mins} min${mins === 1 ? "" : "s"} ago`;
        } else {
          const hrs = Math.floor(mins / 60);
          if (hrs < 24) {
            timeStr = `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
          } else {
            timeStr = new Date(act.time).toLocaleDateString();
          }
        }
      }
      
      subtextDiv.textContent = `${act.detail ? act.detail + " • " : ""}${timeStr}`;
      
      detailsDiv.appendChild(textDiv);
      detailsDiv.appendChild(subtextDiv);
      li.appendChild(iconDiv);
      li.appendChild(detailsDiv);
      activityList.appendChild(li);
    });
  }
}

function render() {
  // Sync tab buttons highlight (both desktop sidebar and mobile nav bar)
  syncActiveTabHighlight(state.activeTab);

  // Update trash count badge
  const trashCountEl = document.getElementById("trashCount");
  if (trashCountEl) {
    trashCountEl.textContent = state.trash.length > 0 ? state.trash.length : "";
  }

  // Dashboard Tab vs Filter Tab lists
  if (state.activeTab === "dashboard") {
    dashboardView.style.display = "block";
    listViewPanel.style.display = "none";
    updateGreetingText();
    renderDashboard();
  } else {
    dashboardView.style.display = "none";
    listViewPanel.style.display = "block";
    
    // Hide/show tag filters for trash tab
    tagFiltersEl.style.display = state.activeTab === "trash" ? "none" : "";
    renderTagFilters();

    const visible = visibleItems();
    itemListEl.innerHTML = "";
    if (visible.length === 0) {
      itemListEl.style.display = "none";
      emptyStateEl.style.display = "flex";
      if (state.activeTab === "trash") {
        emptyStateEl.querySelector("p").textContent = "Trash is empty. Deleted items will appear here. 🗑️";
      } else {
        emptyStateEl.querySelector("p").textContent =
          state.items.length === 0
            ? "Nothing here yet. Add your first task or note! 👆"
            : "No items match your filters. 🔍";
      }
    } else {
      itemListEl.style.display = "";
      emptyStateEl.style.display = "none";
      const frag = document.createDocumentFragment();
      visible.forEach((item) => frag.appendChild(renderItem(item, state.activeTab === "trash")));
      itemListEl.appendChild(frag);
    }

    renderCounter();
    
    clearDoneBtn.style.display = state.items.some(
      (i) => i.type === "task" && i.done
    ) && state.activeTab !== "trash"
      ? "inline-block"
      : "none";

    // Show/hide empty trash button
    const emptyTrashBtn = document.getElementById("emptyTrashBtn");
    if (emptyTrashBtn) {
      emptyTrashBtn.style.display = state.activeTab === "trash" && state.trash.length > 0 ? "inline-block" : "none";
    }
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
    state.activeTab = tabBtn.getAttribute("data-tab");
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
  addItem(textInput.value, tagSelect.value, getSelectedType(), repeatSelect.value);
  textInput.value = "";
  tagSelect.value = "";
  dueDateInput.value = "";
  prioritySelect.value = "medium";
  repeatSelect.value = "none";
  if (quickAddModal) {
    quickAddModal.style.display = "none";
  }
});

// Quick Add modal toggle event listeners
if (quickAddBtn) {
  quickAddBtn.addEventListener("click", () => {
    quickAddModal.style.display = "flex";
    textInput.focus();
  });
}
if (mobileQuickAddBtn) {
  mobileQuickAddBtn.addEventListener("click", () => {
    quickAddModal.style.display = "flex";
    textInput.focus();
  });
}
if (closeQuickAdd) {
  closeQuickAdd.addEventListener("click", () => {
    quickAddModal.style.display = "none";
  });
}
if (quickAddModal) {
  quickAddModal.addEventListener("click", (e) => {
    if (e.target.id === "quickAddModal") {
      quickAddModal.style.display = "none";
    }
  });
}

// Dashboard link redirects
if (viewAllTasksLink) {
  viewAllTasksLink.addEventListener("click", (e) => {
    e.preventDefault();
    state.activeTab = "tasks";
    render();
  });
}

if (clearHistoryLink) {
  clearHistoryLink.addEventListener("click", async (e) => {
    e.preventDefault();
    const ok = await showCustomConfirm("Clear Activity Logs?", "Are you sure you want to clear your recent activities history? This updates across all devices.");
    if (ok) {
      state.activities = [];
      persist();
      render();
    }
  });
}

if (document.getElementById("sidebarHelpBtn")) {
  document.getElementById("sidebarHelpBtn").addEventListener("click", () => {
    showCustomAlert(
      "SecondBrain Tips 🧠",
      "• Notes: Can be pinned to Dashboard using the pushpin icon.\n• Tasks: Check complete to automatically advance recurring tasks.\n• Sync: Join the same room code on other devices to sync in real time!"
    );
  });
}

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  render();
});

clearDoneBtn.addEventListener("click", async () => {
  const hasDone = state.items.some((i) => i.type === "task" && i.done);
  if (!hasDone) return;
  const ok = await showCustomConfirm("Move to Trash?", "All completed tasks will be moved to Trash. You can restore them later.");
  if (ok) clearDone();
});

document.getElementById("emptyTrashBtn").addEventListener("click", async () => {
  if (state.trash.length === 0) return;
  const ok = await showCustomConfirm("Empty Trash?", `Permanently delete all ${state.trash.length} item(s) in the trash? This cannot be undone.`);
  if (ok) emptyTrash();
});

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
      const welcomeThemeToggle = document.getElementById("themeToggleWelcome");
      if (welcomeThemeToggle) welcomeThemeToggle.style.display = "flex";
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

/* ---------- Image Upload Event Listeners ---------- */

attachBtn.addEventListener("click", () => {
  imageInput.click();
});

imageInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    attachBtn.classList.add("loading");
    const base64 = await compressImage(file);
    currentBase64Image = base64;
    previewImg.src = base64;
    formImagePreview.style.display = "block";
  } catch (err) {
    console.error("Image compression failed:", err);
    showCustomAlert("Error Loading Image", "Could not load or compress the selected image file.");
  } finally {
    attachBtn.classList.remove("loading");
  }
});

removePreviewBtn.addEventListener("click", () => {
  currentBase64Image = null;
  imageInput.value = "";
  formImagePreview.style.display = "none";
  previewImg.src = "";
});

/* ---------- Lightbox Modal Methods ---------- */

function openLightbox(src) {
  const lightbox = document.getElementById("imageLightbox");
  const img = document.getElementById("lightboxImg");
  img.src = src;
  lightbox.style.display = "flex";
}

document.getElementById("closeLightbox").addEventListener("click", () => {
  document.getElementById("imageLightbox").style.display = "none";
});

// Close lightbox when clicking outside the image
document.getElementById("imageLightbox").addEventListener("click", (e) => {
  if (e.target.id === "imageLightbox") {
    document.getElementById("imageLightbox").style.display = "none";
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
