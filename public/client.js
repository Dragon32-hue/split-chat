const socket = io();

const AVATARS = ['👤', '😀', '🎮', '🦊', '🐱', '🌙', '⚡', '🎨', '🚀', '🍕', '👾', '🧙'];
const COLORS = [
  { value: '#5865f2', label: 'Blurple' },
  { value: '#eb459e', label: 'Pink' },
  { value: '#57f287', label: 'Green' },
  { value: '#fee75c', label: 'Yellow' },
  { value: '#ed4245', label: 'Red' },
  { value: '#00b0f4', label: 'Blue' }
];
const STATUS_LABELS = { online: '🟢 Online', idle: '🟡 Idle', dnd: '🔴 Do Not Disturb' };
const STORAGE_KEY = 'split-chat-profile';

function byId(id) {
  return document.getElementById(id);
}

const joinScreen = byId('join-screen');
const app = byId('app');
const joinForm = byId('join-form');
const joinError = byId('join-error');
const connectionStatus = byId('connection-status');
const channelList = byId('channel-list');
const dmList = byId('dm-list');
const membersEl = byId('members');
const memberCountEl = byId('member-count');
const messagesEl = byId('messages');
const typingLine = byId('typing-line');
const chatForm = byId('chat-form');
const messageInput = byId('message-input');
const sendButton = byId('send-button');
const myAvatarEl = byId('my-avatar');
const myDisplayEl = byId('my-display');
const myUsernameEl = byId('my-username');
const profileModal = byId('profile-modal');
const editModal = byId('edit-modal');
const dmModal = byId('dm-modal');

let me = null;
let channels = [];
let messagesByChannel = {};
let conversations = {};
let members = [];
let dmNames = new Set();
let unread = new Map();
let typingMap = new Map();
let view = { type: 'channel', id: 'general' };
let selectedProfile = null;
let localTypingTimer = null;
let localTypingKey = '';

function loadSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !saved.username) return null;
    return {
      username: saved.username,
      displayName: saved.displayName || saved.username,
      avatar: AVATARS.includes(saved.avatar) ? saved.avatar : AVATARS[0],
      color: COLORS.some((color) => color.value === saved.color) ? saved.color : COLORS[0].value,
      status: STATUS_LABELS[saved.status] ? saved.status : 'online',
      bio: saved.bio || ''
    };
  } catch (error) {
    return null;
  }
}

function saveProfile(profile) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

function fillSelect(select, values, labels) {
  values.forEach((value, index) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = labels ? labels[index] : value;
    select.append(option);
  });
}

function makeAvatar(profile, extraClass) {
  const avatar = document.createElement('span');
  avatar.className = `avatar ${extraClass || ''}`.trim();
  avatar.textContent = profile.avatar || '👤';
  avatar.style.backgroundColor = profile.color || COLORS[0].value;
  avatar.dataset.status = profile.status || 'online';
  return avatar;
}

function readJoinProfile() {
  return {
    username: byId('join-username').value.trim(),
    displayName: byId('join-display').value.trim(),
    avatar: byId('join-avatar').value,
    color: COLORS[0].value,
    status: byId('join-status').value,
    bio: byId('join-bio').value.trim()
  };
}

function prefillJoin(profile) {
  if (!profile) return;
  byId('join-username').value = profile.username;
  byId('join-display').value = profile.displayName === profile.username ? '' : profile.displayName;
  byId('join-avatar').value = profile.avatar;
  byId('join-status').value = profile.status;
  byId('join-bio').value = profile.bio;
}

function readEditProfile() {
  return {
    ...me,
    displayName: byId('edit-display').value.trim(),
    avatar: byId('edit-avatar').value,
    color: byId('edit-color').value,
    status: byId('edit-status').value,
    bio: byId('edit-bio').value.trim()
  };
}

function doJoin(profile) {
  socket.emit('join', profile, (result) => {
    if (!result.ok) {
      app.classList.add('hidden');
      joinScreen.classList.remove('hidden');
      joinError.textContent = result.error;
      return;
    }
    onJoined(result.profile);
  });
}

