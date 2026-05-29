const STORAGE_KEY = "juno-state-v2";
const SHARED_STATE_URL = location.protocol.startsWith("http") ? "/api/state" : "";

const $ = (selector) => document.querySelector(selector);
const makeId = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};
const authView = $("#authView");
const messengerView = $("#messengerView");
const authForm = $("#authForm");
const loginInput = $("#loginInput");
const nameInput = $("#nameInput");
const passwordInput = $("#passwordInput");
const avatarInput = $("#avatarInput");
const authSubmit = $("#authSubmit");
const authNote = $("#authNote");
const nameField = $("#nameField");
const avatarField = $("#avatarField");
const friendSearch = $("#friendSearch");
const searchResults = $("#searchResults");
const chatList = $("#chatList");
const messages = $("#messages");
const messageForm = $("#messageForm");
const messageInput = $("#messageInput");
const photoInput = $("#photoInput");
const voiceButton = $("#voiceButton");
const recordingBar = $("#recordingBar");
const recordingTime = $("#recordingTime");
const cancelVoiceButton = $("#cancelVoiceButton");
const sendVoiceButton = $("#sendVoiceButton");
const profileAvatar = $("#profileAvatar");
const profileName = $("#profileName");
const profileUsername = $("#profileUsername");
const settingsButton = $("#settingsButton");
const chatAvatar = $("#chatAvatar");
const chatName = $("#chatName");
const chatStatus = $("#chatStatus");
const callDialog = $("#callDialog");
const callAvatar = $("#callAvatar");
const localVideo = $("#localVideo");
const callTitle = $("#callTitle");
const callSubtitle = $("#callSubtitle");
const profileDialog = $("#profileDialog");
const profileForm = $("#profileForm");
const editAvatarPreview = $("#editAvatarPreview");
const editNameInput = $("#editNameInput");
const editUsernameInput = $("#editUsernameInput");
const editAvatarInput = $("#editAvatarInput");
const editPasswordInput = $("#editPasswordInput");
const profileNote = $("#profileNote");
const userDialog = $("#userDialog");
const viewAvatar = $("#viewAvatar");
const viewName = $("#viewName");
const viewUsername = $("#viewUsername");
const messageUserButton = $("#messageUserButton");
const photoDialog = $("#photoDialog");
const photoForm = $("#photoForm");
const photoPreview = $("#photoPreview");
const photoCaptionInput = $("#photoCaptionInput");
const settingsDialog = $("#settingsDialog");
const deviceList = $("#deviceList");

let authMode = "login";
let state = loadState();
let currentUser = state.currentUser;
let activeChatId = null;
let viewedUserId = null;
let pendingPhoto = null;
let mediaRecorder = null;
let voiceChunks = [];
let recordStartedAt = 0;
let recordTimer = null;
let callStream = null;
let peerConnection = null;
let activeCallId = null;
let processedIceCandidates = new Set();
let incomingPromptedCallId = null;
let authSubmitting = false;
let applyingSharedState = false;
let pushTimer = null;
let lastViewSignature = "";
let lastTypingSentAt = 0;

applyTheme(state.theme || "light");
document.body.classList.toggle("is-authenticated", !!currentUser && state.users.some((user) => user.id === currentUser));

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("juno-state-v1");
  if (saved) {
    const parsed = JSON.parse(saved);
    parsed.users ||= [];
    parsed.chats ||= [];
    parsed.messages ||= {};
    parsed.presence ||= {};
    parsed.typing ||= {};
    parsed.calls ||= {};
    parsed.theme ||= "light";
    ensureSeedUsers(parsed);
    return parsed;
  }

  const initial = {
    users: [
    ],
    currentUser: null,
    chats: [],
    messages: {},
    presence: {},
    typing: {},
    calls: {},
    theme: "light",
  };
  ensureSeedUsers(initial);
  return initial;
}

function ensureSeedUsers(targetState) {
  [
    ["luna", "Luna Ray", "L"],
    ["mika", "Mika Stone", "M"],
    ["neo", "Neo Vale", "N"],
  ].forEach(([username, name, letter]) => {
    if (!targetState.users.some((user) => user.username === username)) {
      targetState.users.push(createUser(username, name, "", gradientAvatar(letter)));
    }
  });
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (!applyingSharedState) scheduleSharedStatePush();
}

