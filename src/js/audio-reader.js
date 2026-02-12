/**
 * audio-reader.js — Text-to-speech audio reader using Web Speech API
 *
 * Provides play/pause controls, speed adjustment, voice selection,
 * and sentence-level highlighting that syncs with speech output.
 */

// ==========================================
// STATE
// ==========================================

let isPlaying = false;
let isPaused = false;
let sentences = [];
let currentSentenceIndex = 0;
let currentUtterance = null;
let selectedVoice = null;
let speechRate = 1.0;
let contentElement = null;

// DOM references
let audioBar = null;
let playPauseBtn = null;
let stopBtn = null;
let speedBtn = null;
let voiceSelect = null;
let sentenceInfo = null;
let progressBar = null;

const SPEED_STEPS = [0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
let speedIndex = 1; // default 1.0x

// ==========================================
// TEXT EXTRACTION
// ==========================================

/**
 * Extract readable text from the flipbook content element,
 * splitting into sentences for granular TTS control.
 */
function extractSentences(el) {
    // Clone to avoid modifying the live DOM
    const clone = el.cloneNode(true);

    // Remove scripts, styles, and non-readable elements
    clone.querySelectorAll('script, style, noscript, svg, .pdf-page').forEach(n => n.remove());

    // Get text content, collapse whitespace
    const text = clone.textContent
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) return [];

    // Split into sentences on . ! ? followed by a space or end of string
    // Keeps the delimiter attached to the sentence
    const raw = text.match(/[^.!?]*[.!?]+[\s]?|[^.!?]+$/g) || [text];

    return raw
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

/**
 * Build a map of sentence text to DOM ranges for highlighting.
 * Uses TreeWalker to locate sentence text within the content.
 */
function buildSentenceRanges(el, sentenceList) {
    const ranges = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
                return NodeFilter.FILTER_REJECT;
            }
            if (node.textContent.trim().length === 0) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });

    // Concatenate all text nodes with their positions
    const textNodes = [];
    let fullText = '';
    let node;
    while ((node = walker.nextNode())) {
        const text = node.textContent;
        textNodes.push({
            node,
            start: fullText.length,
            end: fullText.length + text.length,
        });
        fullText += text;
    }

    // Normalize whitespace in fullText for matching
    const normalizedFull = fullText.replace(/\s+/g, ' ');

    // For each sentence, find its approximate position in the full text
    let searchStart = 0;
    for (const sentence of sentenceList) {
        const normalizedSentence = sentence.replace(/\s+/g, ' ').trim();
        const idx = normalizedFull.indexOf(normalizedSentence, searchStart);
        if (idx >= 0) {
            ranges.push({ start: idx, end: idx + normalizedSentence.length });
            searchStart = idx + normalizedSentence.length;
        } else {
            ranges.push(null);
        }
    }

    return { textNodes, ranges, normalizedFull };
}

// ==========================================
// HIGHLIGHTING
// ==========================================

let highlightElements = [];
let sentenceRangeData = null;

function clearHighlights() {
    highlightElements.forEach(el => {
        if (el.parentNode) {
            const parent = el.parentNode;
            parent.replaceChild(document.createTextNode(el.textContent), el);
            parent.normalize();
        }
    });
    highlightElements = [];
}

