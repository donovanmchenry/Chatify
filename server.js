// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Session configuration
app.use(
  session({
    secret: 'your_secret_key', // Replace with a strong secret in production
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // Set to true if using HTTPS
  })
);

// Define the redirect URI
const redirectUri = 'https://chatify-mtpv.onrender.com/callback'; // Ensure this matches exactly with the one in your Spotify app settings

// Generate a random string for the state parameter
function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex');
}

// Spotify Login Endpoint
app.get('/login', (req, res) => {
  const state = generateRandomString(16);
  req.session.spotifyAuthState = state;

  const scope = 'user-read-private user-read-email user-top-read';

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.SPOTIFY_CLIENT_ID,
    scope: scope,
    redirect_uri: redirectUri,
    state: state,
  });

  res.redirect('https://accounts.spotify.com/authorize?' + params.toString());
});

// Spotify Callback Endpoint
app.get('/callback', async (req, res) => {
  const code = req.query.code || null;
  const state = req.query.state || null;
  const storedState = req.session.spotifyAuthState || null;

  if (state === null || state !== storedState) {
    res.redirect(
      '/#' + new URLSearchParams({ error: 'state_mismatch' }).toString()
    );
    return;
  }

  req.session.spotifyAuthState = null; // Clear stored state

  try {
    const tokenResponse = await axios.post(
      'https://accounts.spotify.com/api/token',
      new URLSearchParams({
        code: code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization:
            'Basic ' +
            Buffer.from(
              process.env.SPOTIFY_CLIENT_ID +
                ':' +
                process.env.SPOTIFY_CLIENT_SECRET
            ).toString('base64'),
        },
      }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Store tokens and expiration in session
    req.session.spotifyAccessToken = access_token;
    req.session.spotifyRefreshToken = refresh_token;
    req.session.spotifyTokenExpiresAt = Date.now() + expires_in * 1000;

    res.redirect('/'); // Redirect to homepage
  } catch (error) {
    console.error('Error exchanging code for token:', error.response?.data || error);
    res.redirect('/#' + new URLSearchParams({ error: 'invalid_token' }).toString());
  }
});

// Middleware to refresh access token if expired
async function refreshSpotifyAccessToken(req, res, next) {
  if (Date.now() > req.session.spotifyTokenExpiresAt) {
    try {
      const refreshResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: req.session.spotifyRefreshToken,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Authorization:
              'Basic ' +
              Buffer.from(
                process.env.SPOTIFY_CLIENT_ID +
                  ':' +
                  process.env.SPOTIFY_CLIENT_SECRET
              ).toString('base64'),
          },
        }
      );

      const { access_token, expires_in } = refreshResponse.data;

      req.session.spotifyAccessToken = access_token;
      req.session.spotifyTokenExpiresAt = Date.now() + expires_in * 1000;

      next();
    } catch (error) {
      console.error('Error refreshing access token:', error.response?.data || error);
      res.redirect('/login');
    }
  } else {
    next();
  }
}

// Middleware to ensure user is authenticated with Spotify
function ensureSpotifyAuthenticated(req, res, next) {
  if (req.session.spotifyAccessToken) {
    refreshSpotifyAccessToken(req, res, next);
  } else {
    res.redirect('/login');
  }
}

