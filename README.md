# 📝 Remember — Tasks & Notes (Cloud Sync)

A simple, mobile-friendly web app to remember **tasks and notes**, with instant **search**, **custom tags**, and **cloud sync** across all your devices.

![status](https://img.shields.io/badge/status-ready-brightgreen)
![sync](https://img.shields.io/badge/cloud-Firestore-orange)

## ✨ Features
- ✅ **Tasks** with checkboxes (mark as done)
- 📄 **Notes** for free-text reminders
- 🔍 **Instant search** — type any word, list filters live
- 🏷️ **Custom tags** — type your own (e.g. `work`, `urgent`, `shopping`) or pick from suggestions
- ☁️ **Cloud sync** — data stored in Firestore; same data on phone, computer, anywhere
- 🔄 **Realtime** — changes appear instantly on all open devices
- 📱 **Mobile-friendly** — works great on phone and desktop

## 🚀 How to use
1. Open the live site (GitHub Pages link below).
2. Enter a **room code** (any word you like). Use the **same code on all your devices** to keep them in sync.
3. Type a task/note, pick or type a tag, choose Task/Note, click **Add**.
4. Use the search box to find items instantly.
5. Click tag chips to filter by category.
6. Tap the sync indicator **3 times** to switch rooms.

## 🌐 Live demo
```
https://bkverma15.github.io/my-tasks/
```

## 🛠️ Tech
Plain **HTML + CSS + vanilla JavaScript (ES modules)**. Cloud backend: **Firebase Firestore**. No frameworks, no build step.

## 🔐 Privacy
- Your data lives in a Firestore document named by your room code.
- Anyone who knows (or guesses) your room code can read/write that room.
- **Pick a room code that's hard to guess** (mix letters, numbers, hyphens).
- For truly private data, restrict Firestore security rules (advanced).

## 📂 Files
- `index.html` — welcome/room screen + main app structure
- `styles.css` — responsive styling
- `app.js` — app logic (Firestore sync, search, tags, realtime)

