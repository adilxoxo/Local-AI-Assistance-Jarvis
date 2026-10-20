const orb = document.getElementById('orb');
const log = document.getElementById('log');
const synth = window.speechSynthesis;
const status = document.getElementById('status');
const examples = document.getElementById('examples');
const appShell = document.querySelector('.app-shell');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const AWAKE_TIMEOUT_MS = 15000;
const LISTENING_IDLE_TIMEOUT_MS = 30000;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
} else {
  status.textContent = 'Voice recognition is not supported in this browser.';
}

let listening = false;
let recognitionStarting = false;
let voiceEnabled = false;
let awake = false;
let voicePaused = false;
let processingCommand = false;
let speaking = false;
let recognitionRestartTimer = 0;
let awakeTimer = 0;
let listeningIdleTimer = 0;
let audioDuckToken = '';
let audioDuckPromise = null;
let audioRestorePromise = null;

orb.addEventListener('click', () => {
  if (!recognition) return;

  if (!voiceEnabled) {
    setVoiceEnabled(true);
    startRecognition();
  } else if (voicePaused) {
    voicePaused = false;
    setAwake(false);
    status.textContent = 'Listening for “Hey Jarvis.”';
    startRecognition();
  } else {
    setVoiceEnabled(false);
    status.textContent = 'Voice listening is off.';
  }
});

orb.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    orb.click();
  }
});

if (recognition) {
  recognition.onstart = () => {
    recognitionStarting = false;
    listening = true;
    if (!voiceEnabled || voicePaused) {
      recognition.stop();
      return;
    }
    log.hidden = false;
    orb.classList.add('listening');
    status.textContent = awake
      ? 'Jarvis is awake for 15 seconds. Listening stops after 30 seconds without a command.'
      : 'Say “Hey Jarvis” to wake Jarvis. Listening stops after 30 seconds without a command.';
  };

  recognition.onend = () => {
    recognitionStarting = false;
    listening = false;
    orb.classList.remove('listening');
    if (voiceEnabled && !voicePaused) {
      window.clearTimeout(recognitionRestartTimer);
      recognitionRestartTimer = window.setTimeout(startRecognition, 250);
    }
  };

  recognition.onresult = (event) => {
    if (voicePaused || processingCommand || speaking) return;

    const result = event.results[event.results.length - 1];
    if (!result.isFinal) return;
    const transcript = result[0].transcript.trim();
    if (!transcript) return;
    const wakePhrase = /^hey\s+jarvis\b[\s,]*/i;
    const wakeMatch = transcript.match(wakePhrase);
    if (!awake && !wakeMatch) return;
    if (wakeMatch) lowerSystemVolumeForWake();

    const command = transcript.replace(wakePhrase, '')
      .replace(/^[.!?\s,]+|[.!?\s,]+$/g, '')
      .trim();
    if (!command) {
      if (!awake) {
        setAwake(true);
        status.textContent = 'Jarvis is awake. Speak a command within 15 seconds.';
      }
      return;
    }

    window.clearTimeout(listeningIdleTimer);
    setAwake(true, false);
    addLine('You: ' + transcript);
    handleCommand(command);
  };

  recognition.onerror = (event) => {
    status.textContent = event.error === 'not-allowed'
      ? 'Microphone access was denied. Allow microphone access in your browser settings.'
      : `Voice recognition error: ${event.error}.`;
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      setVoiceEnabled(false);
    }
  };
}

function setVoiceEnabled(enabled) {
  voiceEnabled = enabled;
  if (!enabled) {
    window.clearTimeout(recognitionRestartTimer);
    window.clearTimeout(awakeTimer);
    window.clearTimeout(listeningIdleTimer);
    awake = false;
    restoreSystemVolume();
    if (listening) recognition.stop();
  } else {
    resetListeningIdleTimeout();
  }
  orb.setAttribute('aria-pressed', String(enabled));
  examples.hidden = enabled;
  appShell.classList.toggle('assistant-active', enabled);
  if (!enabled) log.hidden = true;
}

function resetListeningIdleTimeout() {
  window.clearTimeout(listeningIdleTimer);
  if (!voiceEnabled) return;
  listeningIdleTimer = window.setTimeout(() => {
    setVoiceEnabled(false);
    status.textContent = 'Listening stopped after 30 seconds without a command. Click the orb to start listening again.';
  }, LISTENING_IDLE_TIMEOUT_MS);
}