function getSharedState() {
  updatePresence();
  return {
    users: state.users,
    chats: state.chats,
    messages: state.messages,
    presence: state.presence || {},
    typing: state.typing || {},
    calls: state.calls || {},
  };
}

function applySharedState(shared) {
  const sessionUser = currentUser || state.currentUser;
  const localUsers = Array.isArray(state.users) ? state.users : [];
  const localChats = Array.isArray(state.chats) ? state.chats : [];
  const localMessages = state.messages && typeof state.messages === "object" ? state.messages : {};
  const localPresence = state.presence && typeof state.presence === "object" ? state.presence : {};
  const localTyping = state.typing && typeof state.typing === "object" ? state.typing : {};
  const localCalls = state.calls && typeof state.calls === "object" ? state.calls : {};
  const remoteUsers = Array.isArray(shared.users) ? shared.users : [];
  const remoteChats = Array.isArray(shared.chats) ? shared.chats : [];
  const remoteMessages = shared.messages && typeof shared.messages === "object" ? shared.messages : {};
  const remotePresence = shared.presence && typeof shared.presence === "object" ? shared.presence : {};
  const remoteTyping = shared.typing && typeof shared.typing === "object" ? shared.typing : {};
  const remoteCalls = shared.calls && typeof shared.calls === "object" ? shared.calls : {};

  applyingSharedState = true;
  state.users = mergeUsers(localUsers, remoteUsers);
  state.chats = mergeById(localChats, remoteChats);
  state.messages = mergeMessages(localMessages, remoteMessages);
  state.presence = { ...remotePresence };
  if (localPresence[currentUser]) state.presence[currentUser] = localPresence[currentUser];
  state.typing = { ...remoteTyping };
  Object.entries(localTyping).forEach(([chatId, typing]) => {
    if (typing?.userId === currentUser) state.typing[chatId] = typing;
  });
  state.calls = mergeCalls(localCalls, remoteCalls);
  ensureSeedUsers(state);
  state.currentUser = sessionUser;
  currentUser = sessionUser;
  if (currentUser && !state.users.some((user) => user.id === currentUser)) {
    currentUser = null;
    state.currentUser = null;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  applyingSharedState = false;
  scheduleSharedStatePush();
}

function mergeById(localItems, remoteItems) {
  const merged = new Map();
  [...localItems, ...remoteItems].forEach((item) => {
    if (item?.id) merged.set(item.id, { ...(merged.get(item.id) || {}), ...item });
  });
  return [...merged.values()];
}

function mergeUsers(localUsers, remoteUsers) {
  const merged = new Map();
  [...localUsers, ...remoteUsers].forEach((user) => {
    if (!user?.username) return;
    const previous = merged.get(user.username) || {};
    merged.set(user.username, {
      ...previous,
      ...user,
      devices: mergeById(previous.devices || [], user.devices || []),
    });
  });
  return [...merged.values()];
}

function mergeMessages(localMessages, remoteMessages) {
  const result = { ...localMessages };
  Object.entries(remoteMessages).forEach(([chatId, messages]) => {
    result[chatId] = mergeById(result[chatId] || [], Array.isArray(messages) ? messages : [])
      .sort((a, b) => (a.time || 0) - (b.time || 0));
  });
  return result;
}

function mergeCalls(localCalls, remoteCalls) {
  const result = {};
  [...new Set([...Object.keys(localCalls), ...Object.keys(remoteCalls)])].forEach((callId) => {
    const local = localCalls[callId] || {};
    const remote = remoteCalls[callId] || {};
    const freshest = (remote.updatedAt || 0) > (local.updatedAt || 0) ? remote : local;
    result[callId] = {
      ...local,
      ...remote,
      ...freshest,
      candidates: {
        ...(remote.candidates || {}),
        ...(local.candidates || {}),
      },
    };
  });
  return result;
}

function renderCurrentView() {
  if (!currentUser || !state.users.some((user) => user.id === currentUser)) return;
  updatePresence();
  handleIncomingCalls();
  handleCallState().catch(() => {
    callSubtitle.textContent = "Звонок не смог соединиться.";
  });
  updateChatStatus();
  const nextSignature = JSON.stringify({
    users: state.users,
    chats: state.chats,
    messages: state.messages,
    activeChatId,
  });
  if (nextSignature === lastViewSignature) return;
  lastViewSignature = nextSignature;
  renderProfile();
  renderSearch();
  renderChats();
  renderMessages();
}

async function pullSharedState({ render = false } = {}) {
  if (!SHARED_STATE_URL) return false;
  try {
    const response = await fetch(SHARED_STATE_URL, { cache: "no-store" });
    if (!response.ok) return false;
    applySharedState(await response.json());
    if (render) renderCurrentView();
    return true;
  } catch {
    return false;
  }
}

function scheduleSharedStatePush() {
  if (!SHARED_STATE_URL) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushSharedState, 150);
}

