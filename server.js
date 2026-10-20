require('dotenv').config();
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const app = express();
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const PORT = 3000;
const execFileAsync = promisify(execFile);
const activeAudioDucks = new Map();
const deviceActions = Object.freeze({
  mediaPlay: '[JarvoDeviceActions]::SendMediaKey(179)',
  mediaPause: '[JarvoDeviceActions]::SendMediaKey(179)',
  mediaPlayPause: '[JarvoDeviceActions]::SendMediaKey(179)',
  mediaNext: '[JarvoDeviceActions]::SendMediaKey(176)',
  mediaPrevious: '[JarvoDeviceActions]::SendMediaKey(177)',
  volumeUp: '[JarvoDeviceActions]::SendMediaKey(175)',
  volumeDown: '[JarvoDeviceActions]::SendMediaKey(174)',
  volumeMute: '[JarvoDeviceActions]::SendMediaKey(173)',
  sleep: '[JarvoDeviceActions]::Sleep()'
});

const audioEndpointTypes = `
using System;
using System.Runtime.InteropServices;

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject { }

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, int classContext, IntPtr activationParams, [MarshalAs(UnmanagedType.Interface)] out IAudioEndpointVolume endpoint);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
    [PreserveSig] int GetId(out IntPtr id);
    [PreserveSig] int GetState(out int state);
}

[ComImport]
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid eventContext);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid eventContext);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid eventContext);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
    [PreserveSig] int VolumeStepUp(ref Guid eventContext);
    [PreserveSig] int VolumeStepDown(ref Guid eventContext);
    [PreserveSig] int QueryHardwareSupport(out uint hardwareSupportMask);
    [PreserveSig] int GetVolumeRange(out float min, out float max, out float increment);
}

public static class JarvoAudioEndpoint
{
    private static IAudioEndpointVolume GetEndpoint()
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
        var iid = typeof(IAudioEndpointVolume).GUID;
        IAudioEndpointVolume endpoint;
        Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out endpoint));
        return endpoint;
    }

    public static float GetVolume()
    {
        float level;
        Marshal.ThrowExceptionForHR(GetEndpoint().GetMasterVolumeLevelScalar(out level));
        return level;
    }

    public static void SetVolume(float level)
    {
        if (level < 0f || level > 1f) throw new ArgumentOutOfRangeException("level");
        var eventContext = Guid.Empty;
        Marshal.ThrowExceptionForHR(GetEndpoint().SetMasterVolumeLevelScalar(level, ref eventContext));
    }
}
`;

async function runAudioEndpointScript(command) {
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${audioEndpointTypes}
'@
${command}
`;
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    timeout: 10000
  });
  return stdout.trim();
}

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

  if (action === 'audioDuck') {
    try {
      const existing = activeAudioDucks.entries().next().value;
      if (existing) return res.json({ token: existing[0], reply: 'System volume is already lowered.' });

      const originalVolume = Number(await runAudioEndpointScript('[JarvoAudioEndpoint]::GetVolume()'));
      if (!Number.isFinite(originalVolume) || originalVolume < 0 || originalVolume > 1) {
        throw new Error('Windows returned an invalid master volume level.');
      }
      const loweredVolume = originalVolume * 0.5;
      await runAudioEndpointScript(`[JarvoAudioEndpoint]::SetVolume([single]${loweredVolume.toFixed(6)})`);
      const token = randomUUID();
      activeAudioDucks.set(token, { originalVolume, loweredVolume });
      return res.json({ token, reply: 'System volume lowered temporarily.' });
    } catch (err) {
      console.error('Could not temporarily lower system volume:', err);
      return res.status(500).json({ reply: 'Could not lower system volume for listening.' });
    }
  }

  if (action === 'audioRestore') {
    const token = typeof req.body.token === 'string' ? req.body.token : '';
    const duckedVolume = activeAudioDucks.get(token);
    if (!duckedVolume) {
      return res.status(404).json({ reply: 'There is no matching temporary volume change to restore.' });
    }

    try {
      const currentVolume = Number(await runAudioEndpointScript('[JarvoAudioEndpoint]::GetVolume()'));
      const unchanged = Math.abs(currentVolume - duckedVolume.loweredVolume) < 0.005;
      if (unchanged) {
        await runAudioEndpointScript(`[JarvoAudioEndpoint]::SetVolume([single]${duckedVolume.originalVolume.toFixed(6)})`);
      }
      activeAudioDucks.delete(token);
      return res.json({
        reply: unchanged
          ? 'Restored the original system volume.'
          : 'The system volume was changed manually, so it was left as-is.'
      });
    } catch (err) {
      console.error('Could not restore system volume:', err);
      return res.status(500).json({ reply: 'Could not restore the original system volume.' });
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