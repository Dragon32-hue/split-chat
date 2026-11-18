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
const EMOJIS = [
  '😀', '😂', '🥰', '😎', '🤔', '😭', '😡', '🥳',
  '😴', '🤯', '🙌', '👍', '👎', '👏', '🙏', '💪',
  '🤝', '✌️', '👀', '🔥', '✨', '🎉', '💯', '❤️',
  '🧡', '💛', '💚', '💙', '💜', '⭐', '🌈', '☀️',
  '🌙', '⚡', '🍕', '🍔', '🍣', '🍎', '☕', '🎮',
  '🎧', '🎨', '🚀', '🏠', '💬', '👾', '🦊', '🐱',
  '🐶', '🌸', '🍀', '💡', '📌', '✅', '❌', '❓',
  '❗', '💤', '🫡', '🤖', '🧙', '🎵', '🏆', '🥺'
];
const TOKEN_KEY = 'split-chat-token';

function byId(id) {
  return document.getElementById(id);
}

const authScreen = byId('auth-screen');
const app = byId('app');
const loginForm = byId('login-form');
const registerForm = byId('register-form');
const loginError = byId('login-error');
const registerError = byId('register-error');
const connectionStatus = byId('connection-status');
const navHome = byId('nav-home');
const navDms = byId('nav-dms');
const channelList = byId('channel-list');
const dmList = byId('dm-list');
const membersEl = byId('members');
const memberCountEl = byId('member-count');
const messagesEl = byId('messages');
const typingLine = byId('typing-line');
const chatForm = byId('chat-form');
const messageInput = byId('message-input');
const sendButton = byId('send-button');
const emojiPicker = byId('emoji-picker');
const reactionPicker = byId('reaction-picker');
const myAvatarEl = byId('my-avatar');
const myDisplayEl = byId('my-display');
const myUsernameEl = byId('my-username');
const profileModal = byId('profile-modal');
const editModal = byId('edit-modal');
const dmModal = byId('dm-modal');

let token = localStorage.getItem(TOKEN_KEY) || '';
let me = null;
let connected = false;
let channels = [];
let messagesByChannel = {};
let conversations = {};
let members = [];
let dmNames = new Set();
let unread = new Map();
let typingMap = new Map();
let view = { type: 'home' };
let selectedProfile = null;
let localTypingTimer = null;
let localTypingKey = '';
let pendingRegImage = '';
let pendingEditImage = '';
let reactionTarget = null;

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({ error: 'Server error.' }));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function setAuthMode(mode) {
  const login = mode === 'login';
  loginForm.classList.toggle('hidden', !login);
  registerForm.classList.toggle('hidden', login);
  byId('tab-login').classList.toggle('active', login);
  byId('tab-register').classList.toggle('active', !login);
  loginError.textContent = '';
  registerError.textContent = '';
}

function showAuth(message) {
  app.classList.add('hidden');
  authScreen.classList.remove('hidden');
  if (message) {
    setAuthMode('login');
    loginError.textContent = message;
  }
}

function startSession(newToken) {
  token = newToken;
  localStorage.setItem(TOKEN_KEY, token);
  if (socket.connected) joinWithToken();
}

function joinWithToken() {
  if (!token) return;
  socket.emit('join', { token }, (result) => {
    if (!result.ok) {
      if (result.expired) {
        token = '';
        localStorage.removeItem(TOKEN_KEY);
      }
      me = null;
      showAuth(result.error);
      return;
    }
    onJoined(result.profile);
  });
}

function onJoined(profile) {
  const firstJoin = !me;
  me = profile;
  authScreen.classList.add('hidden');
  app.classList.remove('hidden');
  updateMyBar();
  if (firstJoin) view = { type: 'home' };
  renderAll();
  if (firstJoin) messageInput.focus();
}

function updateMyBar() {
  setAvatarElement(myAvatarEl, me, 'small');
  myDisplayEl.textContent = me.displayName;
  myUsernameEl.textContent = `@${me.username}`;
}

