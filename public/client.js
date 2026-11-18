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
const STATUS_LABELS = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb' };
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
const ALL_PERMISSIONS = ['viewChannels', 'sendMessages', 'manageChannels', 'manageRoles', 'manageServer'];
const PERMISSION_LABELS = {
  viewChannels: 'View channels',
  sendMessages: 'Send messages',
  manageChannels: 'Manage channels',
  manageRoles: 'Manage roles',
  manageServer: 'Manage server'
};
const SERVER_ICONS = [
  'globe', 'message', 'gamepad', 'headphones', 'palette', 'rocket',
  'pizza', 'ghost', 'bolt', 'moon', 'flame', 'shield'
];
const THEMES = ['midnight', 'charcoal', 'light', 'ocean', 'forest'];

function byId(id) {
  return document.getElementById(id);
}

function svgIcon(name, extraClass) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('class', `icon ${extraClass || ''}`.trim());
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  icon.append(use);
  return icon;
}

function serverIconParts(value) {
  const icon = String(value || '');
  if (icon.startsWith('i:')) return { content: icon.slice(2), isIcon: true, isImage: false };
  if (icon.startsWith('data:image/')) return { content: icon, isIcon: false, isImage: true };
  if (!icon) return { content: 'shield', isIcon: true, isImage: false };
  return { content: icon, isIcon: false, isImage: false };
}

function serverIconElement(parts, extraClass) {
  if (parts.isImage) {
    const image = document.createElement('img');
    image.src = parts.content;
    image.alt = '';
    image.className = `server-image ${extraClass || ''}`.trim();
    return image;
  }
  if (parts.isIcon) return svgIcon(parts.content, extraClass);
  const text = document.createElement('span');
  text.textContent = parts.content;
  if (extraClass) text.className = extraClass;
  return text;
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
const navFriends = byId('nav-friends');
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
const userSettingsModal = byId('user-settings-modal');
const dmModal = byId('dm-modal');
const serverRail = byId('server-rail');
const serverTitle = byId('server-title');
const serverIcon = byId('brand-icon');
const serverSettings = byId('server-settings');
const channelHeading = byId('channel-heading');
const newChannel = byId('new-channel');
const serverModal = byId('server-modal');
const channelModal = byId('channel-modal');
const settingsModal = byId('settings-modal');

let token = localStorage.getItem(TOKEN_KEY) || '';
let me = null;
let connected = false;
let servers = [];
let friends = [];
let activeServerId = null;
let serverMode = 'create';
let pendingServerIcon = '';
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

function activeServer() {
  return servers.find((server) => server.id === activeServerId) || null;
}

function activeChannels() {
  const server = activeServer();
  return server ? server.channels : [];
}

function myPermissions() {
  const server = activeServer();
  if (!server || !me) return [];
  if (server.owner === me.username.toLowerCase()) return ALL_PERMISSIONS;
  const role = server.roles.find((item) => item.id === server.myRoleId);
  return role ? role.permissions : [];
}

function hasPermission(permission) {
  return myPermissions().includes(permission);
}

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

function applyAppearance(profile) {
  if (!profile) return;
  document.body.dataset.theme = THEMES.includes(profile.theme) ? profile.theme : THEMES[0];
  document.body.classList.toggle('compact', !!profile.compact);
  const accent = COLORS.find((color) => color.value === profile.accent);
  document.documentElement.style.setProperty('--accent', accent ? accent.value : COLORS[0].value);
}

function onJoined(profile) {
  const firstJoin = !me;
  me = profile;
  applyAppearance(profile);
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
  renderServerRail();
  renderChannels();
  renderDMs();
  renderMembers();
  updateHeader();
  renderView();
  updateComposerState();
}

function makeServerButton(content, title, className, onClick, isIcon, isImage) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `server-icon ${className}`.trim();
  if (isImage) {
    const image = document.createElement('img');
    image.src = content;
    image.alt = '';
    image.className = 'server-image';
    button.append(image);
  } else if (isIcon) button.append(svgIcon(content));
  else button.textContent = content;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
}

function renderServerRail() {
  serverRail.replaceChildren();

  servers.forEach((server) => {
    const parts = serverIconParts(server.icon);
    serverRail.append(makeServerButton(
      parts.content,
      server.name,
      server.id === activeServerId ? 'active' : '',
      () => setServer(server.id),
      parts.isIcon,
      parts.isImage
    ));
  });

  serverRail.append(makeServerButton('plus', 'Add a server', 'add', openServerModal, true, false));
}