async function pushSharedState() {
  if (!SHARED_STATE_URL) return;
  try {
    await fetch(SHARED_STATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(getSharedState()),
    });
  } catch {
    showAuthNote("Сервер синхронизации недоступен. Проверь, что запущен node server.js.");
  }
}

function createUser(username, name, password, avatar) {
  return {
    id: makeId(),
    username: cleanUsername(username),
    name: name || username,
    password,
    avatar: avatar || gradientAvatar(username[0] || "J"),
    bio: "В Juno",
    devices: [],
  };
}

function gradientAvatar(letter) {
  const safe = encodeURIComponent((letter || "J").slice(0, 1).toUpperCase());
  const colors = [
    ["2aabee", "61d394"],
    ["fb7185", "fbbf24"],
    ["38bdf8", "818cf8"],
    ["34d399", "14b8a6"],
  ];
  const pair = colors[(letter.charCodeAt(0) || 0) % colors.length];
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%23${pair[0]}'/%3E%3Cstop offset='1' stop-color='%23${pair[1]}'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='160' height='160' rx='80' fill='url(%23g)'/%3E%3Ctext x='50%25' y='56%25' text-anchor='middle' font-size='76' font-family='Arial' font-weight='700' fill='white'%3E${safe}%3C/text%3E%3C/svg%3E`;
}

function cleanUsername(value) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  const activate = (event) => {
    event.preventDefault();
    setAuthMode(button.dataset.authMode);
  };
  button.addEventListener("click", activate);
  button.addEventListener("pointerdown", activate);
  button.addEventListener("touchstart", activate, { passive: false });
});

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAuthForm();
});

async function submitAuthForm() {
  if (authSubmitting) return;
  authSubmitting = true;
  try {
    await pullSharedState();
    const username = cleanUsername(loginInput.value);
    const password = passwordInput.value;
    const isRegisterMode = !nameField.hidden || authSubmit.textContent.trim() === "Создать аккаунт";

    if (username.length < 3) return showAuthNote("Логин должен быть от 3 символов.");
    if (password.length < 4) return showAuthNote("Пароль должен быть от 4 символов.");

    if (isRegisterMode) {
      if (state.users.some((user) => user.username === username)) return showAuthNote("Такой юз уже занят.");
      const avatar = avatarInput.files[0] ? await fileToDataUrl(avatarInput.files[0]) : gradientAvatar(username[0]);
      const user = createUser(username, nameInput.value.trim() || username, password, avatar);
      state.users.push(user);
      state.currentUser = user.id;
      currentUser = user.id;
      recordCurrentDevice(user);
      saveState();
      enterApp();
      return;
    }

    const user = state.users.find((item) => item.username === username && item.password === password);
    if (!user) return showAuthNote("Не нашёл такой логин и пароль. Зарегистрируйся или проверь ввод.");
    state.currentUser = user.id;
    currentUser = user.id;
    recordCurrentDevice(user);
    saveState();
    enterApp();
  } catch (error) {
    console.error(error);
    showAuthNote("Не получилось войти. Обнови страницу и попробуй ещё раз.");
  } finally {
    authSubmitting = false;
  }
}

window.submitAuthForm = submitAuthForm;

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authMode === authMode);
  });
  const isRegister = authMode === "register";
  nameField.hidden = !isRegister;
  avatarField.hidden = !isRegister;
  authSubmit.textContent = isRegister ? "Создать аккаунт" : "Войти";
  authNote.textContent = isRegister ? "Придумай свой юз, пароль и аватарку." : "Войди в свой отдельный аккаунт.";
  passwordInput.autocomplete = isRegister ? "new-password" : "current-password";
}

window.setAuthMode = setAuthMode;

function showAuthNote(text) {
  authNote.textContent = text;
}

$("#logoutButton").addEventListener("click", () => {
  state.currentUser = null;
  currentUser = null;
  activeChatId = null;
  document.body.classList.remove("is-authenticated");
  saveState();
  authView.hidden = false;
  messengerView.hidden = true;
});

