// server.js

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// CORS configuration
app.use(cors({
  origin: ['https://chatify4o.netlify.app', 'https://chatify4o.netlify.app/'], // Include both with and without trailing slash
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(cookieParser());

// Define the redirect URI
const redirectUri = 'https://chatify-mtpv.onrender.com/callback'; // Ensure this matches exactly with the one in your Spotify app settings

// Generate a random string for the state parameter
function generateRandomString(length) {
  return crypto.randomBytes(length).toString('hex');
}

// Spotify Login Endpoint
app.get('/login', (req, res) => {
  const state = generateRandomString(16);

  // Store the state in a cookie with updated settings
  res.cookie('spotify_auth_state', state, {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: 3600000, // 1 hour expiry
  });

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

  // Get the state from the cookie
  const storedState = req.cookies.spotify_auth_state || null;
  res.clearCookie('spotify_auth_state'); // Clear the cookie after using it

  if (state === null || state !== storedState) {
    res.redirect(
      'https://chatify4o.netlify.app/#' + new URLSearchParams({ error: 'state_mismatch' }).toString()
    );
    return;
  }

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

    // Update cookie settings for all tokens
    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'None',
      path: '/',
      maxAge: 3600000, // 1 hour expiry
    };

    res.cookie('spotify_access_token', access_token, cookieOptions);
    res.cookie('spotify_refresh_token', refresh_token, cookieOptions);
    res.cookie('spotify_token_expires_at', Date.now() + expires_in * 1000, cookieOptions);

    res.redirect('https://chatify4o.netlify.app'); // Redirect to frontend after login
  } catch (error) {
    console.error('Error exchanging code for token:', error.response?.data || error);
    res.redirect('https://chatify4o.netlify.app/#' + new URLSearchParams({ error: 'invalid_token' }).toString());
  }
});

// Middleware to refresh access token if expired
async function refreshSpotifyAccessToken(req, res, next) {
  const expiresAt = req.cookies.spotify_token_expires_at;
  if (Date.now() > expiresAt) {
    try {
      const refreshResponse = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: req.cookies.spotify_refresh_token,
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

      res.cookie('spotify_access_token', access_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      });
      res.cookie('spotify_token_expires_at', Date.now() + expires_in * 1000, {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
      });

      next();
    } catch (error) {
      console.error('Error refreshing access token:', error.response?.data || error);
      res.status(401).json({ error: 'Failed to refresh Spotify access token' });
    }
  } else {
    next();
  }
}

// Middleware to ensure user is authenticated with Spotify
function ensureSpotifyAuthenticated(req, res, next) {
  if (req.cookies.spotify_access_token) {
    refreshSpotifyAccessToken(req, res, next);
  } else {
    res.status(401).json({ error: 'User not authenticated with Spotify' });
  }
}

// OpenAI Chatbot Endpoint
app.post('/api/chat', ensureSpotifyAuthenticated, async (req, res) => {
  const userMessage = req.body.message;

  // Initialize conversation history if it doesn't exist
  if (!req.session) {
    req.session = {};
  }
  if (!req.session.conversation) {
    req.session.conversation = [];
  }

  // Add user's message to the conversation history
  req.session.conversation.push({ role: 'user', content: userMessage });

  try {
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
  } catch (error) {
    console.error('Error:', error.response?.data || error);
    res.status(500).send('An error occurred while processing your request.');
  }
});

// Endpoint to reset the conversation
app.post('/api/reset', (req, res) => {
  if (req.session) {
    req.session.conversation = [];
  }
  res.send('Conversation reset.');
});

// Fetch user's Spotify profile
app.get('/api/user-profile', ensureSpotifyAuthenticated, async (req, res) => {
  const accessToken = req.cookies.spotify_access_token;

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
