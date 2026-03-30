/* =========================================================
   AudioGen — Script
   ========================================================= */

'use strict';

// ── Config ──────────────────────────────────────────────
const API_ENDPOINT  = 'https://audiobook-api-ezfwd4b3h5a8d2b7.centralus-01.azurewebsites.net/api/GenerateAudio';
const SEEK_SECS     = 10;
const WF_BARS       = 72;   // waveform bar count
const WORDS_PER_MIN = 150;  // avg reading speed for TTS estimate

// ── State ───────────────────────────────────────────────
let audioEl  = null;
let blobURL  = null;
let muted    = false;
let prevVol  = 1;

// ── Init ────────────────────────────────────────────────
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  audioEl = $('audioEl');
  buildEmptyWaveform();
  buildWaveform();
  initCharCounter();
  initKeyboard();
  bindAudioEvents();
});

// ─────────────────────────────────────────────────────────
// Empty state decorative waveform
// ─────────────────────────────────────────────────────────
function buildEmptyWaveform() {
  const container = $('emptyWave');
  if (!container) return;
  const heights = [14,28,40,22,48,32,18,44,26,36,50,20,38,30,10,16,42,34,24,46,12,52,28,36];
  heights.forEach(h => {
    const bar = document.createElement('div');
    bar.className = 'ewb';
    bar.style.height = h + 'px';
    container.appendChild(bar);
  });
}

// ─────────────────────────────────────────────────────────
// Waveform (the SoundCloud-style seek bar)
// ─────────────────────────────────────────────────────────
function buildWaveform() {
  const wf = $('waveform');
  if (!wf) return;
  wf.innerHTML = '';
  for (let i = 0; i < WF_BARS; i++) {
    const bar = document.createElement('div');
    bar.className = 'wf-bar';
    // Pseudo-random height — weighted to look natural (more mid-range bars)
    const r = Math.random();
    const h = r < 0.2
      ? 6  + Math.floor(Math.random() * 10)   // short bars
      : r < 0.7
        ? 16 + Math.floor(Math.random() * 26)  // mid bars
        : 36 + Math.floor(Math.random() * 16); // tall bars
    bar.style.height = h + 'px';
    bar.dataset.idx  = i;
    wf.appendChild(bar);
  }
}

function syncWaveform(pct) {
  const bars       = $('waveform').querySelectorAll('.wf-bar');
  const playedIdx  = Math.floor(pct / 100 * bars.length);
  bars.forEach((bar, i) => {
    bar.classList.toggle('played', i < playedIdx);
    bar.classList.remove('ahead');
  });
}

// ─────────────────────────────────────────────────────────
// Character counter + estimated duration
// ─────────────────────────────────────────────────────────
function initCharCounter() {
  const ta  = $('textInput');
  const pill = $('charCount');
  const dur  = $('estDur');

  ta.addEventListener('input', () => {
    const n     = ta.value.length;
    const words = ta.value.trim().split(/\s+/).filter(Boolean).length;
    const mins  = Math.max(0, (words / WORDS_PER_MIN)).toFixed(1);

    // Character pill
    pill.textContent = n.toLocaleString();
    pill.className   = 'char-pill' + (n > 8000 ? ' limit' : n > 5000 ? ' warn' : '');

    // Estimated audio duration
    if (words < 5) {
      dur.textContent = '≈ 0 min audio';
    } else if (parseFloat(mins) < 1) {
      dur.textContent = `≈ ${Math.round(parseFloat(mins) * 60)} sec audio`;
    } else {
      dur.textContent = `≈ ${mins} min audio`;
    }

    if (n > 0) hideErr();
  });
}

// ─────────────────────────────────────────────────────────
// Extract a track title from input text
// ─────────────────────────────────────────────────────────
function extractTitle(text) {
  const clean = text.trim().replace(/\s+/g, ' ');
  const words = clean.split(' ');
  const title = words.slice(0, 6).join(' ');
  return title.length > 40 ? title.slice(0, 38) + '…' : title || 'Generated Audiobook';
}

