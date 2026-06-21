/* ===== Remember — Tasks & Notes =====
 * State is stored in localStorage under "rememberApp".
 * No frameworks, no dependencies. Plain vanilla JS.
 */

(function () {
  "use strict";

  var STORAGE_KEY = "rememberApp";
  var state = {
    items: [], // { id, type, text, tag, done, createdAt }
    search: "", // current search text
    activeTag: "", // "" means "All"
  };

  /* ---------- Persistence ---------- */

  function loadItems() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      return Array.isArray(data.items) ? data.items : [];
    } catch (e) {
      console.warn("Could not load saved items:", e);
      return [];
    }
  }

  function saveItems() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }));
    } catch (e) {
      console.warn("Could not save items:", e);
    }
  }

  /* ---------- DOM references ---------- */

  var form = document.getElementById("addForm");
  var textInput = document.getElementById("textInput");
  var tagSelect = document.getElementById("tagSelect");
  var typeSelect = document.getElementById("typeSelect");
  var searchInput = document.getElementById("searchInput");
  var tagFiltersEl = document.getElementById("tagFilters");
  var itemListEl = document.getElementById("itemList");
  var emptyStateEl = document.getElementById("emptyState");
  var counterEl = document.getElementById("counter");
  var clearDoneBtn = document.getElementById("clearDone");

  /* ---------- Utilities ---------- */

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function uniqueId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- Core actions ---------- */

  function addItem(text, tag, type) {
    var trimmed = text.trim();
    if (!trimmed) return;
    var item = {
      id: uniqueId(),
      type: type === "note" ? "note" : "task",
      text: trimmed,
      tag: (tag || "").trim(),
      done: false,
      createdAt: Date.now(),
    };
    state.items.unshift(item); // newest first
    saveItems();
    render();
  }

  function toggleDone(id) {
    var item = state.items.find(function (i) {
      return i.id === id;
    });
    if (item) {
      item.done = !item.done;
      saveItems();
      render();
    }
  }

  function deleteItem(id) {
    state.items = state.items.filter(function (i) {
      return i.id !== id;
    });
    saveItems();
    render();
  }

  function clearDone() {
    var before = state.items.length;
    state.items = state.items.filter(function (i) {
      return !(i.type === "task" && i.done);
    });
    if (state.items.length !== before) {
      saveItems();
      render();
    }
  }

  /* ---------- Sorting & filtering ---------- */

  function sortedItems() {
    // Tasks first, then notes. Within each: not-done first, then done; newest first.
    var items = state.items.slice();
    items.sort(function (a, b) {
      if (a.type !== b.type) return a.type === "task" ? -1 : 1;
      var aDone = a.type === "task" && a.done ? 1 : 0;
      var bDone = b.type === "task" && b.done ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      return b.createdAt - a.createdAt;
    });
    return items;
  }

  function visibleItems() {
    var q = state.search.trim().toLowerCase();
    return sortedItems().filter(function (item) {
      // tag filter
      if (state.activeTag && item.tag !== state.activeTag) return false;
      // search filter
      if (q) {
        var hay = (item.text + " " + item.tag).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function allTags() {
    var seen = {};
    var tags = [];
    state.items.forEach(function (item) {
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
    var tags = allTags();
    tagFiltersEl.innerHTML = "";

    function makeChip(label, tag) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + (state.activeTag === tag ? " active" : "");
      chip.textContent = label;
      chip.addEventListener("click", function () {
        state.activeTag = state.activeTag === tag ? "" : tag;
        render();
      });
      tagFiltersEl.appendChild(chip);
    }

    makeChip("All", "");
    tags.forEach(function (tag) {
      makeChip("#" + tag, tag);
    });

    // Update datalist suggestions so all used tags (incl. custom) appear.
    var datalist = document.getElementById("tagList");
    if (datalist) {
      datalist.innerHTML = "";
      tags.forEach(function (tag) {
        var opt = document.createElement("option");
        opt.value = tag;
        datalist.appendChild(opt);
      });
    }
  }

  function renderItem(item) {
    var li = document.createElement("li");
    li.className = "item" + (item.done ? " done" : "");

    if (item.type === "task") {
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "item-checkbox";
      checkbox.checked = item.done;
      checkbox.addEventListener("change", function () {
        toggleDone(item.id);
      });
      li.appendChild(checkbox);
    } else {
      var icon = document.createElement("span");
      icon.className = "item-icon";
      icon.textContent = "📄";
      li.appendChild(icon);
    }

    var body = document.createElement("div");
    body.className = "item-body";

    var text = document.createElement("div");
    text.className = "item-text";
    text.textContent = item.text;
    body.appendChild(text);

    if (item.tag) {
      var tagEl = document.createElement("span");
      tagEl.className = "item-tag";
      tagEl.textContent = "#" + item.tag;
      body.appendChild(tagEl);
    }

    li.appendChild(body);

    var del = document.createElement("button");
    del.type = "button";
    del.className = "item-delete";
    del.title = "Delete";
    del.textContent = "×";
    del.addEventListener("click", function () {
      deleteItem(item.id);
    });
    li.appendChild(del);

    return li;
  }

  function renderCounter() {
    var total = state.items.length;
    var tasks = state.items.filter(function (i) {
      return i.type === "task";
    }).length;
    var doneTasks = state.items.filter(function (i) {
      return i.type === "task" && i.done;
    }).length;
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
    // tag filters
    renderTagFilters();

    // list
    var visible = visibleItems();
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
      var frag = document.createDocumentFragment();
      visible.forEach(function (item) {
        frag.appendChild(renderItem(item));
      });
      itemListEl.appendChild(frag);
    }

    // footer
    renderCounter();
    clearDoneBtn.style.display =
      state.items.some(function (i) {
        return i.type === "task" && i.done;
      }) ? "" : "none";
  }

  /* ---------- Event handlers ---------- */

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    addItem(textInput.value, tagSelect.value, typeSelect.value);
    textInput.value = "";
    tagSelect.value = "";
    typeSelect.value = "task";
    textInput.focus();
  });

  searchInput.addEventListener("input", function () {
    state.search = searchInput.value;
    render();
  });

  clearDoneBtn.addEventListener("click", clearDone);

  /* ---------- Init ---------- */

  state.items = loadItems();
  render();
})();