function setAwake(enabled, startTimer = true) {
  awake = enabled;
  window.clearTimeout(awakeTimer);
  if (awake && startTimer && voiceEnabled) {
    awakeTimer = window.setTimeout(() => {
      awake = false;
      status.textContent = 'Listening for “Hey Jarvis.” Say the wake phrase to give another command.';
      restoreSystemVolume();
    }, AWAKE_TIMEOUT_MS);
  }
}

function lowerSystemVolumeForWake() {
  if (audioDuckToken || audioDuckPromise) return audioDuckPromise;
  audioDuckPromise = (async () => {
    try {
      const response = await fetch('/device-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'audioDuck' })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || `Request failed (${response.status}).`);
      if (typeof data.token !== 'string' || !data.token) {
        throw new Error('The server did not return a volume restore token.');
      }
      audioDuckToken = data.token;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error.';
      status.textContent = `Could not lower system volume: ${message}`;
      console.error('Could not temporarily lower system volume:', error);
    } finally {
      audioDuckPromise = null;
    }
  })();
  return audioDuckPromise;
}

async function restoreSystemVolume() {
  if (audioRestorePromise) return audioRestorePromise;
  audioRestorePromise = (async () => {
    if (audioDuckPromise) await audioDuckPromise;
    if (!audioDuckToken) return;

    try {
      const response = await fetch('/device-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'audioRestore', token: audioDuckToken })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.reply || `Request failed (${response.status}).`);
      audioDuckToken = '';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error.';
      status.textContent = `Could not restore system volume: ${message}`;
      console.error('Could not restore system volume:', error);
    }
  })();
  await audioRestorePromise;
  audioRestorePromise = null;
}

function startRecognition() {
  if (!recognition || !voiceEnabled || voicePaused || listening || recognitionStarting) return;
  try {
    recognitionStarting = true;
    recognition.start();
  } catch (error) {
    recognitionStarting = false;
    setVoiceEnabled(false);
    status.textContent = 'Could not start voice recognition. Check microphone permissions and try again.';
    console.error('Could not start speech recognition:', error);
  }
}

function pauseRecognition() {
  if (!recognition || !voiceEnabled) return;
  voicePaused = true;
  if (listening) recognition.stop();
}

function resumeRecognition() {
  if (!recognition || !voiceEnabled) return;
  voicePaused = false;
  if (listening) {
    recognition.stop();
  } else {
    startRecognition();
  }
}

async function handleCommand(command) {
  if (processingCommand) return;
  processingCommand = true;
  pauseRecognition();

  const cleanedCommand = command.trim()
    .replace(/[.!?]+$/, '')
    .replace(/^hey\s+jarvis\b[\s,]*/i, '')
    .replace(/^(?:can you|could you|would you|please)\s+/i, '')
    .replace(/\s+please$/i, '')
    .trim();
  const normalizedCommand = cleanedCommand.toLowerCase();
  if (/^(?:what can you do(?: locally)?|what tasks? (?:can you perform|you can perform|can you do)(?: locally)?|list (?:your )?(?:local )?features|help(?: me)?)$/i.test(normalizedCommand)) {
    const capabilities = [
      '• Tell the current time and date',
      '• Do simple arithmetic',
      '• Open websites',
      '• Search YouTube for a song and open it in Chrome',
      '• Play or pause music in Chrome and control other media playback',
      '• Turn volume up or down, mute, or unmute',
      '• Put this PC to sleep',
      '• Answer general questions using the configured AI service'
    ].join('\n');
    addLine('Jarvis: ' + capabilities);
    status.textContent = 'Listed local features.';
    speak('I can tell the time and date, do simple arithmetic, open websites, find songs on YouTube, control media and volume, put this PC to sleep, and answer general questions using the configured AI service.');
    return;
  }

  if (/^(?:what time is it|what is the time|tell me the time)$/i.test(normalizedCommand)) {
    const reply = `It's ${new Date().toLocaleTimeString()}.`;
    addLine('Jarvis: ' + reply);
    status.textContent = 'Ready.';
    speak(reply);
    return;
  }

  if (/^(?:what(?:'s| is) the date|what date is it|what day is it|tell me the date|today(?:'s)? date)$/i.test(normalizedCommand)) {
    const reply = `Today is ${new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
    addLine('Jarvis: ' + reply);
    status.textContent = 'Ready.';
    speak(reply);
    return;
  }

  const calculation = normalizedCommand.match(/^(?:(?:what is|calculate|compute|how much is)\s+)?(-?\d+(?:\.\d+)?)\s*(plus|\+|minus|−|-|times|multiplied by|x|×|divided by|over|\/|÷)\s*(-?\d+(?:\.\d+)?)$/i);
  if (calculation) {
    const left = Number(calculation[1]);
    const operator = calculation[2];
    const right = Number(calculation[3]);
    const operation = operator === 'plus' || operator === '+' ? (a, b) => a + b
      : operator === 'minus' || operator === '−' || operator === '-' ? (a, b) => a - b
        : ['times', 'multiplied by', 'x', '×'].includes(operator) ? (a, b) => a * b
          : (a, b) => a / b;
    if ((operator === 'divided by' || operator === 'over' || operator === '/' || operator === '÷') && right === 0) {
      const reply = 'You cannot divide by zero.';
      addLine('Jarvis: ' + reply);
      status.textContent = reply;
      speak(reply);
      return;
    }
    const answer = operation(left, right);
    const reply = `${left} ${operator} ${right} is ${Number(answer.toPrecision(10))}.`;
    addLine('Jarvis: ' + reply);
    status.textContent = reply;
    speak(reply);
    return;
  }

  const deviceCommands = [
    {
      action: 'mediaPlay',
      label: 'play Chrome music',
      pattern: /^(?:play|resume)(?:\s+(?:(?:the\s+)?(?:chrome\s+)?(?:music|media|audio|playback)|(?:the\s+)?music\s+(?:in|on)\s+chrome))$/
    },
    {
      action: 'mediaPause',
      label: 'pause Chrome music',
      pattern: /^(?:pause|stop)(?:\s+(?:(?:the\s+)?(?:chrome\s+)?(?:music|media|audio|playback)|(?:the\s+)?music\s+(?:in|on)\s+chrome))$/
    },
    {
      action: 'mediaPlayPause',
      label: 'send the media play/pause key',
      pattern: /^(?:toggle|play pause|play and pause|play\/pause|toggle playback)(?:\s+(?:the\s+)?(?:music|media|playback))?$/
    },
    {
      action: 'mediaNext',
      label: 'skip to the next track',
      pattern: /^(?:next|next track|skip|skip track)$/
    },
    {
      action: 'mediaPrevious',
      label: 'go to the previous track',
      pattern: /^(?:previous|previous track|last track|go back)$/
    },
    {
      action: 'volumeUp',
      label: 'raise the system volume one step',
      pattern: /^(?:volume up|turn (?:the )?volume up|turn up (?:the )?volume|raise (?:the )?volume|increase (?:the )?volume|make (?:the )?volume louder)$/
    },
    {
      action: 'volumeDown',
      label: 'lower the system volume one step',
      pattern: /^(?:volume down|turn (?:the )?volume down|turn down (?:the )?volume|lower (?:the )?volume|decrease (?:the )?volume|make (?:the )?volume quieter)$/
    },
    {
      action: 'volumeMute',
      label: 'toggle system mute',
      pattern: /^(?:mute|mute (?:the )?volume|silence|toggle mute|unmute|unmute (?:the )?volume|turn (?:the )?sound on|restore (?:the )?sound)$/
    },
    {
      action: 'sleep',
      label: 'put this PC to sleep',
      pattern: /^(?:sleep|sleep pc|sleep computer|put (?:the )?(?:pc|computer) to sleep)$/
    }
  ];
  const deviceCommand = deviceCommands.find(({ pattern }) => pattern.test(normalizedCommand));
  if (deviceCommand) {
    await runDeviceAction(deviceCommand.action, deviceCommand.label);
    return;
  }

  if (normalizedCommand.startsWith('play ')) {
    let song = cleanedCommand.slice('play '.length).replace(/\s+on youtube$/i, '').trim();
    song = song.replace(/^(?:this\s+)?song(?:\s+(?:called|named|with))?\s+/i, '').trim();
    if (song && song.toLowerCase() !== 'this song') {
      await findAndPlayYoutubeSong(song);
      return;
    }
  }

  if (/^open youtube(?:\.com)?$/i.test(normalizedCommand)) {
    await runDeviceAction('openYoutube', 'open YouTube');
    return;
  }

  if (cleanedCommand.toLowerCase().startsWith('open ')) {
    const site = cleanedCommand.slice('open '.length).trim();
    window.open(`https://${site}.com`, '_blank');
    speak(`Opening ${site}`);
    status.textContent = 'Ready.';
    return;
  }

  status.textContent = 'Thinking...';
  try {
    const res = await fetch('/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: cleanedCommand })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.reply || `Request failed (${res.status}).`);
    addLine('Jarvis: ' + data.reply);
    status.textContent = 'Ready.';
    speak(data.reply);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    status.textContent = `Jarvis could not respond: ${message}`;
    addLine('Jarvis: ' + message);
    console.error('Jarvis request failed:', error);
    finishCommand();
  }
}

async function findAndPlayYoutubeSong(song) {
  status.textContent = `Finding "${song}" on YouTube...`;
  try {
    const searchResponse = await fetch('/device-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'youtubeFind', query: song })
    });
    const match = await searchResponse.json();
    if (!searchResponse.ok) throw new Error(match.reply || `Search failed (${searchResponse.status}).`);

    status.textContent = 'Opening the selected YouTube video...';
    const playResponse = await fetch('/device-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'youtubeOpen', videoId: match.videoId })
    });
    const result = await playResponse.json();
    if (!playResponse.ok) throw new Error(result.reply || `Could not open video (${playResponse.status}).`);
    const title = match.channel ? `"${match.title}" by ${match.channel}` : `"${match.title}"`;
    addLine(`Jarvis: Playing ${title} on YouTube.`);
    setAwake(false);
    await finishCommand();
    status.textContent = `Playing ${title} on YouTube. Listening for “Hey Jarvis.”`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    status.textContent = `Could not play the song: ${message}`;
    addLine('Jarvis: ' + message);
    console.error('YouTube playback failed:', error);
    finishCommand();
  }
}

async function runDeviceAction(action, description, details = {}) {
  status.textContent = `Performing action: ${description}...`;
  try {
    const res = await fetch('/device-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...details })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.reply || `Request failed (${res.status}).`);
    const mediaResponses = {
      mediaPlay: 'Toggled playback in the active media player.',
      mediaPause: 'Toggled playback in the active media player.',
      mediaPlayPause: 'Toggled media playback.',
      mediaNext: 'Skipped to the next track.',
      mediaPrevious: 'Returned to the previous track.',
      volumeUp: 'Turned the volume up.',
      volumeDown: 'Turned the volume down.',
      volumeMute: 'Toggled mute.'
    };
    const reply = mediaResponses[action] || data.reply;
    addLine('Jarvis: ' + reply);
    status.textContent = reply;
    if (['mediaPlay', 'mediaPause', 'mediaPlayPause'].includes(action)) {
      setAwake(false);
      status.textContent = `${reply} Listening for “Hey Jarvis.”`;
      await finishCommand();
    } else if (action.startsWith('media') || action.startsWith('volume')) {
      finishCommand();
    } else {
      speak(reply);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    status.textContent = `Device action failed: ${message}`;
    addLine('Jarvis: ' + message);
    console.error('Device action failed:', error);
    finishCommand();
  }
}

function speak(text) {
  if (!synth || !('SpeechSynthesisUtterance' in window)) {
    finishCommand();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  let speechFinished = false;
  const onSpeechFinished = () => {
    if (speechFinished) return;
    speechFinished = true;
    speaking = false;
    window.setTimeout(finishCommand, 600);
  };
  utterance.onstart = () => {
    speaking = true;
  };
  utterance.onend = onSpeechFinished;
  utterance.onerror = onSpeechFinished;
  synth.cancel();
  speaking = true;
  synth.speak(utterance);
}

async function finishCommand() {
  processingCommand = false;
  if (awake) setAwake(true);
  await restoreSystemVolume();
  resetListeningIdleTimeout();
  resumeRecognition();
}

function addLine(text) {
  const isUser = text.startsWith('You: ');
  const message = document.createElement('p');
  message.className = `message ${isUser ? 'message-user' : 'message-assistant'}`;
  message.textContent = text.replace(/^(?:You|Jarvis):\s*/, '');
  log.append(message);
  log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });
}

if (recognition) {
  setVoiceEnabled(true);
  status.textContent = 'Starting wake listening... Allow microphone access, then say “Hey Jarvis.”';
  startRecognition();
}