$("#profileButton").addEventListener("click", openEditProfile);
settingsButton.addEventListener("click", openSettings);
$("#chatProfileButton").addEventListener("click", openActiveUserProfile);
$("#chatTitleButton").addEventListener("click", openActiveUserProfile);
$("#chatTitleButton").addEventListener("keydown", (event) => {
  if (event.key === "Enter") openActiveUserProfile();
});

document.querySelectorAll("[data-close-dialog]").forEach((button) => {
  button.addEventListener("click", () => $(`#${button.dataset.closeDialog}`).close());
});

document.querySelectorAll("[data-theme-value]").forEach((button) => {
  button.addEventListener("click", () => {
    state.theme = button.dataset.themeValue;
    applyTheme(state.theme);
    saveState();
    renderSettings();
  });
});

friendSearch.addEventListener("input", () => {
  renderSearch();
  pullSharedState({ render: true });
});

messageInput.addEventListener("input", () => {
  if (!currentUser || !activeChatId) return;
  const now = Date.now();
  if (now - lastTypingSentAt < 700) return;
  lastTypingSentAt = now;
  state.typing ||= {};
  state.typing[activeChatId] = {
    userId: currentUser,
    at: now,
  };
  saveState();
});

messageForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeChatId) return;
  addMessage({ type: "text", body: text });
  clearTyping();
  messageInput.value = "";
});

photoInput.addEventListener("change", async () => {
  if (!photoInput.files[0] || !activeChatId) return;
  pendingPhoto = await fileToDataUrl(photoInput.files[0]);
  photoPreview.src = pendingPhoto;
  photoCaptionInput.value = "";
  photoInput.value = "";
  photoDialog.showModal();
});

photoForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!pendingPhoto) return;
  addMessage({ type: "image", body: pendingPhoto, caption: photoCaptionInput.value.trim() });
  pendingPhoto = null;
  photoDialog.close();
});

$("#cancelPhotoButton").addEventListener("click", () => {
  pendingPhoto = null;
  photoDialog.close();
});

voiceButton.addEventListener("click", startVoiceRecording);
cancelVoiceButton.addEventListener("click", cancelVoiceRecording);
sendVoiceButton.addEventListener("click", finishVoiceRecording);

$("#backButton").addEventListener("click", () => messengerView.classList.remove("chat-open"));
$("#voiceCallButton").addEventListener("click", () => openCall("Голосовой звонок", false));
$("#videoCallButton").addEventListener("click", () => openCall("Видеозвонок", true));
$("#hangButton").addEventListener("click", closeCall);
$("#muteButton").addEventListener("click", (event) => {
  event.currentTarget.classList.toggle("active");
  callStream?.getAudioTracks().forEach((track) => {
    track.enabled = !track.enabled;
  });
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const me = getMe();
  const nextUsername = cleanUsername(editUsernameInput.value);
  if (nextUsername.length < 3) {
    profileNote.textContent = "Юз должен быть от 3 символов.";
    return;
  }
  if (state.users.some((user) => user.id !== me.id && user.username === nextUsername)) {
    profileNote.textContent = "Такой юз уже занят.";
    return;
  }

  me.name = editNameInput.value.trim() || me.name;
  me.username = nextUsername;
  if (editPasswordInput.value.trim()) me.password = editPasswordInput.value;
  if (editAvatarInput.files[0]) me.avatar = await fileToDataUrl(editAvatarInput.files[0]);
  editPasswordInput.value = "";
  saveState();
  renderProfile();
  renderChats();
  renderMessages();
  profileDialog.close();
});

editAvatarInput.addEventListener("change", async () => {
  if (editAvatarInput.files[0]) editAvatarPreview.src = await fileToDataUrl(editAvatarInput.files[0]);
});

messageUserButton.addEventListener("click", () => {
  if (!viewedUserId) return;
  const chat = createChat(viewedUserId);
  userDialog.close();
  renderChats();
  selectChat(chat.id);
});

function enterApp() {
  document.body.classList.add("is-authenticated");
  authView.hidden = true;
  messengerView.hidden = false;
  recordCurrentDevice(getMe());
  ensureWelcomeChat();
  renderProfile();
  renderSearch();
  renderChats();
  if (!activeChatId && state.chats.some((chat) => chat.members.includes(currentUser))) {
    selectChat(state.chats.find((chat) => chat.members.includes(currentUser)).id);
  } else {
    renderMessages();
  }
}

