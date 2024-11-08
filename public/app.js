const apiUrl = "https://chatify-mtpv.onrender.com"; // Replace with your backend's URL

const messagesDiv = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const resetBtn = document.getElementById('reset-btn');
const spotifyLoginBtn = document.getElementById('spotify-login-btn');
const cors = require('cors');
app.use(cors({ origin: 'https://chatify4o.netlify.app' })); // Adjust the Netlify URL accordingly

let spotifyData = {}; // To store all Spotify data

// Append message to chat
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

// Fetch Spotify data
async function fetchSpotifyData() {
  try {
    const endpoints = [
      { key: 'userProfile', url: '/api/spotify/user-profile' },
      { key: 'topArtists', url: '/api/spotify/top-artists' },
      { key: 'topTracks', url: '/api/spotify/top-tracks' },
      { key: 'playlists', url: '/api/spotify/playlists' },
      { key: 'recentlyPlayed', url: '/api/spotify/recently-played' },
      { key: 'followedArtists', url: '/api/spotify/followed-artists' },
      { key: 'savedAlbums', url: '/api/spotify/saved-albums' },
    ];

    const requests = endpoints.map((endpoint) =>
      fetch(apiUrl + endpoint.url).then((res) => res.json())
    );

    const responses = await Promise.all(requests);
    endpoints.forEach((endpoint, index) => {
      spotifyData[endpoint.key] = responses[index];
    });

    console.log('Fetched Spotify data:', spotifyData);
    appendMessage('System', 'Spotify data loaded. You can now ask for personalized information!', 'system');
  } catch (error) {
    console.error('Error fetching Spotify data:', error);
    appendMessage('System', 'Failed to load Spotify data. Please try logging in again.', 'system');
  }
}

// Send message to chatbot
async function sendMessage() {
    const message = userInput.value.trim();
    if (message) {
      appendMessage('You', message, 'user');
      userInput.value = '';
  
      console.log('Sending spotifyData:', spotifyData); // Log spotifyData before sending
  
      try {
        const response = await fetch(apiUrl + '/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            spotifyData, // Send all Spotify data to the chatbot
          }),
        });
        
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
  fetch(apiUrl + '/api/reset', { method: 'POST' })
    .then(() => {
      messagesDiv.innerHTML = '';
      appendMessage('System', 'Conversation has been reset.', 'system');
    })
    .catch((err) => console.error('Error:', err));
});

// Spotify login button click handler
spotifyLoginBtn.addEventListener('click', () => {
    const apiUrl = "https://chatify-mtpv.onrender.com"; // Backend URL
});

// Load Spotify data if already logged in
window.onload = async function () {
  try {
    await fetchSpotifyData(); // Load all Spotify data on page load
  } catch (error) {
    console.log("User not logged in yet or error loading data.");
  }
};

// Send button click handler
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});