// ─────────────────────────────────────────────────────────
// Keyboard shortcuts
// ─────────────────────────────────────────────────────────
function initKeyboard() {
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      generateAudio();
      return;
    }

    const tag = document.activeElement.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') return;
    if (!$('playerUI') || $('playerUI').hidden) return;

    switch (e.code) {
      case 'Space':       e.preventDefault(); togglePlay();    break;
      case 'ArrowLeft':   e.preventDefault(); rewindAudio();   break;
      case 'ArrowRight':  e.preventDefault(); forwardAudio();  break;
    }
  });
}

// ─────────────────────────────────────────────────────────
// Audio element events
// ─────────────────────────────────────────────────────────
function bindAudioEvents() {
  audioEl.addEventListener('timeupdate', onTimeUpdate);
  audioEl.addEventListener('play',       () => setPlayState(true));
  audioEl.addEventListener('pause',      () => setPlayState(false));
  audioEl.addEventListener('ended',      onEnded);
  audioEl.addEventListener('error',      onAudioError);
}

// ─────────────────────────────────────────────────────────
// Core: Generate Audio
// ─────────────────────────────────────────────────────────
async function generateAudio() {
  const text = $('textInput').value.trim();

  if (!text) {
    showErr('Please enter some text before generating.');
    $('textInput').focus();
    return;
  }
  if (text.length < 10) {
    showErr('Please enter at least 10 characters to generate audio.');
    $('textInput').focus();
    return;
  }

  hideErr();
  setLoading(true);
  $('trackTitle').textContent = extractTitle(text);

  try {
    const res = await fetch(API_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text }),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `Server error (HTTP ${res.status})`);
    }

    const blob = await resolveBlob(res);
    loadAudio(blob);

  } catch (err) {
    setLoading(false);
    const isNet = err instanceof TypeError && /fetch|network|failed/i.test(err.message);
    showErr(isNet
      ? 'Unable to reach the server. Check your connection and try again.'
      : err.message || 'Something went wrong. Please try again.');
  }
}

