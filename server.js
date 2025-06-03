const express = require('express');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback to index.html for SPA routes or default landing
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server — BIND TO 0.0.0.0 for Render
app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Serving files from: ${path.join(__dirname, 'public')}`);
});


const axios = require('axios');
const qs = require('querystring');

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'https://pll-timer-server.onrender.com/oauth2callback';

app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code;

    try {
        const { data } = await axios.post(
            'https://oauth2.googleapis.com/token',
            qs.stringify({
                code,
                client_id: CLIENT_ID,
                client_secret: CLIENT_SECRET,
                redirect_uri: REDIRECT_URI,
                grant_type: 'authorization_code'
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );

        const accessToken = data.access_token;
        const refreshToken = data.refresh_token;

        res.redirect(`/loggedin.html?access_token=${accessToken}`);
    } catch (error) {
        console.error('OAuth Error:', error.response?.data || error.message);
        res.status(500).send('OAuth failed');
    }
});