function onJoined(profile) {
  me = profile;
  saveProfile(profile);
  joinScreen.classList.add('hidden');
  app.classList.remove('hidden');
  myAvatarEl.textContent = profile.avatar;
  myAvatarEl.style.backgroundColor = profile.color;
  myAvatarEl.dataset.status = profile.status;
  myDisplayEl.textContent = profile.displayName;
  myUsernameEl.textContent = `@${profile.username}`;
  setInputEnabled(true);
  updateHeader();
  messageInput.focus();
}

function setInputEnabled(enabled) {
  messageInput.disabled = !enabled;
  sendButton.disabled = !enabled;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function displayNameOf(username) {
  const member = members.find((item) => item.username === username);
  return member ? member.displayName : username;
}

function typingKey(scope, target) {
  return `${scope}:${target}`;
}

function renderChannels() {
  channelList.replaceChildren();
  channels.forEach((channel) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'side-item';
    if (view.type === 'channel' && view.id === channel.id) button.classList.add('active');

    const hash = document.createElement('span');
    hash.className = 'channel-hash';
    hash.textContent = '#';

    const name = document.createElement('span');
    name.className = 'side-name';
    name.textContent = channel.name;

    button.append(hash, name);
    button.addEventListener('click', () => setView('channel', channel.id));
    item.append(button);
    channelList.append(item);
  });
}

function renderDMs() {
  dmList.replaceChildren();
  dmNames.forEach((username) => {
    const profile = members.find((member) => member.username === username);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'side-item';
    if (view.type === 'dm' && view.id === username) button.classList.add('active');

    const avatar = makeAvatar(profile || { avatar: '👤', color: COLORS[0].value, status: 'offline' }, 'small');
    avatar.style.setProperty('--dot', 'transparent');

    const name = document.createElement('span');
    name.className = 'side-name';
    name.textContent = profile ? profile.displayName : username;

    button.append(avatar, name);

    const count = unread.get(username) || 0;
    if (count) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = count;
      button.append(badge);
    }

    button.addEventListener('click', () => setView('dm', username));
    item.append(button);
    dmList.append(item);
  });
}

function renderMembers() {
  memberCountEl.textContent = members.length;
  membersEl.replaceChildren();
  members.forEach((profile) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'member';

    const avatar = makeAvatar(profile, 'small');
    const text = document.createElement('span');
    text.className = 'member-text';

    const name = document.createElement('strong');
    name.textContent = profile.displayName;
    const username = document.createElement('small');
    username.textContent = `@${profile.username}`;
    text.append(name, username);

    button.append(avatar, text);
    button.addEventListener('click', () => openProfile(profile));
    item.append(button);
    membersEl.append(item);
  });
}

function messagesForView() {
  if (view.type === 'channel') return messagesByChannel[view.id] || [];
  return conversations[view.id] || [];
}