function setServer(serverId) {
  activeServerId = serverId;
  const server = activeServer();
  if (server && server.channels.length) setView('channel', server.channels[0].id);
  else setView('home');
}

function goHomeView(type) {
  activeServerId = null;
  setView(type);
}

function renderChannels() {
  channelList.replaceChildren();
  const server = activeServer();

  serverTitle.textContent = server ? server.name : 'Split Chat';
  serverIcon.replaceChildren();
  if (!server) serverIcon.append(svgIcon('message', 'logo-icon'));
  else serverIcon.append(serverIconElement(serverIconParts(server.icon), 'logo-icon'));
  channelHeading.textContent = server ? `${server.name} Channels` : 'Text Channels';
  serverSettings.classList.toggle('hidden', !server || (!hasPermission('manageRoles') && !hasPermission('manageServer')));
  newChannel.classList.toggle('hidden', !server || !hasPermission('manageChannels'));

  activeChannels().forEach((channel) => {
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

  if (server && !activeChannels().length) {
    const empty = document.createElement('li');
    empty.className = 'muted small-text';
    empty.textContent = 'No channels yet.';
    empty.style.padding = '8px';
    channelList.append(empty);
  }

  navHome.classList.toggle('active', view.type === 'home');
  navDms.classList.toggle('active', view.type === 'dms');
  navFriends.classList.toggle('active', view.type === 'friends');
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
  const server = activeServer();
  const list = server
    ? server.members.map((member) => {
        const online = members.find((profile) => profile.username.toLowerCase() === member.username.toLowerCase());
        const role = server.roles.find((item) => item.id === member.roleId);
        return {
          profile: online || {
            username: member.username,
            displayName: member.username,
            avatar: '👤',
            color: '#5865f2',
            status: 'offline'
          },
          role
        };
      })
    : members.map((profile) => ({ profile, role: null }));

  memberCountEl.textContent = list.length;
  membersEl.replaceChildren();
  list.forEach(({ profile, role }) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'member';

    const avatar = makeAvatar(profile, 'small');
    const text = document.createElement('span');
    text.className = 'member-text';
    const name = document.createElement('strong');
    name.textContent = profile.displayName;
    const detail = document.createElement('small');
    detail.textContent = role ? `@${profile.username} · ${role.name}` : `@${profile.username}`;
    text.append(name, detail);

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

function profileForUsername(username) {
  return members.find((member) => member.username.toLowerCase() === username.toLowerCase()) || {
    username,
    displayName: username,
    avatar: '👤',
    color: '#5865f2',
    status: 'offline'
  };
}

function makeFriendRow(entry, buttons) {
  const profile = profileForUsername(entry.username);
  const row = document.createElement('div');
  row.className = 'friend-row';
  row.append(makeAvatar(profile, 'small'));

  const text = document.createElement('span');
  text.className = 'friend-text';
  const name = document.createElement('strong');
  name.textContent = profile.displayName;
  const detail = document.createElement('small');
  detail.textContent = `@${entry.username} · ${STATUS_LABELS[profile.status] || 'Offline'}`;
  text.append(name, detail);
  row.append(text);

  if (buttons && buttons.length) {
    const actions = document.createElement('span');
    actions.className = 'friend-actions';
    buttons.forEach((button) => actions.append(button));
    row.append(actions);
  }
  return row;
}

function friendAction(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function friendRequest(path, username, errorEl) {
  errorEl.textContent = '';
  try {
    await api(path, { token, username });
    return true;
  } catch (error) {
    errorEl.textContent = error.message;
    return false;
  }
}

function renderFriendsHub() {
  const hub = document.createElement('div');
  hub.className = 'hub';

  const title = document.createElement('h2');
  title.textContent = 'Friends';
  const subtitle = document.createElement('p');
  subtitle.textContent = 'Add people by username, then chat or invite them to your servers.';
  hub.append(title, subtitle);

  const form = document.createElement('form');
  form.className = 'friend-add-form';
  const input = document.createElement('input');
  input.id = 'add-friend-input';
  input.maxLength = 20;
  input.placeholder = 'Enter a username';
  input.required = true;
  const addButton = document.createElement('button');
  addButton.type = 'submit';
  addButton.className = 'primary';
  addButton.textContent = 'Add Friend';
  form.append(input, addButton);
  const error = document.createElement('p');
  error.className = 'error';
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = input.value.trim();
    if (!username) return;
    const ok = await friendRequest('/api/friends/request', username, error);
    if (ok) {
      input.value = '';
      error.style.color = '#57f287';
      error.textContent = 'Friend request sent.';
      setTimeout(() => { error.textContent = ''; }, 1800);
    } else {
      error.style.color = '';
    }
  });
  hub.append(form, error);

  const incoming = friends.filter((item) => item.direction === 'incoming');
  if (incoming.length) {
    const heading = document.createElement('p');
    heading.className = 'hub-heading';
    heading.textContent = 'Friend Requests';
    hub.append(heading);
    incoming.forEach((entry) => {
      hub.append(makeFriendRow(entry, [
        friendAction('Accept', 'primary small-button', () => friendRequest('/api/friends/accept', entry.username, error)),
        friendAction('Decline', 'secondary small-button', () => friendRequest('/api/friends/remove', entry.username, error))
      ]));
    });
  }

  const outgoing = friends.filter((item) => item.direction === 'outgoing');
  if (outgoing.length) {
    const heading = document.createElement('p');
    heading.className = 'hub-heading';
    heading.textContent = 'Sent Requests';
    hub.append(heading);
    outgoing.forEach((entry) => {
      hub.append(makeFriendRow(entry, [
        friendAction('Cancel', 'secondary small-button', () => friendRequest('/api/friends/remove', entry.username, error))
      ]));
    });
  }

  const heading = document.createElement('p');
  heading.className = 'hub-heading';
  heading.textContent = 'Your Friends';
  hub.append(heading);

  const accepted = friends.filter((item) => item.direction === 'accepted');
  if (!accepted.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No friends yet. Add someone above to get started.';
    hub.append(empty);
  }
  accepted.forEach((entry) => {
    hub.append(makeFriendRow(entry, [
      friendAction('Message', 'secondary small-button', () => setView('dm', entry.username)),
      friendAction('Remove', 'secondary small-button', () => friendRequest('/api/friends/remove', entry.username, error))
    ]));
  });

  messagesEl.replaceChildren(hub);
  messagesEl.scrollTop = 0;
}

function renderHub() {
  const hub = document.createElement('div');
  hub.className = 'hub';

  const title = document.createElement('h2');
  title.textContent = view.type === 'home' ? `Welcome back, ${me.displayName}` : 'Direct Messages';
  const subtitle = document.createElement('p');
  subtitle.textContent = view.type === 'home'
    ? 'Jump into a server or catch up with your friends.'
    : 'Your conversations and everyone who is online.';
  hub.append(title, subtitle);

  if (view.type === 'home') {
    const serversGrid = document.createElement('div');
    serversGrid.className = 'hub-grid';
    if (!servers.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No servers yet. Click the + button on the left to create or join one.';
      serversGrid.append(empty);
    }
    servers.forEach((server) => {
      const icon = document.createElement('span');
      icon.className = 'channel-hash';
      const parts = serverIconParts(server.icon);
      if (parts.isIcon) icon.append(svgIcon(parts.content));
      else icon.textContent = parts.content;
      serversGrid.append(makeHubCard(
        server.name,
        `${server.channels.length} channel${server.channels.length === 1 ? '' : 's'}`,
        icon,
        () => setServer(server.id)
      ));
    });
    hub.append(serversGrid);
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
  const friendNames = new Set(friends
    .filter((item) => item.direction === 'accepted')
    .map((item) => item.username.toLowerCase()));
  const onlineFriends = members.filter((member) =>
    member.username.toLowerCase() !== me.username.toLowerCase() &&
    friendNames.has(member.username.toLowerCase()));
  if (!onlineFriends.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No friends online yet. Open Friends to add someone.';
    friendsGrid.append(empty);
  }
  onlineFriends.forEach((profile) => {
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
  reactButton.append(svgIcon('smile-plus'));
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
  if (view.type === 'friends') {
    renderFriendsHub();
    typingLine.textContent = '';
    return;
  }
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
    const channel = activeChannels().find((item) => item.id === view.id);
    const server = activeServer();
    title.textContent = `#${channel ? channel.name : 'channel'}`;
    topic.textContent = channel ? `${server ? server.name : ''} · ${channel.topic || 'No topic set'}` : '';
    messageInput.placeholder = hasPermission('sendMessages')
      ? `Message #${channel ? channel.name : 'channel'}`
      : 'You can only read here';
  } else if (view.type === 'dm') {
    title.textContent = `@${view.id}`;
    topic.textContent = `Direct message with ${displayNameOf(view.id)}`;
    messageInput.placeholder = `Message @${view.id}`;
  } else if (view.type === 'friends') {
    title.textContent = 'Friends';
    topic.textContent = 'Add friends and manage requests';
  } else {
    title.textContent = view.type === 'home' ? 'Home' : 'Direct Messages';
    topic.textContent = view.type === 'home' ? 'Your Split Chat dashboard' : 'Friends and conversations';
  }
}

function updateComposerState() {
  const canChat = canChatNow();
  chatForm.classList.toggle('hidden', view.type === 'home' || view.type === 'dms' || view.type === 'friends');
  messageInput.disabled = !canChat;
  sendButton.disabled = !canChat;
}

function setView(type, id) {
  clearLocalTyping();
  view = type === 'dm' || type === 'channel' ? { type, id } : { type };
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
  if (!connected || !me) return false;
  if (view.type === 'dm') return true;
  return view.type === 'channel' && hasPermission('sendMessages');
}

function renderTyping() {
  if (view.type === 'home' || view.type === 'dms' || view.type === 'friends') {
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

function openServerModal(mode = 'create') {
  setServerMode(mode);
  pendingServerIcon = '';
  byId('server-image').value = '';
  byId('server-image-preview').classList.add('hidden');
  serverModal.classList.remove('hidden');
  const focusId = mode === 'create' ? 'server-name' : 'join-server-id';
  setTimeout(() => byId(focusId).focus(), 0);
}

function setServerMode(mode) {
  serverMode = mode;
  byId('tab-create-server').classList.toggle('active', mode === 'create');
  byId('tab-join-server').classList.toggle('active', mode === 'join');
  byId('server-create-fields').classList.toggle('hidden', mode !== 'create');
  byId('server-join-fields').classList.toggle('hidden', mode !== 'join');
  byId('server-submit').textContent = mode === 'create' ? 'Create Server' : 'Join Server';
  byId('server-error').textContent = '';
}

function openChannelModal() {
  byId('channel-name').value = '';
  byId('channel-topic').value = '';
  byId('channel-error').textContent = '';
  channelModal.classList.remove('hidden');
  setTimeout(() => byId('channel-name').focus(), 0);
}

function openServerSettings() {
  const server = activeServer();
  if (!server || (!hasPermission('manageRoles') && !hasPermission('manageServer'))) return;
  byId('settings-title').textContent = `${server.name} Settings`;
  byId('server-id-line').textContent = `Invite ID: ${server.id}`;
  byId('role-error').textContent = '';
  byId('settings-error').textContent = '';
  renderSettings();
  settingsModal.classList.remove('hidden');
}

function renderSettings() {
  const server = activeServer();
  if (!server) return;

  const roleList = byId('role-list');
  roleList.replaceChildren();
  server.roles.forEach((role) => {
    const row = document.createElement('div');
    row.className = 'role-item';
    const dot = document.createElement('span');
    dot.className = 'role-dot';
    dot.style.backgroundColor = role.color;
    const name = document.createElement('strong');
    name.textContent = role.name;
    const summary = document.createElement('span');
    summary.className = 'role-permissions';
    summary.textContent = role.permissions.map((permission) => PERMISSION_LABELS[permission] || permission).join(', ');
    row.append(dot, name, summary);
    roleList.append(row);
  });

  const permissionBox = byId('role-permissions');
  if (!permissionBox.childElementCount) {
    ALL_PERMISSIONS.forEach((permission) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = permission;
      checkbox.dataset.permission = permission;
      label.append(checkbox, document.createTextNode(PERMISSION_LABELS[permission]));
      permissionBox.append(label);
    });
  }

  const memberBox = byId('settings-members');
  memberBox.replaceChildren();
  server.members.forEach((member) => {
    const row = document.createElement('div');
    row.className = 'settings-member';
    const name = document.createElement('strong');
    name.textContent = member.username;
    row.append(name);

    if (member.username === server.owner) {
      const owner = document.createElement('span');
      owner.className = 'muted small-text';
      owner.textContent = 'Owner';
      row.append(owner);
    } else {
      const select = document.createElement('select');
      server.roles.filter((role) => role.id !== 'owner').forEach((role) => {
        const option = document.createElement('option');
        option.value = role.id;
        option.textContent = role.name;
        select.append(option);
      });
      select.value = member.roleId;
      select.addEventListener('change', async () => {
        try {
          await api('/api/servers/assign', {
            token,
            serverId: server.id,
            username: member.username,
            roleId: select.value
          });
          byId('settings-error').textContent = '';
        } catch (error) {
          byId('settings-error').textContent = error.message;
          select.value = member.roleId;
        }
      });
      row.append(select);
    }
    memberBox.append(row);
  });
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

function setSettingsTab(tab) {
  const tabs = {
    profile: 'tab-profile-settings',
    appearance: 'tab-appearance-settings',
    account: 'tab-account-settings'
  };
  Object.entries(tabs).forEach(([name, id]) => byId(id).classList.toggle('active', name === tab));
  byId('edit-form').classList.toggle('hidden', tab !== 'profile');
  byId('appearance-form').classList.toggle('hidden', tab !== 'appearance');
  byId('account-tab').classList.toggle('hidden', tab !== 'account');
}

function openUserSettings(tab = 'profile') {
  if (!me) return;
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

  byId('theme-select').value = THEMES.includes(me.theme) ? me.theme : THEMES[0];
  byId('accent-select').value = COLORS.some((color) => color.value === me.accent)
    ? me.accent
    : COLORS[0].value;
  byId('compact-toggle').checked = !!me.compact;
  byId('appearance-error').textContent = '';
  byId('settings-username').textContent = `@${me.username}`;
  byId('logout-error').textContent = '';

  setSettingsTab(tab);
  userSettingsModal.classList.remove('hidden');
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
fillSelect(
  byId('server-icon-select'),
  SERVER_ICONS,
  SERVER_ICONS.map((name) => name[0].toUpperCase() + name.slice(1))
);
fillSelect(byId('role-color'), COLORS.map((color) => color.value), COLORS.map((color) => color.label));
fillSelect(byId('accent-select'), COLORS.map((color) => color.value), COLORS.map((color) => color.label));

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

byId('server-image').addEventListener('change', () => {
  handleImagePick(
    byId('server-image'),
    byId('server-image-preview'),
    (data) => { pendingServerIcon = data; },
    byId('server-error')
  );
});

byId('server-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = byId('server-error');
  const submitButton = byId('server-submit');
  const mode = serverMode;
  errorEl.textContent = '';
  if (!token) {
    errorEl.textContent = 'Please log in again.';
    return;
  }

  const name = byId('server-name').value.trim();
  const serverId = byId('join-server-id').value.trim();
  if (mode === 'create' && !name) {
    errorEl.textContent = 'Enter a server name.';
    return;
  }
  if (mode !== 'create' && !serverId) {
    errorEl.textContent = 'Enter a server ID.';
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = mode === 'create' ? 'Creating...' : 'Joining...';
  try {
    const data = mode === 'create'
      ? await api('/api/servers/create', {
          token,
          name,
          icon: pendingServerIcon || `i:${byId('server-icon-select').value || 'globe'}`
        })
      : await api('/api/servers/join', {
          token,
          serverId
        });
    activeServerId = data.server.id;
    serverModal.classList.add('hidden');
  } catch (error) {
    console.error('Server action failed:', error);
    errorEl.textContent = error.message || 'Something went wrong.';
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = mode === 'create' ? 'Create Server' : 'Join Server';
  }
});

byId('channel-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = byId('channel-error');
  errorEl.textContent = '';
  const server = activeServer();
  if (!server) return;
  try {
    const data = await api('/api/servers/channel', {
      token,
      serverId: server.id,
      name: byId('channel-name').value.trim(),
      topic: byId('channel-topic').value.trim()
    });
    channelModal.classList.add('hidden');
    setView('channel', data.channel.id);
  } catch (error) {
    errorEl.textContent = error.message;
  }
});

byId('role-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = byId('role-error');
  errorEl.textContent = '';
  const server = activeServer();
  if (!server) return;
  const permissions = [...byId('role-permissions').querySelectorAll('input:checked')]
    .map((checkbox) => checkbox.value);
  try {
    await api('/api/servers/role', {
      token,
      serverId: server.id,
      name: byId('role-name').value.trim(),
      color: byId('role-color').value,
      permissions
    });
    byId('role-name').value = '';
  } catch (error) {
    errorEl.textContent = error.message;
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

navHome.addEventListener('click', () => goHomeView('home'));
navDms.addEventListener('click', () => goHomeView('dms'));
navFriends.addEventListener('click', () => goHomeView('friends'));
serverSettings.addEventListener('click', openServerSettings);
newChannel.addEventListener('click', openChannelModal);

byId('tab-create-server').addEventListener('click', () => setServerMode('create'));
byId('tab-join-server').addEventListener('click', () => setServerMode('join'));
byId('copy-server-id').addEventListener('click', async () => {
  const server = activeServer();
  if (!server || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(server.id);
    byId('copy-server-id').textContent = 'Copied!';
    setTimeout(() => { byId('copy-server-id').textContent = 'Copy invite ID'; }, 1500);
  } catch (error) {
    byId('settings-error').textContent = 'Could not copy. Select the ID manually.';
  }
});

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
byId('user-settings').addEventListener('click', () => openUserSettings('profile'));

byId('tab-profile-settings').addEventListener('click', () => setSettingsTab('profile'));
byId('tab-appearance-settings').addEventListener('click', () => setSettingsTab('appearance'));
byId('tab-account-settings').addEventListener('click', () => setSettingsTab('account'));

byId('profile-message').addEventListener('click', () => {
  profileModal.classList.add('hidden');
  setView('dm', selectedProfile.username);
});

byId('profile-edit').addEventListener('click', () => {
  profileModal.classList.add('hidden');
  openUserSettings('profile');
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
    applyAppearance(me);
    userSettingsModal.classList.add('hidden');
  } catch (error) {
    errorEl.textContent = error.message;
  }
});

byId('appearance-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const errorEl = byId('appearance-error');
  errorEl.textContent = '';
  try {
    const data = await api('/api/profile', {
      token,
      profile: {
        theme: byId('theme-select').value,
        accent: byId('accent-select').value,
        compact: byId('compact-toggle').checked
      }
    });
    me = data.profile;
    applyAppearance(me);
    errorEl.style.color = '#57f287';
    errorEl.textContent = 'Appearance saved.';
    setTimeout(() => { errorEl.textContent = ''; }, 1800);
  } catch (error) {
    errorEl.style.color = '';
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

async function logout() {
  try {
    await api('/api/logout', { token });
  } catch (error) {
    console.error(error);
  }
  token = '';
  me = null;
  connected = false;
  servers = [];
  friends = [];
  activeServerId = null;
  view = { type: 'home' };
  localStorage.removeItem(TOKEN_KEY);
  userSettingsModal.classList.add('hidden');
  socket.disconnect();
  socket.connect();
  showAuth();
}

byId('settings-logout').addEventListener('click', logout);

document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => byId(button.dataset.close).classList.add('hidden'));
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    [profileModal, userSettingsModal, dmModal, serverModal, channelModal, settingsModal, emojiPicker, reactionPicker]
      .forEach((element) => element.classList.add('hidden'));
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

socket.on('session:replaced', () => {
  token = '';
  me = null;
  localStorage.removeItem(TOKEN_KEY);
  socket.disconnect();
  showAuth('This account was opened in another tab. Log in again to continue here.');
});

socket.on('init', (data) => {
  servers = data.servers || [];
  friends = data.friends || [];
  messagesByChannel = data.messages || {};
  conversations = data.conversations || {};
  members = data.members || [];
  dmNames = new Set(Object.keys(conversations));
  unread.clear();
  if (!activeServerId || !servers.some((server) => server.id === activeServerId)) {
    activeServerId = servers.length ? servers[0].id : null;
  }
  if (view.type === 'channel' && !activeChannels().some((channel) => channel.id === view.id)) {
    view = { type: 'home' };
  }
  if (me) renderAll();
});

socket.on('servers:update', (list) => {
  servers = list || [];
  if (activeServerId && !servers.some((server) => server.id === activeServerId)) activeServerId = null;
  if (view.type === 'channel' && !activeChannels().some((channel) => channel.id === view.id)) {
    view = { type: 'home' };
  }
  if (me) renderAll();
  if (!settingsModal.classList.contains('hidden')) renderSettings();
});

socket.on('friends:update', (list) => {
  friends = list || [];
  if (me) renderAll();
});

socket.on('message:error', (message) => {
  typingLine.textContent = message;
  setTimeout(renderTyping, 3000);
});

socket.on('members', (list) => {
  members = list;
  renderMembers();
  renderDMs();
  if (me && (view.type === 'home' || view.type === 'dms' || view.type === 'friends')) renderView();
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
  if (view.type === 'home' || view.type === 'dms' || view.type === 'friends') renderView();
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
    applyAppearance(me);
  }
});