function setAvatarElement(element, profile, extraClass) {
  element.className = `avatar ${extraClass || ''}`.trim();
  element.replaceChildren();
  element.style.backgroundColor = profile.color || COLORS[0].value;
  element.dataset.status = profile.status || 'online';
  if (profile.avatarImage) {
    const image = document.createElement('img');
    image.src = profile.avatarImage;
    image.alt = '';
    element.append(image);
  } else {
    element.textContent = profile.avatar || '👤';
  }
}

function makeAvatar(profile, extraClass) {
  const avatar = document.createElement('span');
  setAvatarElement(avatar, profile || {}, extraClass);
  return avatar;
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

function renderAll() {
  renderChannels();
  renderDMs();
  renderMembers();
  updateHeader();
  renderView();
  updateComposerState();
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
  navHome.classList.toggle('active', view.type === 'home');
  navDms.classList.toggle('active', view.type === 'dms');
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

    const avatar = makeAvatar(profile || { avatar: '👤' }, 'small');
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
  if (view.type === 'dm') return conversations[view.id] || [];
  return [];
}

function makeHubCard(title, subtitle, leading, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hub-card';
  if (leading) button.append(leading);
  const text = document.createElement('span');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const small = document.createElement('small');
  small.textContent = subtitle;
  text.append(strong, small);
  button.append(text);
  button.addEventListener('click', onClick);
  return button;
}

function renderHub() {
  const hub = document.createElement('div');
  hub.className = 'hub';

  const title = document.createElement('h2');
  title.textContent = view.type === 'home' ? `Welcome back, ${me.displayName}` : 'Direct Messages';
  const subtitle = document.createElement('p');
  subtitle.textContent = view.type === 'home'
    ? 'Jump into a channel or catch up with your friends.'
    : 'Your conversations and everyone who is online.';
  hub.append(title, subtitle);

  if (view.type === 'home') {
    const channelsGrid = document.createElement('div');
    channelsGrid.className = 'hub-grid';
    channels.forEach((channel) => {
      const hash = document.createElement('span');
      hash.className = 'channel-hash';
      hash.textContent = '#';
      channelsGrid.append(makeHubCard(channel.name, channel.topic, hash, () => setView('channel', channel.id)));
    });
    hub.append(channelsGrid);
  }

  const heading = document.createElement('p');
  heading.textContent = 'Conversations';
  heading.style.fontWeight = '700';
  heading.style.color = '#f2f3f5';
  hub.append(heading);

  const grid = document.createElement('div');
  grid.className = 'hub-grid';
  if (!dmNames.size) {
    const empty = document.createElement('p');
    empty.textContent = 'No messages yet. Click the + next to Direct Messages to start one.';
    hub.append(empty);
  }
  dmNames.forEach((username) => {
    const profile = members.find((member) => member.username === username);
    const count = unread.get(username) || 0;
    grid.append(makeHubCard(
      profile ? profile.displayName : username,
      count ? `${count} unread message${count > 1 ? 's' : ''}` : 'Open conversation',
      makeAvatar(profile || { avatar: '👤' }, 'small'),
      () => setView('dm', username)
    ));
  });
  hub.append(grid);

  const friendsHeading = document.createElement('p');
  friendsHeading.textContent = 'Online friends';
  friendsHeading.style.fontWeight = '700';
  friendsHeading.style.color = '#f2f3f5';
  hub.append(friendsHeading);

  const friendsGrid = document.createElement('div');
  friendsGrid.className = 'hub-grid';
  const friends = members.filter((member) => member.username !== me.username);
  if (!friends.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No one else is online right now. Share your link and invite them!';
    friendsGrid.append(empty);
  }
  friends.forEach((profile) => {
    friendsGrid.append(makeHubCard(
      profile.displayName,
      `@${profile.username} · ${STATUS_LABELS[profile.status] || ''}`,
      makeAvatar(profile, 'small'),
      () => setView('dm', profile.username)
    ));
  });
  hub.append(friendsGrid);

  messagesEl.replaceChildren(hub);
  messagesEl.scrollTop = 0;
}

function renderReactions(message) {
  const wrapper = document.createElement('div');
  wrapper.className = 'reactions';
  const reactions = message.reactions || {};
  Object.entries(reactions).forEach(([emoji, users]) => {
    if (!users.length) return;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'reaction-chip';
    if (me && users.includes(me.username)) chip.classList.add('mine');
    chip.textContent = `${emoji} ${users.length}`;
    chip.title = users.join(', ');
    chip.addEventListener('click', () => sendReaction(emoji));
    wrapper.append(chip);
  });
  return wrapper;
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
  const reactButton = document.createElement('button');
  reactButton.type = 'button';
  reactButton.className = 'react-button';
  reactButton.textContent = '☺+';
  reactButton.title = 'Add reaction';
  reactButton.addEventListener('click', (event) => openReactionPicker(event, message));
  meta.append(author, time, reactButton);

  const text = document.createElement('div');
  text.className = 'message-text';
  text.textContent = message.text;

  body.append(meta, text, renderReactions(message));
  item.append(avatar, body);
  messagesEl.append(item);
  if (scroll !== false) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderView() {
  if (view.type === 'home' || view.type === 'dms') {
    renderHub();
    typingLine.textContent = '';
    return;
  }
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
  } else if (view.type === 'dm') {
    title.textContent = `@${view.id}`;
    topic.textContent = `Direct message with ${displayNameOf(view.id)}`;
    messageInput.placeholder = `Message @${view.id}`;
  } else {
    title.textContent = view.type === 'home' ? 'Home' : 'Direct Messages';
    topic.textContent = view.type === 'home' ? 'Your Split Chat dashboard' : 'Friends and conversations';
  }
}

function updateComposerState() {
  const canChat = connected && !!me && (view.type === 'channel' || view.type === 'dm');
  chatForm.classList.toggle('hidden', view.type === 'home' || view.type === 'dms');
  messageInput.disabled = !canChat;
  sendButton.disabled = !canChat;
}

function setView(type, id) {
  clearLocalTyping();
  view = type === 'dm' ? { type, id } : { type };
  if (type === 'dms') unread.clear();
  if (type === 'dm') {
    dmNames.add(id);
    unread.delete(id);
  }
  emojiPicker.classList.add('hidden');
  reactionPicker.classList.add('hidden');
  updateHeader();
  renderChannels();
  renderDMs();
  renderView();
  updateComposerState();
  if (canChatNow()) messageInput.focus();
}

function canChatNow() {
  return connected && !!me && (view.type === 'channel' || view.type === 'dm');
}

function renderTyping() {
  if (view.type === 'home' || view.type === 'dms') {
    typingLine.textContent = '';
    return;
  }
  const users = [...(typingMap.get(typingKey(view.type, view.id)) || new Map()).keys()]
    .filter((name) => !me || name !== me.username);
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
  if (!me || !canChatNow()) return;
  socket.emit('typing', {
    scope: view.type === 'channel' ? 'channel' : 'dm',
    target: view.id,
    isTyping
  });
}

function handleInput() {
  if (!canChatNow()) return;
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

function buildEmojiGrid(container, onPick) {
  container.replaceChildren();
  EMOJIS.forEach((emoji) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'emoji-option';
    button.textContent = emoji;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onPick(emoji);
    });
    container.append(button);
  });
}