function appendMessage(message, scroll) {
  const item = document.createElement('li');
  item.className = 'message';
  if (me && message.from === me.username) item.classList.add('mine');

  const avatar = makeAvatar(message.author || {}, '');
  const body = document.createElement('div');
  body.className = 'message-body';

  const meta = document.createElement('div');
  meta.className = 'message-meta';

  const author = document.createElement('span');
  author.className = 'message-author';
  author.textContent = message.author && message.author.displayName ? message.author.displayName : message.from;
  author.addEventListener('click', () => {
    const profile = members.find((member) => member.username === message.from);
    openProfile(profile || message.author || { username: message.from, displayName: message.from });
  });

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = formatTime(message.time);

  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = message.text;

  meta.append(author, time);
  body.append(meta, text);
  item.append(avatar, body);
  messagesEl.append(item);

  if (scroll !== false) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderView() {
  messagesEl.replaceChildren();
  messagesForView().forEach((message) => appendMessage(message, false));
  messagesEl.scrollTop = messagesEl.scrollHeight;
  renderTyping();
}

function updateHeader() {
  const title = byId('view-title');
  const topic = byId('view-topic');
  if (view.type === 'channel') {
    const channel = channels.find((item) => item.id === view.id);
    title.textContent = `#${view.id}`;
    topic.textContent = channel ? channel.topic : '';
    messageInput.placeholder = `Message #${view.id}`;
  } else {
    title.textContent = `@${view.id}`;
    topic.textContent = `Direct message with ${displayNameOf(view.id)}`;
    messageInput.placeholder = `Message @${view.id}`;
  }
}

function setView(type, id) {
  clearLocalTyping();
  view = { type, id };
  if (type === 'dm') {
    dmNames.add(id);
    unread.delete(id);
  }
  updateHeader();
  renderChannels();
  renderDMs();
  renderView();
  messageInput.focus();
}

function renderTyping() {
  const key = typingKey(view.type, view.id);
  const users = [...(typingMap.get(key) || new Map()).keys()].filter((name) => !me || name !== me.username);
  if (!users.length) {
    typingLine.textContent = '';
  } else if (users.length === 1) {
    typingLine.textContent = `${displayNameOf(users[0])} is typing...`;
  } else {
    typingLine.textContent = `${users.slice(0, 2).map(displayNameOf).join(' and ')} are typing...`;
  }
}

function setTyping(payload) {
  const key = typingKey(payload.scope, payload.target);
  if (!typingMap.has(key)) typingMap.set(key, new Map());

  const users = typingMap.get(key);
  if (users.has(payload.user)) clearTimeout(users.get(payload.user));

  if (!payload.isTyping) {
    users.delete(payload.user);
  } else {
    const timeout = setTimeout(() => {
      users.delete(payload.user);
      renderTyping();
    }, 3000);
    users.set(payload.user, timeout);
  }
  renderTyping();
}

function emitTyping(isTyping) {
  if (!me) return;
  socket.emit('typing', {
    scope: view.type === 'channel' ? 'channel' : 'dm',
    target: view.id,
    isTyping
  });
}

function handleInput() {
  if (!me) return;
  const key = typingKey(view.type, view.id);
  if (localTypingKey !== key || !localTypingTimer) {
    emitTyping(true);
    localTypingKey = key;
  }
  clearTimeout(localTypingTimer);
  localTypingTimer = setTimeout(() => {
    localTypingTimer = null;
    emitTyping(false);
  }, 2000);
}

function clearLocalTyping() {
  clearTimeout(localTypingTimer);
  if (localTypingTimer) emitTyping(false);
  localTypingTimer = null;
  localTypingKey = '';
}

function openProfile(profile) {
  if (!profile) return;
  selectedProfile = profile;
  const isMe = me && profile.username === me.username;

  const banner = byId('profile-banner');
  const avatar = byId('profile-avatar');
  banner.style.backgroundColor = profile.color || COLORS[0].value;
  avatar.textContent = profile.avatar || '👤';
  avatar.style.backgroundColor = profile.color || COLORS[0].value;
  avatar.dataset.status = profile.status || 'online';

  byId('profile-display').textContent = profile.displayName || profile.username;
  byId('profile-username').textContent = `@${profile.username}`;
  byId('profile-status').textContent = STATUS_LABELS[profile.status] || STATUS_LABELS.online;
  byId('profile-bio').textContent = profile.bio || 'No bio yet.';
  byId('profile-joined').textContent = profile.joinedAt
    ? `Joined ${new Date(profile.joinedAt).toLocaleDateString()}`
    : '';
  byId('profile-message').classList.toggle('hidden', !!isMe);
  byId('profile-edit').classList.toggle('hidden', !isMe);
  profileModal.classList.remove('hidden');
}

function openEdit() {
  byId('edit-display').value = me.displayName;
  byId('edit-avatar').value = me.avatar;
  byId('edit-color').value = me.color;
  byId('edit-status').value = me.status;
  byId('edit-bio').value = me.bio;
  byId('edit-error').textContent = '';
  editModal.classList.remove('hidden');
}

fillSelect(byId('join-avatar'), AVATARS);
fillSelect(byId('edit-avatar'), AVATARS);
fillSelect(byId('edit-color'), COLORS.map((color) => color.value), COLORS.map((color) => color.label));
prefillJoin(loadSaved());

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const profile = readJoinProfile();
  if (!profile.username) return;
  joinError.textContent = '';
  doJoin(profile);
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!me) return;
  const text = messageInput.value.trim();
  if (!text) return;

  if (view.type === 'channel') {
    socket.emit('message:send', { channel: view.id, text });
  } else {
    socket.emit('dm:send', { to: view.id, text }, (result) => {
      if (!result || result.ok) return;
      typingLine.textContent = result.error;
      setTimeout(renderTyping, 3000);
    });
  }

  messageInput.value = '';
  clearLocalTyping();
  messageInput.focus();
});