function renderProfile() {
  const me = getMe();
  profileAvatar.src = me.avatar;
  profileName.textContent = me.name;
  profileUsername.textContent = `@${me.username}`;
}

function updatePresence() {
  if (!currentUser) return;
  state.presence ||= {};
  state.presence[currentUser] = {
    at: Date.now(),
    chatId: activeChatId,
  };
}

function clearTyping() {
  if (!activeChatId || !state.typing?.[activeChatId]) return;
  if (state.typing[activeChatId].userId === currentUser) {
    delete state.typing[activeChatId];
    saveState();
  }
}

function updateChatStatus() {
  if (!activeChatId) return;
  const chat = state.chats.find((item) => item.id === activeChatId);
  const other = chat ? getOther(chat) : null;
  if (!other) return;
  chatStatus.textContent = getUserStatus(other.id, activeChatId);
}

function getUserStatus(userId, chatId) {
  const typing = state.typing?.[chatId];
  if (typing?.userId === userId && Date.now() - typing.at < 3500) return "печатает...";

  const presence = state.presence?.[userId];
  if (presence?.at && Date.now() - presence.at < 8000) return "сейчас онлайн";
  if (presence?.at) return `был(а) онлайн ${formatRelativeTime(presence.at)}`;
  return "давно не был(а) онлайн";
}