function insertEmoji(emoji) {
  const start = messageInput.selectionStart == null ? messageInput.value.length : messageInput.selectionStart;
  const end = messageInput.selectionEnd == null ? start : messageInput.selectionEnd;
  messageInput.value = messageInput.value.slice(0, start) + emoji + messageInput.value.slice(end);
  messageInput.focus();
  messageInput.selectionStart = messageInput.selectionEnd = start + emoji.length;
  handleInput();
  emojiPicker.classList.add('hidden');
}

function openReactionPicker(event, message) {
  event.stopPropagation();
  reactionTarget = {
    scope: view.type === 'dm' ? 'dm' : 'channel',
    target: view.id,
    messageId: message.id
  };
  emojiPicker.classList.add('hidden');
  reactionPicker.classList.remove('hidden');
  const rect = reactionPicker.getBoundingClientRect();
  const left = Math.min(event.clientX, window.innerWidth - rect.width - 12);
  const top = Math.max(8, event.clientY - rect.height - 8);
  reactionPicker.style.left = `${Math.max(8, left)}px`;
  reactionPicker.style.top = `${top}px`;
}

function sendReaction(emoji) {
  if (!reactionTarget) return;
  socket.emit('reaction:add', { ...reactionTarget, emoji });
  reactionPicker.classList.add('hidden');
  reactionTarget = null;
}