function highlightSentence(index) {
    clearHighlights();

    if (!sentenceRangeData || !sentenceRangeData.ranges[index]) return;

    const { textNodes, ranges } = sentenceRangeData;
    const range = ranges[index];
    if (!range) return;

    // Map character positions back to text nodes,
    // accounting for whitespace normalization differences
    const charStart = range.start;
    const charEnd = range.end;

    // Find text nodes that overlap with our sentence range
    // We need to map from normalized positions back to original positions
    let normalizedPos = 0;
    let originalPos = 0;
    const fullTextParts = [];

    for (const tn of textNodes) {
        const text = tn.node.textContent;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (/\s/.test(ch)) {
                // In normalized text, consecutive whitespace becomes a single space
                if (normalizedPos === 0 || !/\s/.test(fullTextParts[fullTextParts.length - 1]?.ch || '')) {
                    fullTextParts.push({ ch: ' ', nodeIdx: textNodes.indexOf(tn), offset: i, normalizedIdx: normalizedPos });
                    normalizedPos++;
                } else {
                    fullTextParts.push({ ch, nodeIdx: textNodes.indexOf(tn), offset: i, normalizedIdx: -1 });
                }
            } else {
                fullTextParts.push({ ch, nodeIdx: textNodes.indexOf(tn), offset: i, normalizedIdx: normalizedPos });
                normalizedPos++;
            }
        }
    }

    // Find the original text positions for our normalized range
    let origStart = null;
    let origEnd = null;
    let origStartNode = null;
    let origEndNode = null;
    let origStartOffset = null;
    let origEndOffset = null;

    for (const part of fullTextParts) {
        if (part.normalizedIdx === charStart && origStart === null) {
            origStartNode = textNodes[part.nodeIdx].node;
            origStartOffset = part.offset;
            origStart = part;
        }
        if (part.normalizedIdx === charEnd - 1) {
            origEndNode = textNodes[part.nodeIdx].node;
            origEndOffset = part.offset + 1;
            origEnd = part;
        }
    }

    if (!origStartNode || !origEndNode) return;

    // Use Range API to wrap the sentence
    try {
        const domRange = document.createRange();
        domRange.setStart(origStartNode, origStartOffset);
        domRange.setEnd(origEndNode, Math.min(origEndOffset, origEndNode.textContent.length));

        const mark = document.createElement('mark');
        mark.className = 'audio-highlight';
        domRange.surroundContents(mark);
        highlightElements.push(mark);

        // Scroll the highlight into view within the flipbook
        mark.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    } catch (_) {
        // surroundContents can fail if the range crosses element boundaries
        // In that case, just skip highlighting for this sentence
    }
}

// ==========================================
// SPEECH SYNTHESIS
// ==========================================

function speakSentence(index) {
    if (index >= sentences.length) {
        stopAudio();
        return;
    }

    currentSentenceIndex = index;
    updateProgress();
    updateSentenceInfo();

    const utterance = new SpeechSynthesisUtterance(sentences[index]);
    utterance.rate = speechRate;
    utterance.pitch = 1.0;

    if (selectedVoice) {
        utterance.voice = selectedVoice;
    }

    utterance.onend = () => {
        if (isPlaying && !isPaused) {
            speakSentence(index + 1);
        }
    };

    utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
            console.error('Speech error:', e.error);
        }
    };

    utterance.onstart = () => {
        highlightSentence(index);
    };

    currentUtterance = utterance;
    speechSynthesis.speak(utterance);
}

// ==========================================
// PLAYBACK CONTROLS
// ==========================================

/**
 * Find the index of the first sentence visible on the current flipbook page.
 * Uses getBoundingClientRect on text nodes to detect what's in the viewport.
 */
function findFirstVisibleSentenceIndex() {
    if (!contentElement || sentences.length === 0 || !sentenceRangeData) return 0;

    const viewport = contentElement.closest('.flipbook-viewport');
    if (!viewport) return 0;

    const viewportRect = viewport.getBoundingClientRect();
    const { textNodes } = sentenceRangeData;

    if (textNodes.length === 0) return 0;

    const totalChars = textNodes[textNodes.length - 1].end;
    if (totalChars === 0) return 0;

    // Find the first text node whose bounding rect intersects the viewport
    for (const tn of textNodes) {
        const range = document.createRange();
        range.selectNodeContents(tn.node);
        const rect = range.getBoundingClientRect();

        if (rect.width > 0 && rect.height > 0 &&
            rect.left < viewportRect.right && rect.right > viewportRect.left &&
            rect.top < viewportRect.bottom && rect.bottom > viewportRect.top) {
            // Map text position to approximate sentence index
            const fraction = tn.start / totalChars;
            return Math.max(0, Math.min(
                Math.floor(fraction * sentences.length),
                sentences.length - 1
            ));
        }
    }

    return 0;
}

function playAudio() {
    if (!contentElement) return;

    if (isPaused) {
        // Resume from pause
        isPaused = false;
        isPlaying = true;
        speechSynthesis.resume();
        updatePlayPauseButton();
        showAudioBar();
        return;
    }

    // Extract sentences if needed
    let freshExtraction = false;
    if (sentences.length === 0) {
        sentences = extractSentences(contentElement);
        if (sentences.length === 0) return;
        freshExtraction = true;
    }

    // Rebuild range data for fresh start (DOM may have changed from highlight cleanup)
    sentenceRangeData = buildSentenceRanges(contentElement, sentences);

    // Auto-detect language and select matching voice for new articles
    if (freshExtraction) {
        autoDetectVoice();
    }

    // Start from the first sentence visible on the current page
    currentSentenceIndex = findFirstVisibleSentenceIndex();

    isPlaying = true;
    isPaused = false;
    updatePlayPauseButton();
    showAudioBar();

    speakSentence(currentSentenceIndex);
}