function formatRelativeTime(time) {
  const seconds = Math.max(1, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return "только что";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Intl.DateTimeFormat("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(time);
}

function applyTheme(theme) {
  document.body.dataset.theme = theme === "dark" ? "dark" : "light";
}

function openSettings() {
  renderSettings();
  settingsDialog.showModal();
}

function renderSettings() {
  document.querySelectorAll("[data-theme-value]").forEach((button) => {
    button.classList.toggle("active", button.dataset.themeValue === (state.theme || "light"));
  });

  const me = getMe();
  const devices = me?.devices?.length ? me.devices : [getCurrentDevice()];
  deviceList.innerHTML = devices.map((device) => `
    <div class="device-item">
      <strong>${escapeHtml(device.name)}</strong>
      <small>${device.current ? "Сейчас активен" : "Был вход"} · ${escapeHtml(device.platform)}</small>
      <small>${escapeHtml(device.lastSeen)}</small>
    </div>
  `).join("");
}

function recordCurrentDevice(user) {
  if (!user) return;
  user.devices ||= [];
  const current = getCurrentDevice();
  user.devices = user.devices.map((device) => ({ ...device, current: false }));
  const existing = user.devices.find((device) => device.id === current.id);
  if (existing) {
    Object.assign(existing, current, { current: true });
  } else {
    user.devices.unshift({ ...current, current: true });
  }
  user.devices = user.devices.slice(0, 5);
  saveState();
}

function getCurrentDevice() {
  let id = localStorage.getItem("juno-device-id");
  if (!id) {
    id = makeId();
    localStorage.setItem("juno-device-id", id);
  }

  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const browser = /Edg/i.test(ua) ? "Edge" : /Chrome/i.test(ua) ? "Chrome" : /Firefox/i.test(ua) ? "Firefox" : /Safari/i.test(ua) ? "Safari" : "Browser";
  const os = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Mac/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "Unknown OS";

  return {
    id,
    name: isMobile ? "Телефон" : "Компьютер",
    platform: `${browser} · ${os}`,
    lastSeen: new Intl.DateTimeFormat("ru", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(Date.now()),
  };
}

function getMe() {
  return state.users.find((user) => user.id === currentUser);
}

function getOther(chat) {
  const otherId = chat.members.find((id) => id !== currentUser);
  return state.users.find((user) => user.id === otherId);
}

function ensureWelcomeChat() {
  const me = getMe();
  const juno = state.users.find((user) => user.username === "luna");
  if (!juno || state.chats.some((chat) => chat.members.includes(me.id) && chat.members.includes(juno.id))) return;
  const chat = createChat(juno.id);
  state.messages[chat.id] = [
    {
      id: makeId(),
      sender: juno.id,
      type: "text",
      body: `Привет, ${me.name}! Найди @mika или @neo, открой профиль, запиши голосовое или отправь фото с подписью.`,
      time: Date.now(),
    },
  ];
  saveState();
}

function createChat(friendId) {
  const existing = state.chats.find((chat) => chat.members.includes(currentUser) && chat.members.includes(friendId));
  if (existing) return existing;

  const chat = {
    id: makeId(),
    members: [currentUser, friendId],
    createdAt: Date.now(),
  };
  state.chats.unshift(chat);
  state.messages[chat.id] = [];
  saveState();
  return chat;
}

function renderSearch() {
  const query = cleanUsername(friendSearch.value);
  const users = state.users
    .filter((user) => user.id !== currentUser)
    .filter((user) => !query || user.username.includes(query) || user.name.toLowerCase().includes(query))
    .slice(0, 5);

  searchResults.innerHTML = "";
  if (!query) return;

  if (!users.length) {
    searchResults.innerHTML = `
      <div class="search-empty">
        <strong>Ничего не нашёл</strong>
        <span>Попробуй @mika или @neo. Аккаунты с другого устройства без сервера пока не видны.</span>
      </div>
    `;
    return;
  }

  users.forEach((user) => {
    const button = document.createElement("button");
    button.className = "search-result";
    button.type = "button";
    button.innerHTML = `
      <img src="${user.avatar}" alt="">
      <span><strong>${escapeHtml(user.name)}</strong><span>@${escapeHtml(user.username)} · открыть профиль</span></span>
    `;
    button.addEventListener("click", () => openUserProfile(user.id));
    searchResults.append(button);
  });
}

function renderChats() {
  const myChats = state.chats.filter((chat) => chat.members.includes(currentUser));
  chatList.innerHTML = "";

  myChats.forEach((chat) => {
    const other = getOther(chat);
    if (!other) return;
    const last = state.messages[chat.id]?.at(-1);
    const button = document.createElement("button");
    button.className = `chat-item ${chat.id === activeChatId ? "active" : ""}`;
    button.type = "button";
    button.innerHTML = `
      <img src="${other.avatar}" alt="">
      <span>
        <strong>${escapeHtml(other.name)}</strong>
        <span>${escapeHtml(previewMessage(last))}</span>
      </span>
    `;
    button.addEventListener("click", () => selectChat(chat.id));
    chatList.append(button);
  });
}

function previewMessage(message) {
  if (!message) return "Начните общение";
  if (message.type === "image") return message.caption ? `Фото: ${message.caption}` : "Фото";
  if (message.type === "voice") return `Голосовое ${message.duration || ""}`;
  return message.body;
}

function selectChat(chatId) {
  clearTyping();
  activeChatId = chatId;
  messengerView.classList.add("chat-open");
  const other = getOther(state.chats.find((chat) => chat.id === chatId));
  chatAvatar.src = other.avatar;
  chatName.textContent = other.name;
  updateChatStatus();
  renderChats();
  renderMessages();
}

function renderMessages() {
  messages.innerHTML = "";
  if (!activeChatId) {
    messages.innerHTML = `<div class="empty-state">Выбери чат или найди друга по юзу.</div>`;
    chatName.textContent = "Выбери чат";
    chatStatus.textContent = "Juno готов";
    chatAvatar.src = gradientAvatar("J");
    return;
  }

  const list = state.messages[activeChatId] || [];
  list.forEach((message) => {
    const bubble = document.createElement("article");
    bubble.className = `message ${message.sender === currentUser ? "mine" : ""}`;
    if (message.type === "image") {
      bubble.innerHTML = `
        <img src="${message.body}" alt="Фото">
        ${message.caption ? `<span class="image-caption">${escapeHtml(message.caption)}</span>` : ""}
        <small>${formatTime(message.time)}</small>
      `;
    } else if (message.type === "voice") {
      bubble.innerHTML = message.url
        ? `<div class="voice-chip"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg><audio src="${message.url}" controls preload="metadata"></audio><span>${escapeHtml(message.duration || "")}</span></div><small>${formatTime(message.time)}</small>`
        : `<div class="voice-chip"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7L8 5Z"/></svg><span class="voice-wave"></span><span>${escapeHtml(message.body || "0:00")}</span></div><small>${formatTime(message.time)}</small>`;
    } else {
      bubble.innerHTML = `${escapeHtml(message.body)}<small>${formatTime(message.time)}</small>`;
    }
    messages.append(bubble);
  });
  messages.scrollTop = messages.scrollHeight;
}

function addMessage(partial) {
  state.messages[activeChatId].push({
    id: makeId(),
    sender: currentUser,
    time: Date.now(),
    ...partial,
  });
  saveState();
  renderChats();
  renderMessages();
}

async function startVoiceRecording() {
  if (!activeChatId || mediaRecorder) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    alert("Запись голоса поддерживается только в современных браузерах на localhost или HTTPS.");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) voiceChunks.push(event.data);
    });
    mediaRecorder.start();
    recordStartedAt = Date.now();
    recordingBar.hidden = false;
    voiceButton.disabled = true;
    updateRecordTime();
    recordTimer = setInterval(updateRecordTime, 250);
  } catch {
    alert("Не получилось получить доступ к микрофону. Проверь разрешение браузера.");
  }
}