// OpenAI Chatbot Endpoint
app.post('/api/chat', ensureSpotifyAuthenticated, async (req, res) => {
  const userMessage = req.body.message;

  // Initialize conversation history if it doesn't exist
  if (!req.session.conversation) {
    req.session.conversation = [];
  }

  // Add user's message to the conversation history
  req.session.conversation.push({ role: 'user', content: userMessage });

  try {
    // Check if the user's message is requesting music recommendations
    const isAskingForMusicRecommendation = /recommend.*music|suggest.*song|music recommendation|what should I listen to|any song suggestions|recommend me some songs|recommend me some music|songs.*I.*might.*enjoy.*based.*on.*(my.*likes|my.*listening.*history)|what.*songs.*would.*I.*like/i.test(
        userMessage.toLowerCase()
    );

    if (isAskingForMusicRecommendation) {
      console.log('User is asking for music recommendations.');

      // Fetch personalized recommendations from Spotify
      const recommendations = await getPersonalizedRecommendations(req);

      // Log the recommendations
      console.log('Personalized Recommendations:', recommendations);

      // Assistant's reply (send directly without OpenAI)
      const assistantMessage = recommendations;

      // Add assistant's response to the conversation history
      req.session.conversation.push({ role: 'assistant', content: assistantMessage });

      res.json({ reply: assistantMessage });
    } else {
      // Get response from OpenAI API
      const openaiResponse = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-3.5-turbo',
          messages: req.session.conversation,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          },
        }
      );

      const assistantMessage = openaiResponse.data.choices[0].message.content;

      // Add assistant's response to the conversation history
      req.session.conversation.push({ role: 'assistant', content: assistantMessage });

      res.json({ reply: assistantMessage });
    }
  } catch (error) {
    console.error('Error:', error.response?.data || error);
    res.status(500).send('An error occurred while processing your request.');
  }
});

// Function to fetch personalized recommendations
async function getPersonalizedRecommendations(req) {
  const accessToken = req.session.spotifyAccessToken;
  console.log('Access Token:', accessToken);
  console.log('Token Expires At:', new Date(req.session.spotifyTokenExpiresAt));

  try {
    // Get user's top artists and tracks
    const [topArtists, topTracks] = await Promise.all([
      axios.get('https://api.spotify.com/v1/me/top/artists', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 2, time_range: 'long_term' },
      }),
      axios.get('https://api.spotify.com/v1/me/top/tracks', {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: { limit: 2, time_range: 'long_term' },
      }),
    ]);

    // Log the top artists and tracks after they are fetched
    console.log('Top Artists Response:', topArtists.data);
    console.log('Top Tracks Response:', topTracks.data);

    // Check if we have enough data to seed recommendations
    const artistIds = topArtists.data.items.map((artist) => artist.id);
    const trackIds = topTracks.data.items.map((track) => track.id);

    if (artistIds.length === 0 && trackIds.length === 0) {
      console.log('No top artists or tracks found for the user.');
      return 'It seems like you haven\'t listened to enough music on Spotify for me to provide personalized recommendations. Please listen to more music and try again later.';
    }

    // Get personalized recommendations
    const recommendationsResponse = await axios.get(
      'https://api.spotify.com/v1/recommendations',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          seed_artists: artistIds.join(','),
          seed_tracks: trackIds.join(','),
          limit: 5,
        },
      }
    );

    // Log the recommendations
    console.log('Recommendations Response:', recommendationsResponse.data);

    // Format the recommendations
    const tracks = recommendationsResponse.data.tracks;
    let recommendations = 'Based on your Spotify listening history, here are some songs you might enjoy:\n\n';
    tracks.forEach((track, index) => {
      recommendations += `${index + 1}. "${track.name}" by ${track.artists
        .map((artist) => artist.name)
        .join(', ')}\n`;
    });

    return recommendations;
  } catch (error) {
    console.error('Error fetching recommendations:', error.response?.data || error);
    return 'Sorry, I couldn\'t fetch your music recommendations at this time.';
  }
}

// Endpoint to reset the conversation
app.post('/api/reset', (req, res) => {
  req.session.conversation = [];
  res.send('Conversation reset.');
});

// Fetch user's Spotify profile
app.get('/api/user-profile', ensureSpotifyAuthenticated, async (req, res) => {
  const accessToken = req.session.spotifyAccessToken;

  try {
    const profileResponse = await axios.get('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    res.json({ user: profileResponse.data });
  } catch (error) {
    console.error('Error fetching user profile:', error.response?.data || error);
    res.status(500).send('Error fetching user profile');
  }
});

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