// Handles: direct audio blob, JSON { audioUrl }, JSON { audioBase64 }
async function resolveBlob(res) {
  const ct = res.headers.get('Content-Type') || '';

  if (/^audio\//.test(ct)) return res.blob();

  if (/application\/json/.test(ct)) {
    const data = await res.json();
    if (data.audioUrl) {
      return (await fetch(data.audioUrl)).blob();
    }
    if (data.audioBase64) {
      const bin = atob(data.audioBase64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      return new Blob([buf], { type: data.mimeType || 'audio/mpeg' });
    }
    throw new Error('Unexpected response format from server.');
  }

  return res.blob(); // fallback
}

// ─────────────────────────────────────────────────────────
// Load audio blob into the player
// ─────────────────────────────────────────────────────────
function loadAudio(blob) {
  if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }
  blobURL     = URL.createObjectURL(blob);
  audioEl.src = blobURL;

  audioEl.onloadedmetadata = () => {
    $('timeTotal').textContent = fmtTime(audioEl.duration);
    buildWaveform();           // fresh random waveform for this track
    setLoading(false);
    showPlayer();
    audioEl.play().catch(() => {}); // autoplay (may be blocked)
  };

  $('btnDownload').onclick = () => {
    const a = Object.assign(document.createElement('a'), {
      href:     blobURL,
      download: `audiogen-${Date.now()}.mp3`,
    });
    a.click();
  };
}

// ─────────────────────────────────────────────────────────
// Playback controls
// ─────────────────────────────────────────────────────────
function togglePlay() {
  if (!audioEl.src) return;
  audioEl.paused ? audioEl.play() : audioEl.pause();
}

function rewindAudio() {
  if (!audioEl.src) return;
  audioEl.currentTime = Math.max(0, audioEl.currentTime - SEEK_SECS);
}

function forwardAudio() {
  if (!audioEl.src) return;
  audioEl.currentTime = Math.min(audioEl.duration || 0, audioEl.currentTime + SEEK_SECS);
}

function setSpeed(speed, btn) {
  audioEl.playbackRate = speed;
  document.querySelectorAll('.sp').forEach(b => b.classList.remove('sp-on'));
  btn.classList.add('sp-on');
}

function setVolume(val) {
  const v = parseFloat(val);
  audioEl.volume = v;
  muted = v === 0;
  syncVolUI(v);
}

function toggleMute() {
  if (muted) {
    audioEl.volume       = prevVol || 1;
    $('volSlider').value = audioEl.volume;
    syncVolUI(audioEl.volume);
    muted = false;
  } else {
    prevVol              = audioEl.volume;
    audioEl.volume       = 0;
    $('volSlider').value = 0;
    syncVolUI(0);
    muted = true;
  }
}

function syncVolUI(val) {
  const pct = (val * 100).toFixed(1);
  $('volSlider').style.background =
    `linear-gradient(to right,var(--violet) ${pct}%,var(--surface-3) ${pct}%)`;
  $('icoVol').style.display  = val === 0 ? 'none' : '';
  $('icoMute').style.display = val === 0 ? ''     : 'none';
}

// ─────────────────────────────────────────────────────────
// Waveform click-to-seek
// ─────────────────────────────────────────────────────────
function onWfClick(e) {
  if (!audioEl.duration) return;
  const rect = $('waveform').getBoundingClientRect();
  const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audioEl.currentTime = pct * audioEl.duration;
}

function onWfKey(e) {
  if (e.key === 'ArrowLeft')  { e.preventDefault(); rewindAudio();  }
  if (e.key === 'ArrowRight') { e.preventDefault(); forwardAudio(); }
}

// ─────────────────────────────────────────────────────────
// Time update → waveform + timestamps
// ─────────────────────────────────────────────────────────
function onTimeUpdate() {
  if (!audioEl.duration) return;
  const pct = (audioEl.currentTime / audioEl.duration) * 100;
  syncWaveform(pct);
  $('timeCurrent').textContent = fmtTime(audioEl.currentTime);
  $('waveform').setAttribute('aria-valuenow', Math.round(pct));
}

// ─────────────────────────────────────────────────────────
// Play state
// ─────────────────────────────────────────────────────────
function setPlayState(playing) {
  $('icoPlay').style.display  = playing ? 'none' : '';
  $('icoPause').style.display = playing ? ''     : 'none';
  $('btnPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function onEnded() {
  setPlayState(false);
  syncWaveform(100); // fill all bars to show completion
}

function onAudioError() {
  setLoading(false);
  showErr('Failed to load the generated audio. Please try again.');
}

// ─────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────
function resetGenerator() {
  audioEl.pause();
  audioEl.src = '';
  if (blobURL) { URL.revokeObjectURL(blobURL); blobURL = null; }

  setPlayState(false);
  syncWaveform(0);
  buildWaveform(); // rebuild clean waveform

  $('timeCurrent').textContent   = '0:00';
  $('timeTotal').textContent     = '0:00';
  $('volSlider').value           = '1';
  audioEl.volume                 = 1;
  audioEl.playbackRate           = 1;
  muted = false;
  syncVolUI(1);

  document.querySelectorAll('.sp').forEach((b, i) =>
    b.classList.toggle('sp-on', i === 1)
  );

  showEmpty();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  setTimeout(() => $('textInput').focus(), 400);
}

// ─────────────────────────────────────────────────────────
// UI state helpers
// ─────────────────────────────────────────────────────────
function setLoading(on) {
  $('generateBtn').disabled = on;
  $('emptyState').hidden    = on;
  $('loadingWrap').hidden   = !on;
  $('playerUI').hidden      = true; // hide player while loading
}

function showPlayer() {
  $('loadingWrap').hidden = true;
  $('emptyState').hidden  = true;
  $('playerUI').hidden    = false;
}

function showEmpty() {
  $('loadingWrap').hidden = true;
  $('playerUI').hidden    = true;
  $('emptyState').hidden  = false;
}

function showErr(msg) {
  const el = $('errBar');
  $('errMsg').textContent = msg;
  el.hidden = true;
  requestAnimationFrame(() => { el.hidden = false; });
}

function hideErr() { $('errBar').hidden = true; }

// ─────────────────────────────────────────────────────────
// Utility
// ─────────────────────────────────────────────────────────
function fmtTime(s) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}