function updateRecordTime() {
  recordingTime.textContent = formatDuration((Date.now() - recordStartedAt) / 1000);
}

function cancelVoiceRecording() {
  stopRecordingTracks();
  mediaRecorder = null;
  voiceChunks = [];
  recordingBar.hidden = true;
  voiceButton.disabled = false;
  clearInterval(recordTimer);
}

function finishVoiceRecording() {
  if (!mediaRecorder) return;
  const recorder = mediaRecorder;
  recorder.addEventListener("stop", () => {
    const blob = new Blob(voiceChunks, { type: recorder.mimeType || "audio/webm" });
    const duration = formatDuration((Date.now() - recordStartedAt) / 1000);
    const reader = new FileReader();
    reader.onload = () => {
      addMessage({ type: "voice", url: reader.result, duration });
      cancelVoiceRecording();
    };
    reader.readAsDataURL(blob);
  }, { once: true });
  recorder.stop();
}

function stopRecordingTracks() {
  mediaRecorder?.stream?.getTracks().forEach((track) => track.stop());
}

async function openCall(type, withVideo) {
  if (!activeChatId) return;
  const other = getOther(state.chats.find((chat) => chat.id === activeChatId));
  callAvatar.src = other.avatar;
  callTitle.textContent = `${type}: ${other.name}`;
  callSubtitle.textContent = "Зову...";
  localVideo.hidden = true;
  callDialog.showModal();

  try {
    await startOutgoingCall(other, withVideo);
  } catch {
    callSubtitle.textContent = "Не получилось начать звонок. Проверь HTTPS и разрешения микрофона/камеры.";
  }
}

function closeCall() {
  if (activeCallId && state.calls?.[activeCallId]) {
    state.calls[activeCallId].status = "ended";
    state.calls[activeCallId].updatedAt = Date.now();
    saveState();
  }
  callStream?.getTracks().forEach((track) => track.stop());
  peerConnection?.close();
  peerConnection = null;
  callStream = null;
  activeCallId = null;
  processedIceCandidates = new Set();
  localVideo.srcObject = null;
  callAvatar.hidden = false;
  if (callDialog.open) callDialog.close();
}

async function startOutgoingCall(other, withVideo) {
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    callSubtitle.textContent = "Звонки работают только через HTTPS в современном браузере.";
    return;
  }

  const chat = state.chats.find((item) => item.id === activeChatId);
  const callId = chat.id;
  activeCallId = callId;
  processedIceCandidates = new Set();
  callStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
  showLocalCallMedia(withVideo);

  const call = {
    id: callId,
    chatId: chat.id,
    from: currentUser,
    to: other.id,
    withVideo,
    status: "ringing",
    candidates: {},
    updatedAt: Date.now(),
  };
  state.calls ||= {};
  state.calls[callId] = call;
  peerConnection = createPeerConnection(callId);
  callStream.getTracks().forEach((track) => peerConnection.addTrack(track, callStream));

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  state.calls[callId].offer = offer;
  state.calls[callId].updatedAt = Date.now();
  callSubtitle.textContent = "Жду ответа...";
  saveState();
}

async function acceptIncomingCall(call) {
  const from = state.users.find((user) => user.id === call.from);
  if (!from) return;
  activeChatId = call.chatId;
  activeCallId = call.id;
  processedIceCandidates = new Set();
  callAvatar.src = from.avatar;
  callTitle.textContent = `${call.withVideo ? "Видеозвонок" : "Голосовой звонок"}: ${from.name}`;
  callSubtitle.textContent = "Соединяю...";
  callDialog.showModal();

  callStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.withVideo });
  showLocalCallMedia(call.withVideo);
  peerConnection = createPeerConnection(call.id);
  callStream.getTracks().forEach((track) => peerConnection.addTrack(track, callStream));
  await peerConnection.setRemoteDescription(call.offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  state.calls[call.id] = {
    ...call,
    answer,
    status: "active",
    updatedAt: Date.now(),
  };
  saveState();
}