messageInput.addEventListener('input', handleInput);
messageInput.addEventListener('blur', clearLocalTyping);

byId('my-profile').addEventListener('click', () => openProfile(me));
byId('edit-profile').addEventListener('click', openEdit);
byId('new-dm').addEventListener('click', () => {
  byId('dm-error').textContent = '';
  dmModal.classList.remove('hidden');
  byId('dm-username').focus();
});

byId('profile-message').addEventListener('click', () => {
  profileModal.classList.add('hidden');
  setView('dm', selectedProfile.username);
});

byId('profile-edit').addEventListener('click', () => {
  profileModal.classList.add('hidden');
  openEdit();
});

byId('edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const profile = readEditProfile();
  if (!profile.displayName) {
    byId('edit-error').textContent = 'Please enter a display name.';
    return;
  }
  socket.emit('profile:update', profile);
  editModal.classList.add('hidden');
});

byId('dm-form').addEventListener('submit', (event) => {
  event.preventDefault();
  let username = byId('dm-username').value.trim();
  if (!username) return;
  if (me && username.toLowerCase() === me.username.toLowerCase()) {
    byId('dm-error').textContent = 'You cannot message yourself.';
    return;
  }
  const found = members.find((member) => member.username.toLowerCase() === username.toLowerCase());
  if (found) username = found.username;
  dmModal.classList.add('hidden');
  byId('dm-username').value = '';
  setView('dm', username);
});

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => byId(button.dataset.close).classList.add('hidden'));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    [profileModal, editModal, dmModal].forEach((modal) => modal.classList.add('hidden'));
  }
});

socket.on('connect', () => {
  connectionStatus.textContent = 'Connected';
  const saved = loadSaved();
  if (saved && saved.username) {
    doJoin(saved);
  } else if (me) {
    doJoin(me);
  }
});

socket.on('disconnect', () => {
  connectionStatus.textContent = 'Disconnected - reconnecting...';
  setInputEnabled(false);
});

socket.on('init', (data) => {
  channels = data.channels || [];
  messagesByChannel = data.messages || {};
  conversations = data.conversations || {};
  members = data.members || [];
  dmNames = new Set(Object.keys(conversations));
  unread.clear();
  if (!channels.some((channel) => channel.id === view.id)) {
    view = { type: 'channel', id: channels.length ? channels[0].id : 'general' };
  }
  renderChannels();
  renderDMs();
  renderMembers();
  updateHeader();
  renderView();
  setInputEnabled(true);
});

socket.on('members', (list) => {
  members = list;
  renderMembers();
  renderDMs();
  renderTyping();
});

socket.on('message:new', (payload) => {
  if (!messagesByChannel[payload.channel]) messagesByChannel[payload.channel] = [];
  messagesByChannel[payload.channel].push(payload.message);
  if (view.type === 'channel' && view.id === payload.channel) appendMessage(payload.message);
});

socket.on('dm:new', (message) => {
  if (!me) return;
  const other = message.from === me.username ? message.to : message.from;
  dmNames.add(other);
  if (!conversations[other]) conversations[other] = [];
  conversations[other].push(message);
  if (view.type === 'dm' && view.id === other) {
    appendMessage(message);
  } else if (message.from !== me.username) {
    unread.set(other, (unread.get(other) || 0) + 1);
  }
  renderDMs();
});

socket.on('typing:update', (payload) => setTyping(payload));

socket.on('profile:updated', (profile) => {
  if (me && profile.username === me.username) {
    me = profile;
    saveProfile(profile);
    myAvatarEl.textContent = profile.avatar;
    myAvatarEl.style.backgroundColor = profile.color;
    myAvatarEl.dataset.status = profile.status;
    myDisplayEl.textContent = profile.displayName;
  }
});
