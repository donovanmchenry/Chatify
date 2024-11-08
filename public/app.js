// app.js

const apiUrl = 'https://chatify-mtpv.onrender.com'; // Replace with your backend's URL

const messagesDiv = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const resetBtn = document.getElementById('reset-btn');
const spotifyLoginBtn = document.getElementById('spotify-login-btn');

let spotifyData = {}; // To store all Spotify data

// Function to append messages to the chat window
function appendMessage(sender, text, className) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${className}`;
  const messageContent = document.createElement('div');
  messageContent.className = 'message-content';
  messageContent.innerHTML = text.replace(/\n/g, '<br>');
  messageDiv.appendChild(messageContent);
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Update fetch options
const fetchOptions = {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
};

// Update Spotify login handler
spotifyLoginBtn.addEventListener('click', (e) => {
  e.preventDefault();
  window.location.href = `${apiUrl}/login`;
});

// Update fetchSpotifyData function
async function fetchSpotifyData() {
  try {
    const response = await fetch(`${apiUrl}/api/user-profile`, fetchOptions);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    spotifyData['userProfile'] = data;
    console.log('Fetched Spotify data:', spotifyData);
    appendMessage('System', 'Spotify data loaded. You can now ask for personalized information!', 'system');
  } catch (error) {
    console.error('Error fetching Spotify data:', error);
    if (error.message.includes('401')) {
      appendMessage('System', 'Please log in with Spotify to continue.', 'system');
    } else {
      appendMessage('System', 'Failed to load Spotify data. Please try again.', 'system');
    }
  }
}

// Send message to chatbot
async function sendMessage() {
  const message = userInput.value.trim();
  if (message) {
    appendMessage('You', message, 'user');
    userInput.value = '';

    try {
      const response = await fetch(apiUrl + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies in the request
        body: JSON.stringify({ message }),
      });

      if (response.status === 401) {
        // User is not authenticated
        appendMessage('System', 'Please log in with Spotify to use this feature.', 'system');
        return;
      }

      const data = await response.json();
      if (data) {
        appendMessage('Bot', data.reply, 'bot');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      appendMessage('System', 'Failed to get a response from the chatbot.', 'system');
    }
  }
}

// Reset conversation
resetBtn.addEventListener('click', () => {
  fetch(apiUrl + '/api/reset', {
    method: 'POST',
    credentials: 'include',
  })
    .then(() => {
      messagesDiv.innerHTML = '';
      appendMessage('System', 'Conversation has been reset.', 'system');
    })
    .catch((err) => console.error('Error:', err));
});

// Load Spotify data if already logged in
window.onload = async function () {
  try {
    await fetchSpotifyData(); // Load all Spotify data on page load
  } catch (error) {
    console.log('User not logged in yet or error loading data.');
  }
};

// Send message when the send button is clicked
sendBtn.addEventListener('click', sendMessage);

// Allow sending message by pressing Enter key
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    sendMessage();
  }
});
