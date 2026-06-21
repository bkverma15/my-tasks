/* ===== Remember — Tasks & Notes (Cloud Sync via Firestore) =====
 *
 * Architecture:
 *  - One Firestore document per room: rooms/{roomCode}
 *    { items: [...], updatedAt: <timestamp> }
 *  - We listen to that doc in realtime (onSnapshot). Any device that
 *    edits the doc triggers a sync to all other devices in the same room.
 *  - Room code is saved in localStorage so reopening keeps you in the room.
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

/* ---------- State ---------- */

const ROOM_KEY = "rememberApp.room";
let state = {
  room: "", // current room code
  items: [], // { id, type, text, tag, done, createdAt }
  search: "", // current search text
  activeTag: "", // "" = All
  unsub: null, // unsubscribe from onSnapshot
  ready: false, // got first snapshot?
};

/* ---------- DOM ---------- */

const welcomeScreen = document.getElementById("welcomeScreen");
const appEl = document.getElementById("app");
const roomForm = document.getElementById("roomForm");
const roomInput = document.getElementById("roomInput");

const form = document.getElementById("addForm");
const textInput = document.getElementById("textInput");
const tagSelect = document.getElementById("tagSelect");
const typeSelect = document.getElementById("typeSelect");
const searchInput = document.getElementById("searchInput");
const tagFiltersEl = document.getElementById("tagFilters");
const itemListEl = document.getElementById("itemList");
const emptyStateEl = document.getElementById("emptyState");
const counterEl = document.getElementById("counter");
const clearDoneBtn = document.getElementById("clearDone");

const syncDot = document.getElementById("syncDot");
const syncText = document.getElementById("syncText");
const syncBtn = document.getElementById("syncBtn");

/* ---------- Utilities ---------- */

function uniqueId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function setSyncStatus(status) {
  // status: "connecting" | "saving" | "saved" | "error"
  syncDot.className = "sync-dot " + status;
  const labels = {
    connecting: "connecting…",
    saving: "saving…",
    saved: "all synced",
    error: "sync error",
  };
  syncText.textContent = labels[status] || status;
  syncBtn.title =
    status === "saved"
      ? "Your data is saved in the cloud and synced across devices."
      : labels[status];
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
  const code = roomCode.trim();
  if (!code) return;
  // leave previous room if any
  if (state.unsub) {
    state.unsub();
    state.unsub = null;
  }
  state.room = code;
  state.ready = false;
  try {
    localStorage.setItem(ROOM_KEY, code);
  } catch {}
  // show app
  welcomeScreen.style.display = "none";
  appEl.style.display = "";
  setSyncStatus("connecting");

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
    (err) => {
      console.error("Sync error:", err);
      setSyncStatus("error");
      alert("SYNC ERROR:\n" + (err && err.message ? err.message : err));
    }
  );
}

async function persist() {
  if (!state.room) return;
  setSyncStatus("saving");
  try {
    const ref = doc(db, "rooms", state.room);
    await setDoc(ref, { items: state.items, updatedAt: Date.now() });
    // status will flip to "saved" when our own onSnapshot fires,
    // but set it optimistically in case the snapshot is slow.
    setTimeout(() => {
      if (syncDot.className.indexOf("saving") !== -1) setSyncStatus("saved");
    }, 1500);
  } catch (err) {
    console.error("Save failed:", err);
    setSyncStatus("error");
    alert("Could not save. Check your internet connection and try again.");
  }
}

/* ---------- Core actions ---------- */

function addItem(text, tag, type) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const item = {
    id: uniqueId(),
    type: type === "note" ? "note" : "task",
    text: trimmed,
    tag: (tag || "").trim(),
    done: false,
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
    if (a.type !== b.type) return a.type === "task" ? -1 : 1;
    const aDone = a.type === "task" && a.done ? 1 : 0;
    const bDone = b.type === "task" && b.done ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return b.createdAt - a.createdAt;
  });
  return items;
}

function visibleItems() {
  const q = state.search.trim().toLowerCase();
  return sortedItems().filter((item) => {
    if (state.activeTag && item.tag !== state.activeTag) return false;
    if (q) {
      const hay = (item.text + " " + item.tag).toLowerCase();
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
    chip.addEventListener("click", () => {
      state.activeTag = state.activeTag === tag ? "" : tag;
      render();
    });
    tagFiltersEl.appendChild(chip);
  }

  makeChip("All", "");
  tags.forEach((tag) => makeChip("#" + tag, tag));

  // keep datalist in sync with custom tags
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
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "item-checkbox";
    checkbox.checked = item.done;
    checkbox.addEventListener("change", () => toggleDone(item.id));
    li.appendChild(checkbox);
  } else {
    const icon = document.createElement("span");
    icon.className = "item-icon";
    icon.textContent = "📄";
    li.appendChild(icon);
  }

  const body = document.createElement("div");
  body.className = "item-body";

  const text = document.createElement("div");
  text.className = "item-text";
  text.textContent = item.text;
  body.appendChild(text);

  if (item.tag) {
    const tagEl = document.createElement("span");
    tagEl.className = "item-tag";
    tagEl.textContent = "#" + item.tag;
    body.appendChild(tagEl);
  }

  li.appendChild(body);

  const del = document.createElement("button");
  del.type = "button";
  del.className = "item-delete";
  del.title = "Delete";
  del.textContent = "×";
  del.addEventListener("click", () => deleteItem(item.id));
  li.appendChild(del);

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
    emptyStateEl.style.display = "block";
    emptyStateEl.textContent =
      state.items.length === 0
        ? "Nothing here yet. Add your first task or note above! 👆"
        : "No items match your search. 🔍";
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
    ? ""
    : "none";
}

/* ---------- Event handlers ---------- */

roomForm.addEventListener("submit", (e) => {
  e.preventDefault();
  joinRoom(roomInput.value);
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  addItem(textInput.value, tagSelect.value, typeSelect.value);
  textInput.value = "";
  tagSelect.value = "";
  typeSelect.value = "task";
  textInput.focus();
});

searchInput.addEventListener("input", () => {
  state.search = searchInput.value;
  render();
});

clearDoneBtn.addEventListener("click", clearDone);

// long-press / click sync button to leave room (change room)
let syncClicks = 0;
let syncClickTimer = null;
syncBtn.addEventListener("click", () => {
  syncClicks++;
  clearTimeout(syncClickTimer);
  syncClickTimer = setTimeout(() => (syncClicks = 0), 600);
  if (syncClicks >= 3) {
    syncClicks = 0;
    if (confirm("Leave this room and join a different one?")) {
      if (state.unsub) state.unsub();
      state.unsub = null;
      state.room = "";
      state.items = [];
      try {
        localStorage.removeItem(ROOM_KEY);
      } catch {}
      appEl.style.display = "none";
      welcomeScreen.style.display = "flex";
      roomInput.value = "";
      roomInput.focus();
    }
  }
});

/* ---------- Init ---------- */

const savedRoom = loadSavedRoom();
if (savedRoom) {
  joinRoom(savedRoom);
} else {
  roomInput.focus();
}
