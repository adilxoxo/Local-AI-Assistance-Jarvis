require('dotenv').config();
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const app = express();
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const PORT = 3000;
const execFileAsync = promisify(execFile);
const deviceActions = Object.freeze({
  mediaPlayPause: '[JarvoDeviceActions]::SendMediaKey(179)',
  mediaNext: '[JarvoDeviceActions]::SendMediaKey(176)',
  mediaPrevious: '[JarvoDeviceActions]::SendMediaKey(177)',
  volumeUp: '[JarvoDeviceActions]::SendMediaKey(175)',
  volumeDown: '[JarvoDeviceActions]::SendMediaKey(174)',
  volumeMute: '[JarvoDeviceActions]::SendMediaKey(173)',
  sleep: '[JarvoDeviceActions]::Sleep()'
});

function findChromePath() {
  const chromePaths = [
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
  ].filter(Boolean);
  return chromePaths.find((candidate) => fs.existsSync(candidate));
}

async function openInChrome(url) {
  const chromePath = findChromePath();
  if (!chromePath) {
    const error = new Error('Google Chrome was not found in its standard Windows install locations.');
    error.status = 404;
    throw error;
  }

  await new Promise((resolve, reject) => {
    const chrome = spawn(chromePath, [url], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    chrome.once('error', reject);
    chrome.once('spawn', () => {
      chrome.unref();
      resolve();
    });
  });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'app')));

app.get('/ask', (req, res) => {
  res.status(405).json({ error: 'Use POST /ask with a JSON body containing a message.' });
});

app.post('/device-action', async (req, res) => {
  if (process.platform !== 'win32') {
    return res.status(501).json({ reply: 'Local device actions are currently supported only on Windows.' });
  }

  const origin = req.get('origin');
  if (origin) {
    let originUrl;
    try {
      originUrl = new URL(origin);
    } catch {
      return res.status(403).json({ reply: 'Device actions are allowed only from this local app.' });
    }
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(originUrl.hostname) ||
      originUrl.port !== String(PORT) ||
      originUrl.protocol !== 'http:'
    ) {
      return res.status(403).json({ reply: 'Device actions are allowed only from this local app.' });
    }
  }

  const { action } = req.body || {};
  if (action === 'youtubeFind') {
    const query = typeof req.body.query === 'string' ? req.body.query.trim() : '';
    if (!query || query.length > 200) {
      return res.status(400).json({ reply: 'Provide a song title of 1 to 200 characters.' });
    }

    if (!process.env.YOUTUBE_API_KEY) {
      return res.status(503).json({ reply: 'Set YOUTUBE_API_KEY in your .env file to find and play the requested song.' });
    }

    try {
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      searchUrl.search = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoCategoryId: '10',
        maxResults: '1',
        q: query,
        key: process.env.YOUTUBE_API_KEY
      });
      const searchResponse = await fetch(searchUrl);
      const searchData = await searchResponse.json();
      if (!searchResponse.ok) {
        console.error('YouTube search failed:', searchResponse.status, searchData.error?.message || searchData);
        return res.status(502).json({ reply: 'YouTube could not find the song. Check the API key and server terminal.' });
      }

      const video = searchData.items?.find((item) => typeof item.id?.videoId === 'string');
      if (!video) {
        return res.status(404).json({ reply: `No YouTube music video found for "${query}".` });
      }

      const title = video.snippet?.title || query;
      return res.json({
        reply: 'Found a matching YouTube result.',
        videoId: video.id.videoId,
        title,
        channel: video.snippet?.channelTitle || ''
      });
    } catch (err) {
      console.error('YouTube search failed:', err);
      return res.status(502).json({ reply: 'Could not search YouTube. Check the server terminal for details.' });
    }
  }

  if (action === 'youtubeOpen') {
    const videoId = typeof req.body.videoId === 'string' ? req.body.videoId : '';
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      return res.status(400).json({ reply: 'The selected YouTube video ID is invalid.' });
    }

    const videoUrl = new URL('https://www.youtube.com/watch');
    videoUrl.search = new URLSearchParams({ v: videoId, autoplay: '1' });
    try {
      await openInChrome(videoUrl.toString());
      return res.json({ reply: 'Opening the selected YouTube video in Chrome.' });
    } catch (err) {
      console.error('Could not open YouTube in Chrome:', err);
      return res.status(err.status || 500).json({ reply: err.message || 'Could not launch Chrome. Check the server terminal for details.' });
    }
  }

  if (action === 'openYoutube') {
    try {
      await openInChrome('https://www.youtube.com/');
      return res.json({ reply: 'Opening YouTube in Chrome.' });
    } catch (err) {
      console.error('Could not open YouTube in Chrome:', err);
      return res.status(err.status || 500).json({ reply: err.message || 'Could not launch Chrome. Check the server terminal for details.' });
    }
  }

  const powershellAction = deviceActions[action];
  if (!powershellAction) {
    return res.status(400).json({ reply: 'That device action is not allowed.' });
  }

  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.ComponentModel;

public static class JarvoDeviceActions
{
    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput
    {
        public uint Message;
        public ushort ParameterLow;
        public ushort ParameterHigh;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KeyboardInput Keyboard;
        [FieldOffset(0)] public MouseInput Mouse;
        [FieldOffset(0)] public HardwareInput Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public InputUnion Union;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, Input[] inputs, int size);

    [DllImport("powrprof.dll", SetLastError = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

    public static bool SendMediaKey(ushort key)
    {
        var inputs = new Input[2];
        inputs[0].Type = 1;
        inputs[0].Union.Keyboard.VirtualKey = key;
        inputs[0].Union.Keyboard.Flags = 1;
        inputs[1].Type = 1;
        inputs[1].Union.Keyboard.VirtualKey = key;
        inputs[1].Union.Keyboard.Flags = 3;
        var sent = SendInput(2, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != 2)
        {
            throw new Win32Exception(
                Marshal.GetLastWin32Error(),
                "Windows accepted " + sent + " of 2 media-key events (virtual key " + key + ").");
        }
        return true;
    }

    public static bool Sleep()
    {
        return SetSuspendState(false, false, false);
    }
}
'@
$success = ${powershellAction}
if (-not $success) {
  throw "Windows could not perform the requested action. Error: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
`;

  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 10000
    });
    console.log('Local device action completed:', action);
    res.json({ reply: 'Action completed.' });
  } catch (err) {
    console.error('Local device action failed:', err);
    res.status(500).json({ reply: 'Windows could not perform that action. Check the server terminal for details.' });
  }
});

app.post('/ask', async (req, res) => {
  const { message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ reply: 'Please provide a message.' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ reply: 'Set GROQ_API_KEY in your .env file to enable AI replies.' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: 'You are Jarvis, a concise, witty voice assistant. Keep replies short and conversational since they will be spoken aloud.'
          },
          { role: 'user', content: message.trim() }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Groq API request failed:', response.status, data.error?.message || data);
      return res.status(502).json({ reply: 'The AI provider could not complete the request. Check the server log for details.' });
    }

    const reply = data.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) {
      console.error('Groq API returned no message content.');
      return res.status(502).json({ reply: 'The AI provider returned an empty reply.' });
    }

    res.json({ reply });
  } catch (err) {
    console.error('Groq API request failed:', err);
    res.status(502).json({ reply: 'Could not connect to the AI provider. Check the server log for details.' });
  }
});

app.listen(PORT, 'localhost', () => console.log(`Jarvis running at http://localhost:${PORT}`));