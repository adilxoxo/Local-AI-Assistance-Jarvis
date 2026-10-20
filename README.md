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

4. Open <http://localhost:3000> in a supported browser and allow microphone access. Jarvis listens for “Hey Jarvis” to wake; while awake, issue commands without repeating the wake phrase. It returns to wake-only listening after 15 seconds and fully stops listening after 30 seconds without a command; click the orb to start listening again. When woken, system volume is temporarily reduced by half so Jarvis can hear you, then restored after it responds or the awake window expires. If you adjust system volume while it is lowered, Jarvis leaves your new level unchanged. After launching YouTube music or issuing a play/pause command, it automatically returns to wake-only listening to avoid acting on lyrics.

Never commit `.env` or share its API keys.

## Local actions

Device actions are limited to predefined commands in the server. Say “play Chrome music” or “pause Chrome music” to send the Windows media play/pause toggle to the active Windows media player (for example, Chrome when it owns the active media session). These phrases toggle playback state. The server binds to localhost and does not expose a general-purpose shell endpoint. Review `server.js` before enabling the app on any machine.