function pauseAudio() {
    if (!isPlaying) return;
    isPaused = true;
    isPlaying = false;
    speechSynthesis.pause();
    updatePlayPauseButton();
}

function stopAudio() {
    isPlaying = false;
    isPaused = false;
    currentSentenceIndex = 0;
    speechSynthesis.cancel();
    clearHighlights();
    updatePlayPauseButton();
    updateProgress();
    updateSentenceInfo();
}

function skipForward() {
    if (sentences.length === 0) return;
    speechSynthesis.cancel();
    clearHighlights();
    const next = Math.min(currentSentenceIndex + 1, sentences.length - 1);
    if (isPlaying || isPaused) {
        isPaused = false;
        isPlaying = true;
        speakSentence(next);
        updatePlayPauseButton();
    } else {
        currentSentenceIndex = next;
        updateProgress();
        updateSentenceInfo();
    }
}

function skipBackward() {
    if (sentences.length === 0) return;
    speechSynthesis.cancel();
    clearHighlights();
    const prev = Math.max(currentSentenceIndex - 1, 0);
    if (isPlaying || isPaused) {
        isPaused = false;
        isPlaying = true;
        speakSentence(prev);
        updatePlayPauseButton();
    } else {
        currentSentenceIndex = prev;
        updateProgress();
        updateSentenceInfo();
    }
}

function cycleSpeed() {
    speedIndex = (speedIndex + 1) % SPEED_STEPS.length;
    speechRate = SPEED_STEPS[speedIndex];

    if (speedBtn) {
        speedBtn.textContent = speechRate + 'x';
    }

    // If currently playing, restart current sentence at new speed
    if (isPlaying) {
        speechSynthesis.cancel();
        clearHighlights();
        speakSentence(currentSentenceIndex);
    }
}

// ==========================================
// LANGUAGE DETECTION
// ==========================================

/**
 * Detect the language of text content.
 * Checks the content element's lang attribute first, then character sets,
 * then falls back to common-word frequency for Latin-script languages.
 * Returns a BCP-47 primary language subtag (e.g. 'en', 'fr', 'ja').
 */