function openProfile(profile) {
  if (!profile) return;
  selectedProfile = profile;
  const isMe = me && profile.username === me.username;

  const banner = byId('profile-banner');
  banner.style.backgroundColor = profile.color || COLORS[0].value;
  setAvatarElement(byId('profile-avatar'), profile, 'huge');
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
  pendingEditImage = me.avatarImage || '';
  const preview = byId('edit-image-preview');
  if (pendingEditImage) {
    preview.src = pendingEditImage;
    preview.classList.remove('hidden');
  } else {
    preview.classList.add('hidden');
  }
  byId('edit-remove-image').classList.toggle('hidden', !pendingEditImage);
  byId('edit-error').textContent = '';
  editModal.classList.remove('hidden');
}

async function fileToAvatarData(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Image must be smaller than 5 MB.');
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = reject;
    element.src = dataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  canvas.getContext('2d').drawImage(image, 0, 0, 128, 128);
  return canvas.toDataURL('image/jpeg', 0.75);
}

async function handleImagePick(input, preview, setter, errorEl) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const data = await fileToAvatarData(file);
    setter(data);
    preview.src = data;
    preview.classList.remove('hidden');
    errorEl.textContent = '';
  } catch (error) {
    input.value = '';
    errorEl.textContent = error.message || 'Could not load that image.';
  }
}

function fillSelect(select, values, labels) {
  values.forEach((value, index) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = labels ? labels[index] : value;
    select.append(option);
  });
}

buildEmojiGrid(byId('emoji-grid'), insertEmoji);
buildEmojiGrid(byId('reaction-grid'), sendReaction);
fillSelect(byId('reg-avatar'), AVATARS);
fillSelect(byId('edit-avatar'), AVATARS);
fillSelect(byId('edit-color'), COLORS.map((color) => color.value), COLORS.map((color) => color.label));

byId('tab-login').addEventListener('click', () => setAuthMode('login'));
byId('tab-register').addEventListener('click', () => setAuthMode('register'));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.textContent = '';
  try {
    const data = await api('/api/login', {
      username: byId('login-username').value.trim(),
      password: byId('login-password').value
    });
    startSession(data.token);
  } catch (error) {
    loginError.textContent = error.message;
  }
});

registerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  registerError.textContent = '';
  try {
    const data = await api('/api/register', {
      username: byId('reg-username').value.trim(),
      password: byId('reg-password').value,
      displayName: byId('reg-display').value.trim(),
      avatar: byId('reg-avatar').value,
      status: byId('reg-status').value,
      bio: byId('reg-bio').value.trim(),
      avatarImage: pendingRegImage
    });
    startSession(data.token);
  } catch (error) {
    registerError.textContent = error.message;
  }
});

byId('reg-image').addEventListener('change', (event) => {
  handleImagePick(event.target, byId('reg-image-preview'), (data) => { pendingRegImage = data; }, registerError);
});

byId('edit-image').addEventListener('change', (event) => {
  handleImagePick(event.target, byId('edit-image-preview'), (data) => {
    pendingEditImage = data;
    byId('edit-remove-image').classList.remove('hidden');
  }, byId('edit-error'));
});

byId('edit-remove-image').addEventListener('click', () => {
  pendingEditImage = '';
  byId('edit-image').value = '';
  byId('edit-image-preview').classList.add('hidden');
  byId('edit-remove-image').classList.add('hidden');
});

navHome.addEventListener('click', () => setView('home'));
navDms.addEventListener('click', () => setView('dms'));

