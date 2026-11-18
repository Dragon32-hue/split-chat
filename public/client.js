const socket = io();

const joinScreen = document.getElementById('join-screen');
const chatScreen = document.getElementById('chat-screen');
const joinForm = document.getElementById('join-form');
const usernameInput = document.getElementById('username');
const joinError = document.getElementById('join-error');
const myName = document.getElementById('my-name');
const statusEl = document.getElementById('status');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const usersEl = document.getElementById('users');
const userCountEl = document.getElementById('user-count');

let myUsername = '';

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function addMessage(message) {
  const item = document.createElement('li');
  item.className = 'message';
  if (message.name === myUsername) item.classList.add('mine');

  const meta = document.createElement('div');
  meta.className = 'meta';

  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = message.name;

  const time = document.createElement('span');
  time.textContent = formatTime(message.time);

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = message.text;

  meta.append(name, time);
  item.append(meta, text);
  messagesEl.append(item);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

joinForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = usernameInput.value.trim();
  if (!name) return;

  joinError.textContent = '';
  socket.emit('join', name, (result) => {
    if (!result.ok) {
      joinError.textContent = result.error;
      return;
    }
    myUsername = name;
    myName.textContent = name;
    joinScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
  });
});

chatForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  socket.emit('chat message', text);
  messageInput.value = '';
  messageInput.focus();
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
  if (myUsername) {
    socket.emit('join', myUsername);
    messageInput.disabled = false;
    sendButton.disabled = false;
  }
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected - reconnecting...';
  messageInput.disabled = true;
  sendButton.disabled = true;
});

socket.on('history', (history) => {
  messagesEl.replaceChildren();
  history.forEach(addMessage);
});

socket.on('chat message', addMessage);

socket.on('user list', (names) => {
  usersEl.replaceChildren();
  names.forEach((name) => {
    const item = document.createElement('li');
    item.textContent = name;
    usersEl.append(item);
  });
  userCountEl.textContent = names.length;
});
