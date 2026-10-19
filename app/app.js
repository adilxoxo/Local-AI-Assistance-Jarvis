const orb = document.getElementById('orb');
const log = document.getElementById('log');
const synth = window.speechSynthesis;
const status = document.getElementById('status');
const examples = document.getElementById('examples');
const appShell = document.querySelector('.app-shell');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const recognition = SpeechRecognition ? new SpeechRecognition() : null;
if (recognition) {
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
} else {
  status.textContent = 'Voice recognition is not supported in this browser.';
}

let listening = false;
let voiceEnabled = false;
let voicePaused = false;
let restartOnEnd = false;
let processingCommand = false;
let speaking = false;

orb.addEventListener('click', () => {
  if (!recognition) return;

  if (!voiceEnabled) {
    voiceEnabled = true;
    examples.hidden = true;
    appShell.classList.add('assistant-active');
    startRecognition();
  } else {
    voiceEnabled = false;
    voicePaused = false;
    restartOnEnd = false;
    if (listening) recognition.stop();
    log.hidden = true;
    examples.hidden = false;
    appShell.classList.remove('assistant-active');
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
    listening = true;
    log.hidden = false;
    orb.classList.add('listening');
    status.textContent = 'Listening... Speak your request.';
  };

  recognition.onend = () => {
    listening = false;
    orb.classList.remove('listening');
    if (restartOnEnd && voiceEnabled && !voicePaused) {
      restartOnEnd = false;
      startRecognition();
    } else if (!voicePaused && voiceEnabled) {
      voiceEnabled = false;
      log.hidden = true;
      examples.hidden = false;
      appShell.classList.remove('assistant-active');
      status.textContent = 'Voice recognition stopped. Click the orb to try again.';
    }
  };

  recognition.onresult = (event) => {
    if (voicePaused || processingCommand || speaking) return;

    const transcript = event.results[event.results.length - 1][0].transcript.trim();
    if (!transcript) return;
    addLine('You: ' + transcript);
    handleCommand(transcript);
  };

  recognition.onerror = (event) => {
    status.textContent = event.error === 'not-allowed'
      ? 'Microphone access was denied. Allow microphone access in your browser settings.'
      : `Voice recognition error: ${event.error}.`;
    console.error('Speech recognition error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      voiceEnabled = false;
      log.hidden = true;
      examples.hidden = false;
      appShell.classList.remove('assistant-active');
    }
  };
}

function startRecognition() {
  if (!recognition || !voiceEnabled || voicePaused || listening) return;
  try {
    recognition.start();
  } catch (error) {
    voiceEnabled = false;
    log.hidden = true;
    examples.hidden = false;
    appShell.classList.remove('assistant-active');
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
    restartOnEnd = true;
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
    .replace(/^(?:(?:hey|okay|ok)\s+)?jarvis[,\s]+/i, '')
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
      '• Play/pause media and skip to the next or previous track',
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
      action: 'mediaPlayPause',
      label: 'send the media play/pause key',
      pattern: /^(?:toggle|play|pause|resume|play pause|play and pause|play\/pause|toggle playback)(?:\s+(?:the\s+)?(?:music|media|playback))?$/
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

  if (command.startsWith('open ')) {
    const site = command.replace('open ', '').trim();
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
      body: JSON.stringify({ message: command })
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
    status.textContent = `Playing ${title} on YouTube.`;
    speak(`Playing ${match.title}.`);
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
    if (action.startsWith('media') || action.startsWith('volume')) {
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
  synth.speak(utterance);
}

function finishCommand() {
  processingCommand = false;
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