function detectLanguage(text) {
    // 1. Check for a lang attribute on the content element itself or its children
    //    (NOT ancestors — closest('[lang]') would hit <html lang="en"> from the app shell)
    if (contentElement) {
        const langAttr = contentElement.getAttribute('lang') ||
                         (contentElement.querySelector('[lang]')?.getAttribute('lang'));
        if (langAttr) return langAttr.split('-')[0].toLowerCase();
    }

    const sample = text.substring(0, 2000);

    // 2. Non-Latin script detection via character ranges
    const cjk      = (sample.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const hiragana  = (sample.match(/[\u3040-\u309f]/g) || []).length;
    const katakana  = (sample.match(/[\u30a0-\u30ff]/g) || []).length;
    const hangul    = (sample.match(/[\uac00-\ud7af\u1100-\u11ff]/g) || []).length;
    const cyrillic  = (sample.match(/[\u0400-\u04ff]/g) || []).length;
    const arabic    = (sample.match(/[\u0600-\u06ff]/g) || []).length;
    const hebrew    = (sample.match(/[\u0590-\u05ff]/g) || []).length;
    const thai      = (sample.match(/[\u0e00-\u0e7f]/g) || []).length;
    const devnagari = (sample.match(/[\u0900-\u097f]/g) || []).length;
    const greek     = (sample.match(/[\u0370-\u03ff]/g) || []).length;

    if (hiragana + katakana > 5) return 'ja';
    if (hangul > 5)              return 'ko';
    if (cjk > 10)               return 'zh';
    if (arabic > 10)            return 'ar';
    if (hebrew > 10)            return 'he';
    if (thai > 10)              return 'th';
    if (devnagari > 10)         return 'hi';
    if (greek > 10)             return 'el';
    if (cyrillic > 10)          return 'ru';

    // 3. Latin-script languages — score by common function words
    const words = sample.toLowerCase().split(/\s+/);

    const markers = {
        en: ['the','a','an','is','are','was','were','of','to','and','that','it','for','with','have','has','from','this','which','not','but','they','been','would','there'],
        fr: ['le','la','les','de','des','du','un','une','est','et','en','que','qui','dans','pour','sur','avec','ce','sont','pas','plus','nous','vous','cette','aussi'],
        es: ['el','la','los','las','del','en','un','una','es','que','por','con','para','se','su','al','como','más','pero','esta','este','fue','son','hay'],
        de: ['der','die','das','den','dem','ein','eine','und','ist','von','zu','mit','auf','für','nicht','sich','des','auch','nach','noch','wie','über','wird','bei'],
        pt: ['o','os','as','de','do','da','em','um','uma','que','no','na','com','para','por','se','mais','foi','como','mas','ao','dos','das','seu','sua'],
        it: ['il','lo','gli','della','dello','un','una','che','di','in','per','con','non','si','da','anche','sono','più','suo','sua','come','questa','questo','stato'],
        nl: ['het','een','van','en','in','dat','op','te','voor','met','zijn','er','aan','niet','ook','maar','wordt','door','nog','bij','uit','wel','kan','alle'],
        tr: ['bir','ve','bu','ile','için','olan','den','da','de','ne','var','gibi','daha','ancak','kadar','sonra','çok','ise','ya','hem','olarak','üzerinde'],
        pl: ['nie','jest','się','na','to','co','jak','ale','za','od','tak','czy','tego','ich','tylko','gdy','przez','już','aby','może','pod','po','ze','lub'],
        sv: ['och','att','det','en','som','för','med','den','har','av','är','på','till','inte','kan','om','ett','men','var','vid','från','ska','också','hon'],
    };

    let bestLang = 'en';
    let bestScore = 0;

    for (const [lang, langWords] of Object.entries(markers)) {
        let score = 0;
        for (const w of words) {
            if (langWords.includes(w)) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            bestLang = lang;
        }
    }

    return bestLang;
}

/**
 * Find the best available voice for a given language code.
 */
function selectVoiceForLanguage(langCode) {
    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return null;

    const lc = langCode.toLowerCase();

    // Exact prefix match (e.g. 'fr' → 'fr-FR')
    return voices.find(v => v.lang.toLowerCase().startsWith(lc + '-')) ||
           voices.find(v => v.lang.toLowerCase() === lc) ||
           null;
}

/**
 * Auto-detect the article language and switch the voice to match.
 * Only overrides if a matching voice is found; user can still override manually.
 */
function autoDetectVoice() {
    if (sentences.length === 0) return;

    const langCode = detectLanguage(sentences.join(' '));
    const voice = selectVoiceForLanguage(langCode);
    if (!voice) return;

    selectedVoice = voice;
    if (voiceSelect) voiceSelect.value = voice.voiceURI;
}

// ==========================================
// VOICE SELECTION
// ==========================================

function populateVoices() {
    if (!voiceSelect) return;

    const voices = speechSynthesis.getVoices();
    if (voices.length === 0) return;

    voiceSelect.innerHTML = '';

    // Prefer English voices, sort by name
    const english = voices.filter(v => v.lang.startsWith('en'));
    const others = voices.filter(v => !v.lang.startsWith('en'));

    const addOption = (voice) => {
        const opt = document.createElement('option');
        opt.value = voice.voiceURI;
        opt.textContent = voice.name + (voice.lang ? ' (' + voice.lang + ')' : '');
        opt.dataset.voiceUri = voice.voiceURI;
        if (voice.default) opt.selected = true;
        voiceSelect.appendChild(opt);
    };

    if (english.length > 0) {
        const engGroup = document.createElement('optgroup');
        engGroup.label = 'English';
        english.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = v.name;
            opt.dataset.voiceUri = v.voiceURI;
            if (v.default) opt.selected = true;
            engGroup.appendChild(opt);
        });
        voiceSelect.appendChild(engGroup);
    }

    if (others.length > 0) {
        const otherGroup = document.createElement('optgroup');
        otherGroup.label = 'Other Languages';
        others.forEach(v => {
            const opt = document.createElement('option');
            opt.value = v.voiceURI;
            opt.textContent = v.name + ' (' + v.lang + ')';
            opt.dataset.voiceUri = v.voiceURI;
            otherGroup.appendChild(opt);
        });
        voiceSelect.appendChild(otherGroup);
    }

    // Set default voice
    const defaultVoice = voices.find(v => v.default) || english[0] || voices[0];
    if (defaultVoice) {
        selectedVoice = defaultVoice;
        voiceSelect.value = defaultVoice.voiceURI;
    }
}