function createPeerConnection(callId) {
  const connection = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  connection.addEventListener("icecandidate", (event) => {
    if (!event.candidate || !state.calls?.[callId]) return;
    const call = state.calls[callId];
    call.candidates ||= {};
    call.candidates[currentUser] ||= [];
    call.candidates[currentUser].push({
      id: makeId(),
      candidate: event.candidate.toJSON(),
    });
    call.updatedAt = Date.now();
    saveState();
  });

  connection.addEventListener("track", (event) => {
    localVideo.srcObject = event.streams[0];
    localVideo.hidden = false;
    callAvatar.hidden = true;
    callSubtitle.textContent = "Соединено";
  });

  connection.addEventListener("connectionstatechange", () => {
    if (["failed", "disconnected", "closed"].includes(connection.connectionState)) {
      callSubtitle.textContent = "Соединение прервано.";
    }
    if (connection.connectionState === "connected") {
      callSubtitle.textContent = "Соединено";
    }
  });

  return connection;
}

function showLocalCallMedia(withVideo) {
  if (withVideo) {
    localVideo.srcObject = callStream;
    localVideo.hidden = false;
    callAvatar.hidden = true;
  } else {
    localVideo.hidden = true;
    callAvatar.hidden = false;
  }
}

function handleIncomingCalls() {
  if (!currentUser || activeCallId) return;
  const call = Object.values(state.calls || {}).find((item) => (
    item.to === currentUser &&
    item.status === "ringing" &&
    item.offer &&
    Date.now() - item.updatedAt < 60000
  ));
  if (!call || incomingPromptedCallId === call.id) return;
  incomingPromptedCallId = call.id;
  const from = state.users.find((user) => user.id === call.from);
  const accepted = confirm(`${from?.name || "Друг"} звонит. Ответить?`);
  if (accepted) {
    acceptIncomingCall(call).catch(() => {
      callSubtitle.textContent = "Не получилось принять звонок. Проверь разрешения браузера.";
    });
  } else {
    state.calls[call.id] = { ...call, status: "ended", updatedAt: Date.now() };
    saveState();
  }
}

async function handleCallState() {
  if (!activeCallId || !peerConnection) return;
  const call = state.calls?.[activeCallId];
  if (!call) return;
  if (call.status === "ended") {
    closeCall();
    return;
  }

  if (call.from === currentUser && call.answer && !peerConnection.currentRemoteDescription) {
    await peerConnection.setRemoteDescription(call.answer);
    callSubtitle.textContent = "Соединяю...";
  }

  const otherId = call.from === currentUser ? call.to : call.from;
  const candidates = call.candidates?.[otherId] || [];
  for (const item of candidates) {
    if (processedIceCandidates.has(item.id)) continue;
    processedIceCandidates.add(item.id);
    try {
      await peerConnection.addIceCandidate(item.candidate);
    } catch {
      // ICE candidates can arrive before descriptions on slow networks.
    }
  }
}

function openEditProfile() {
  const me = getMe();
  editAvatarPreview.src = me.avatar;
  editNameInput.value = me.name;
  editUsernameInput.value = me.username;
  editAvatarInput.value = "";
  editPasswordInput.value = "";
  profileNote.textContent = "";
  profileDialog.showModal();
}

function openActiveUserProfile() {
  if (!activeChatId) return;
  const other = getOther(state.chats.find((chat) => chat.id === activeChatId));
  openUserProfile(other.id);
}

function openUserProfile(userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) return;
  viewedUserId = user.id;
  viewAvatar.src = user.avatar;
  viewName.textContent = user.name;
  viewUsername.textContent = `@${user.username}`;
  messageUserButton.hidden = user.id === currentUser;
  userDialog.showModal();
}

function formatTime(time) {
  return new Intl.DateTimeFormat("ru", { hour: "2-digit", minute: "2-digit" }).format(time);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

if (currentUser && state.users.some((user) => user.id === currentUser)) {
  enterApp();
}

pullSharedState({ render: true });
if (SHARED_STATE_URL) {
  setInterval(() => pullSharedState({ render: true }), 900);
  setInterval(() => {
    updatePresence();
    scheduleSharedStatePush();
    updateChatStatus();
  }, 3000);
}
