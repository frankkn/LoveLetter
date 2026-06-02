export type TrackInfo = { name: string; url: string };
export type MusicSlot = 'menu' | 'game' | 'winner' | 'loser' | 'champion';

export const NO_TRACK: TrackInfo = { name: '(無)', url: '' };

function buildTrackList(
    filenames: string[],
    subfolder: string,
    fallback: TrackInfo
): TrackInfo[] {
    const base = import.meta.env.BASE_URL;
    const tracks = filenames
        .map(filename => {
            const name = filename.replace(/\.mp3$/i, '').replace(/[-_]/g, ' ');
            const url = `${base}audio/${subfolder}/${encodeURIComponent(filename)}`;
            return { name, url };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    return tracks.length > 0 ? tracks : [fallback];
}

// Keep public audio as static files. Avoid import.meta.glob here because Vite
// emits duplicate MP3 copies into dist/assets even when only filenames are used.
export const AUDIO_LIBRARY: Record<MusicSlot, TrackInfo[]> = {
    menu: buildTrackList([
        'Royal Intrigue .mp3',
        'The Gilded Labyrinth.mp3',
        "The Sovereign's Veil.mp3",
        'Velvet Armor.mp3',
    ], 'menu', NO_TRACK),
    game: buildTrackList([
        'A Game of Hearts .mp3',
        'Dealroom Lutestring.mp3',
        'The Algorithmic Court.mp3',
        'The Crown of Thorns.mp3',
    ], 'game', NO_TRACK),
    winner: buildTrackList([
        'Gilded Trumpets.mp3',
        'The Dawn of Triumph.mp3',
        "The Sovereign's Fanfare.mp3",
        "The Victor's Token.mp3",
    ], 'winner', NO_TRACK),
    loser: buildTrackList([
        'Farewell, Chevalier .mp3',
        'Rosin Grief.mp3',
        "The Bow's Lament.mp3",
        'The Last Requiem of Glory.mp3',
    ], 'loser', NO_TRACK),
    champion: buildTrackList([
        'Dawn of the Golden Age.mp3',
        'Love Conquers All .mp3',
        'The Triumph of Aphrodite.mp3',
        'Trumpet Crowned Love.mp3',
    ], 'champion', NO_TRACK),
};

const MUSIC_SETTINGS_KEY = 'loveLetter_musicSettings';
const VOLUME_SETTINGS_KEY = 'loveLetter_audioVolume';
const DEFAULT_AUDIO_VOLUME_PERCENT = 60;
const BGM_BASE_VOLUME = 0.45;
const SFX_BASE_VOLUME = 0.8;
const PREVIEW_BASE_VOLUME = 0.45;

let musicSelections: Record<MusicSlot, number> = { menu: 0, game: 0, winner: 0, loser: 0, champion: 0 };
let audioVolumePercent = DEFAULT_AUDIO_VOLUME_PERCENT;
let pendingMusicSelections: Record<MusicSlot, number> = { ...musicSelections };
let pendingAudioVolumePercent = audioVolumePercent;

const bgmAudio = new Audio();
bgmAudio.loop = true;
bgmAudio.volume = BGM_BASE_VOLUME;

const sfxAudio = new Audio();
sfxAudio.volume = SFX_BASE_VOLUME;

const previewAudio = new Audio();
previewAudio.loop = true;
previewAudio.volume = PREVIEW_BASE_VOLUME;

let isMuted = localStorage.getItem('loveLetter_muted') === 'true';
let currentBGMFile = '';
let audioUnlocked = false;
let pendingBGMFile = '';
const preloadedAudio = new Set<string>();
const audioPreloadQueue: string[] = [];
let isAudioPreloadQueueRunning = false;
let bgmPausedForSFX = false;

export function clampAudioVolume(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function loadMusicSettings() {
    try {
        const raw = localStorage.getItem(MUSIC_SETTINGS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<Record<MusicSlot, number>>;
        for (const slot of Object.keys(AUDIO_LIBRARY) as MusicSlot[]) {
            const idx = parsed[slot] ?? 0;
            musicSelections[slot] = Math.max(0, Math.min(idx, AUDIO_LIBRARY[slot].length - 1));
        }
    } catch { /* ignore malformed data */ }

    const storedVolume = Number(localStorage.getItem(VOLUME_SETTINGS_KEY));
    if (Number.isFinite(storedVolume)) {
        audioVolumePercent = clampAudioVolume(storedVolume);
        pendingAudioVolumePercent = audioVolumePercent;
    }
}

function saveMusicSettings() {
    localStorage.setItem(MUSIC_SETTINGS_KEY, JSON.stringify(musicSelections));
    localStorage.setItem(VOLUME_SETTINGS_KEY, String(audioVolumePercent));
}

export function getSelectedTrack(slot: MusicSlot): TrackInfo {
    const tracks = AUDIO_LIBRARY[slot];
    return tracks[Math.max(0, Math.min(musicSelections[slot], tracks.length - 1))] ?? NO_TRACK;
}

export function getPendingTrack(slot: MusicSlot): TrackInfo {
    return AUDIO_LIBRARY[slot][pendingMusicSelections[slot]] ?? NO_TRACK;
}

export function getPendingSelection(slot: MusicSlot): number {
    return pendingMusicSelections[slot];
}

export function getPendingAudioVolumePercent(): number {
    return pendingAudioVolumePercent;
}

export function setPendingAudioVolumePercent(value: number): void {
    pendingAudioVolumePercent = clampAudioVolume(value);
    applyAudioVolume(pendingAudioVolumePercent);
}

export function adjustPendingMusicSelection(slot: MusicSlot, dir: number): TrackInfo {
    const tracks = AUDIO_LIBRARY[slot];
    pendingMusicSelections[slot] = Math.max(0, Math.min(pendingMusicSelections[slot] + dir, tracks.length - 1));
    return getPendingTrack(slot);
}

export function beginMusicSettingsEdit(): void {
    pendingMusicSelections = { ...musicSelections };
    pendingAudioVolumePercent = audioVolumePercent;
    applyAudioVolume(pendingAudioVolumePercent);
}

export function confirmMusicSettingsEdit(): void {
    musicSelections = { ...pendingMusicSelections };
    audioVolumePercent = pendingAudioVolumePercent;
    saveMusicSettings();
    applyAudioVolume(audioVolumePercent);
    stopPreview();
    playSelectedMenuBGM();
}

export function cancelMusicSettingsEdit(): void {
    stopPreview();
    applyAudioVolume(audioVolumePercent);
    playSelectedMenuBGM();
}

export function applyAudioVolume(volumePercent = audioVolumePercent) {
    const ratio = clampAudioVolume(volumePercent) / 100;
    bgmAudio.volume = BGM_BASE_VOLUME * ratio;
    sfxAudio.volume = SFX_BASE_VOLUME * ratio;
    previewAudio.volume = PREVIEW_BASE_VOLUME * ratio;
}

function getAudioSrc(filename: string): string {
    return `${import.meta.env.BASE_URL}audio/${encodeURIComponent(filename)}`;
}

function applyMuteState() {
    bgmAudio.muted = isMuted;
    sfxAudio.muted = isMuted;
    previewAudio.muted = isMuted;
    const btn = document.getElementById('mute-btn') as HTMLButtonElement | null;
    if (btn) btn.classList.toggle('muted', isMuted);
    const btnGlobal = document.getElementById('mute-btn-global') as HTMLButtonElement | null;
    if (btnGlobal) btnGlobal.textContent = isMuted ? '🔇' : '🔊';
}

function preloadAudio(url: string) {
    if (!url || preloadedAudio.has(url)) return;
    preloadedAudio.add(url);
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    audio.load();
}

function queueAudioPreload(url: string) {
    if (!url || preloadedAudio.has(url) || audioPreloadQueue.includes(url)) return;
    audioPreloadQueue.push(url);
    void runAudioPreloadQueue();
}

async function runAudioPreloadQueue() {
    if (isAudioPreloadQueueRunning) return;
    isAudioPreloadQueueRunning = true;
    while (audioPreloadQueue.length > 0) {
        const url = audioPreloadQueue.shift();
        if (!url || preloadedAudio.has(url)) continue;
        preloadAudio(url);
        await new Promise(resolve => window.setTimeout(resolve, 650));
    }
    isAudioPreloadQueueRunning = false;
}

function preloadSelectedBGM() {
    const menuTrack = getSelectedTrack('menu');
    const gameTrack = getSelectedTrack('game');
    if (menuTrack.url) preloadAudio(menuTrack.url);
    if (gameTrack.url) preloadAudio(gameTrack.url);
}

export function queueMusicSettingsPreload() {
    for (const slot of Object.keys(AUDIO_LIBRARY) as MusicSlot[]) {
        const tracks = AUDIO_LIBRARY[slot];
        const selectedIndex = pendingMusicSelections[slot] ?? musicSelections[slot] ?? 0;
        const indexes = [selectedIndex, selectedIndex - 1, selectedIndex + 1];
        for (const index of indexes) {
            const track = tracks[index];
            if (track?.url) queueAudioPreload(track.url);
        }
    }
}

function unlockAudio(removeSplashScreen: () => void) {
    if (audioUnlocked) return;
    audioUnlocked = true;
    preloadSelectedBGM();
    const splash = document.getElementById('splash-screen');
    if (splash) {
        splash.classList.add('fade-out');
        splash.addEventListener('animationend', removeSplashScreen, { once: true });
    }
    if (pendingBGMFile) {
        const f = pendingBGMFile;
        pendingBGMFile = '';
        playBGM(f);
    }
}

export function initializeAudioUnlock(removeSplashScreen: () => void) {
    const unlock = () => unlockAudio(removeSplashScreen);
    document.addEventListener('touchstart', unlock, { capture: true, once: true });
    document.addEventListener('click',      unlock, { capture: true, once: true });
    document.addEventListener('keydown',    unlock, { capture: true, once: true });
    applyMuteState();
}

export function playBGM(filenameOrUrl: string) {
    if (!audioUnlocked) { pendingBGMFile = filenameOrUrl; return; }
    if (currentBGMFile === filenameOrUrl) return;
    preloadAudio(filenameOrUrl);
    bgmAudio.loop = true;
    currentBGMFile = filenameOrUrl;
    bgmPausedForSFX = false;
    bgmAudio.src = filenameOrUrl.includes('/') ? filenameOrUrl : getAudioSrc(filenameOrUrl);
    bgmAudio.currentTime = 0;
    bgmAudio.play().catch(() => {
        audioUnlocked = false;
        pendingBGMFile = filenameOrUrl;
        currentBGMFile = '';
    });
}

export function playSFX(filenameOrUrl: string) {
    if (!audioUnlocked) return;
    if (!bgmAudio.paused) {
        bgmAudio.pause();
        bgmPausedForSFX = true;
    }
    const resumeBGM = () => {
        if (bgmPausedForSFX && currentBGMFile) {
            bgmPausedForSFX = false;
            bgmAudio.play().catch(() => {});
        }
    };
    sfxAudio.src = filenameOrUrl.includes('/') ? filenameOrUrl : getAudioSrc(filenameOrUrl);
    sfxAudio.currentTime = 0;
    sfxAudio.onended = resumeBGM;
    sfxAudio.play().catch(resumeBGM);
}

export function playChampionTheme() {
    const track = getSelectedTrack('champion');
    if (!track.url) return;
    bgmPausedForSFX = false;
    bgmAudio.pause();
    currentBGMFile = '';
    sfxAudio.src = track.url;
    sfxAudio.currentTime = 0;
    sfxAudio.onended = () => {
        const gameTrack = getSelectedTrack('game');
        if (gameTrack.url) playBGM(gameTrack.url);
    };
    sfxAudio.play().catch(() => {});
}

export function toggleMute() {
    isMuted = !isMuted;
    localStorage.setItem('loveLetter_muted', String(isMuted));
    applyMuteState();
    if (!isMuted) unlockAudio(() => {});
}

export function stopPreview() {
    previewAudio.pause();
    previewAudio.src = '';
}

export function playPreview(url: string) {
    previewAudio.pause();
    previewAudio.muted = isMuted;
    applyAudioVolume(pendingAudioVolumePercent);
    previewAudio.src = url;
    previewAudio.currentTime = 0;
    previewAudio.play().catch(() => {});
}

export function pauseBGMForSettingsPreview() {
    bgmAudio.pause();
    bgmPausedForSFX = false;
}

export function playSelectedMenuBGM() {
    currentBGMFile = '';
    const menuTrack = getSelectedTrack('menu');
    if (menuTrack.url) playBGM(menuTrack.url);
}

loadMusicSettings();
applyAudioVolume();