function onVoiceChange() {
    const voices = speechSynthesis.getVoices();
    const uri = voiceSelect.value;
    selectedVoice = voices.find(v => v.voiceURI === uri) || null;

    // Restart current sentence with new voice if playing
    if (isPlaying) {
        speechSynthesis.cancel();
        clearHighlights();
        speakSentence(currentSentenceIndex);
    }
}

// ==========================================
// UI UPDATES
// ==========================================

function updatePlayPauseButton() {
    if (!playPauseBtn) return;
    const icon = playPauseBtn.querySelector('.audio-btn-icon');
    if (!icon) return;

    if (isPlaying) {
        icon.innerHTML = '&#9646;&#9646;'; // pause symbol
        playPauseBtn.title = 'Pause';
        playPauseBtn.setAttribute('aria-label', 'Pause audio');
    } else {
        icon.innerHTML = '&#9654;'; // play symbol
        playPauseBtn.title = 'Play';
        playPauseBtn.setAttribute('aria-label', 'Play audio');
    }
}

function updateProgress() {
    if (!progressBar) return;
    const pct = sentences.length > 0
        ? (currentSentenceIndex / sentences.length) * 100
        : 0;
    progressBar.style.width = pct + '%';
}

function updateSentenceInfo() {
    if (!sentenceInfo) return;
    if (sentences.length === 0) {
        sentenceInfo.textContent = '';
        return;
    }
    sentenceInfo.textContent = (currentSentenceIndex + 1) + ' / ' + sentences.length;
}

function showAudioBar() {
    if (audioBar) audioBar.classList.add('visible');
}

function hideAudioBar() {
    if (audioBar) audioBar.classList.remove('visible');
}

// ==========================================
// PUBLIC API
// ==========================================

/**
 * Initialize the audio reader. Call once after DOM is ready.
 */
export function initAudioReader() {
    // Check for Web Speech API support
    if (!('speechSynthesis' in window)) {
        // Hide the listen button if TTS is not supported
        const listenBtn = document.getElementById('listenBtn');
        if (listenBtn) listenBtn.style.display = 'none';
        return;
    }

    // Cache DOM refs
    audioBar = document.getElementById('audioBar');
    playPauseBtn = document.getElementById('audioPlayPause');
    stopBtn = document.getElementById('audioStop');
    speedBtn = document.getElementById('audioSpeed');
    voiceSelect = document.getElementById('audioVoice');
    sentenceInfo = document.getElementById('audioSentenceInfo');
    progressBar = document.getElementById('audioProgressFill');

    // Listen button in toolbar
    const listenBtn = document.getElementById('listenBtn');
    if (listenBtn) {
        listenBtn.addEventListener('click', () => {
            if (isPlaying) {
                pauseAudio();
            } else {
                playAudio();
            }
        });
    }

    // Play/Pause
    if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => {
            if (isPlaying) {
                pauseAudio();
            } else {
                playAudio();
            }
        });
    }

    // Stop
    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            stopAudio();
            hideAudioBar();
        });
    }

    // Skip buttons
    const skipFwd = document.getElementById('audioSkipFwd');
    const skipBwd = document.getElementById('audioSkipBwd');
    if (skipFwd) skipFwd.addEventListener('click', skipForward);
    if (skipBwd) skipBwd.addEventListener('click', skipBackward);

    // Speed
    if (speedBtn) {
        speedBtn.addEventListener('click', cycleSpeed);
    }

    // Voice select
    if (voiceSelect) {
        voiceSelect.addEventListener('change', onVoiceChange);
    }

    // Populate voices (may fire async)
    populateVoices();
    speechSynthesis.addEventListener('voiceschanged', populateVoices);
}

/**
 * Set the content element for the audio reader to read from.
 * Call this each time new content is loaded.
 * @param {HTMLElement} el - The flipbook content element
 */
export function setAudioContent(el) {
    // Stop any current playback
    if (isPlaying || isPaused) {
        stopAudio();
    }

    contentElement = el;
    sentences = [];
    sentenceRangeData = null;
    currentSentenceIndex = 0;
    hideAudioBar();
    updateProgress();
    updateSentenceInfo();
}

/**
 * Clean up audio reader state (call on view switch).
 */
export function cleanupAudio() {
    stopAudio();
    hideAudioBar();
    contentElement = null;
    sentences = [];
    sentenceRangeData = null;
    currentSentenceIndex = 0;
}