byId('new-dm').addEventListener('click', () => {
  byId('dm-error').textContent = '';
  dmModal.classList.remove('hidden');
  byId('dm-username').focus();
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!canChatNow()) return;
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
byId('emoji-button').addEventListener('click', (event) => {
  event.stopPropagation();
  reactionPicker.classList.add('hidden');
  emojiPicker.classList.toggle('hidden');
});

document.addEventListener('click', (event) => {
  if (!emojiPicker.contains(event.target) && event.target !== byId('emoji-button')) {
    emojiPicker.classList.add('hidden');
  }
  if (!reactionPicker.contains(event.target) && !event.target.classList.contains('react-button')) {
    reactionPicker.classList.add('hidden');
  }
});

byId('my-profile').addEventListener('click', () => openProfile(me));
byId('edit-profile').addEventListener('click', openEdit);

byId('profile-message').addEventListener('click', () => {
  profileModal.classList.add('hidden');
  setView('dm', selectedProfile.username);
});

byId('profile-edit').addEventListener('click', () => {
  profileModal.classList.add('hidden');
  openEdit();
});

byId('edit-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = byId('edit-error');
  errorEl.textContent = '';
  const displayName = byId('edit-display').value.trim();
  if (!displayName) {
    errorEl.textContent = 'Please enter a display name.';
    return;
  }
  try {
    const data = await api('/api/profile', {
      token,
      profile: {
        displayName,
        avatar: byId('edit-avatar').value,
        color: byId('edit-color').value,
        status: byId('edit-status').value,
        bio: byId('edit-bio').value.trim(),
        avatarImage: pendingEditImage
      }
    });
    me = data.profile;
    updateMyBar();
    editModal.classList.add('hidden');
  } catch (error) {
    errorEl.textContent = error.message;
  }
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

byId('logout').addEventListener('click', async () => {
  try {
    await api('/api/logout', { token });
  } catch (error) {
    console.error(error);
  }
  token = '';
  me = null;
  connected = false;
  localStorage.removeItem(TOKEN_KEY);
  socket.disconnect();
  socket.connect();
  showAuth();
});

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => byId(button.dataset.close).classList.add('hidden'));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    [profileModal, editModal, dmModal, emojiPicker, reactionPicker].forEach((element) => element.classList.add('hidden'));
  }
});

socket.on('connect', () => {
  connected = true;
  connectionStatus.textContent = 'Connected';
  updateComposerState();
  if (token) joinWithToken();
});

socket.on('disconnect', () => {
  connected = false;
  connectionStatus.textContent = 'Disconnected - reconnecting...';
  updateComposerState();
});

socket.on('auth:expired', () => {
  token = '';
  me = null;
  localStorage.removeItem(TOKEN_KEY);
  showAuth('Your session expired. Please log in again.');
});

socket.on('init', (data) => {
  channels = data.channels || [];
  messagesByChannel = data.messages || {};
  conversations = data.conversations || {};
  members = data.members || [];
  dmNames = new Set(Object.keys(conversations));
  unread.clear();
  if (view.type === 'channel' && !channels.some((channel) => channel.id === view.id)) {
    view = { type: 'home' };
  }
  if (me) renderAll();
});

socket.on('members', (list) => {
  members = list;
  renderMembers();
  renderDMs();
  if (me && (view.type === 'home' || view.type === 'dms')) renderHub();
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
  if (view.type === 'home' || view.type === 'dms') renderHub();
});

socket.on('reaction:update', (payload) => {
  const list = payload.scope === 'channel' ? messagesByChannel[payload.target] : conversations[payload.target];
  if (!list) return;
  const message = list.find((item) => item.id === payload.messageId);
  if (!message) return;
  message.reactions = payload.reactions;
  const isCurrent = (payload.scope === 'channel' && view.type === 'channel' && view.id === payload.target) ||
    (payload.scope === 'dm' && view.type === 'dm' && view.id === payload.target);
  if (isCurrent) {
    const position = messagesEl.scrollTop;
    renderView();
    messagesEl.scrollTop = position;
  }
});

socket.on('typing:update', (payload) => setTyping(payload));

socket.on('profile:updated', (profile) => {
  if (me && profile.username === me.username) {
    me = profile;
    updateMyBar();
  }
});
