# Local AI Assistant Jarvis

A local Windows voice assistant built with Express and a browser-based speech interface. It can answer questions through Groq, control selected media and volume keys, open YouTube in Chrome, search YouTube for songs, and run a few built-in local commands.

## Requirements

- Node.js 18 or later
- Windows for local media, volume, sleep, and Chrome-launch actions
- A Groq API key for AI answers
- A YouTube Data API v3 key for song search
- Google Chrome installed in a standard Windows location for YouTube launching

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in the API keys:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Start the app:

   ```powershell
   npm start
   ```

4. Open <http://localhost:3000> in a supported browser and allow microphone access.

Never commit `.env` or share its API keys.

## Local actions

Device actions are limited to predefined commands in the server. The server binds to localhost and does not expose a general-purpose shell endpoint. Review `server.js` before enabling the app on any machine.
