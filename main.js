// === Réseau / API (intégration Millionnaire) ===
// Priorité:
// 1) window.DRAG_API_BASE (forçage manuel)
// 2) En dev local, utiliser un proxy CORS si présent (ex: local-cors-proxy sur 8010)
// 3) Sinon, prod Render
let API_BASE = (window && window.DRAG_API_BASE) ? String(window.DRAG_API_BASE) : '';
try {
    if (!API_BASE) {
        const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '';
        const isLocalHost = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host) || host.startsWith('192.168.');
        if (isLocalHost) {
            // Permet d'éviter les erreurs CORS pendant le dev local en utilisant un proxy
            // Lancez un proxy: npx local-cors-proxy --proxyUrl https://server-jeux-millionnaire.onrender.com --port 8010
            const devProxy = (window && window.DRAG_DEV_PROXY) ? String(window.DRAG_DEV_PROXY) : 'http://127.0.0.1:8010/proxy';
            API_BASE = devProxy;
            try { console.info('[drag] Mode dev: API via proxy', API_BASE); } catch {}
        } else {
            API_BASE = 'https://server-jeux-millionnaire.onrender.com';
        }
    }
} catch (_) { API_BASE = 'https://server-jeux-millionnaire.onrender.com'; }

let CSRF_TOKEN = null;
function getStoredSession() {
    try { const raw = localStorage.getItem('hm-session'); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function setStoredSession(s) { try { localStorage.setItem('hm-session', JSON.stringify(s)); } catch {} }
function clearStoredSession() { try { localStorage.removeItem('hm-session'); } catch {} }
function getAuthToken() { try { return localStorage.getItem('hm-token') || null; } catch { return null; } }
function setAuthToken(t) { try { if (t) localStorage.setItem('hm-token', t); } catch {} }
function clearAuthToken() { try { localStorage.removeItem('hm-token'); } catch {} }
async function ensureCsrf() {
    try {
        if (CSRF_TOKEN) return CSRF_TOKEN;
        const res = await fetch(`${API_BASE}/api/auth/csrf`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        CSRF_TOKEN = data?.csrf || null; return CSRF_TOKEN;
    } catch { return null; }
}
async function apiFetch(path, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const headers = Object.assign({}, init.headers || {});
    if ([ 'POST','PUT','PATCH','DELETE' ].includes(method)) {
        const csrf = await ensureCsrf(); if (csrf) headers['x-csrf-token'] = csrf;
    }
    const token = getAuthToken();
    if (token && !headers['Authorization']) headers['Authorization'] = `Bearer ${token}`;
    const sess = getStoredSession();
    if (sess?.playerId) headers['X-Player-ID'] = sess.playerId;

    const url = `${API_BASE}${path}`;

    // Utiliser le plugin Capacitor HTTP en natif (Android/iOS) pour éviter CORS
    try {
        const cap = (typeof window !== 'undefined') ? window.Capacitor : null;
        const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
        const http = cap && cap.Plugins && (cap.Plugins.Http || cap.Plugins.CapacitorHttp);
        if (isNative && http) {
            let data = undefined;
            if (init.body) {
                if (typeof init.body === 'string') {
                    try { data = JSON.parse(init.body); } catch { data = init.body; }
                } else {
                    data = init.body;
                }
            }
            const resp = await http.request({ method, url, headers, data });
            if (resp.status >= 200 && resp.status < 300) {
                return resp.data;
            }
            throw new Error(`HTTP ${resp.status}`);
        }
    } catch (_) {
        // Fallback fetch classique si plugin non dispo
    }

    const res = await fetch(url, { credentials: 'include', ...init, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (res.status === 204) return undefined;
    return await res.json();
}
async function ensureSession() {
    let sess = getStoredSession();
    if (sess?.gameId && sess?.playerId) return sess;
    // Auto-join sur la partie globale
    const list = await apiFetch('/api/games');
    const g = list?.games?.[0]; if (!g) throw new Error('Aucune partie');
    const joined = await apiFetch(`/api/games/${g.id}/join`, { method:'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({}) });
    sess = { gameId: g.id, playerId: joined.playerId, nickname: '' };
    setStoredSession(sess);
    return sess;
}
async function loadDragSessionAndSyncHUD() {
    const sess = await ensureSession();
    const data = await apiFetch(`/api/games/${sess.gameId}/drag/session`);
    try {
        game.cash = Number(data?.player?.cash ?? 0);
        game.stage = Number(data?.drag?.stage ?? 1);
        updateHud();
    } catch {}
    return { sess, data };
}

async function refreshAuthUi() {
    try {
        const me = await apiFetch('/api/auth/me');
        if (authStatus) authStatus.textContent = me?.email || 'Connecté';
        if (authLogoutBtn) authLogoutBtn.hidden = false;
        if (authLeft) authLeft.style.display = 'none';
    } catch {
        if (authStatus) authStatus.textContent = 'Invité';
        if (authLogoutBtn) authLogoutBtn.hidden = true;
        if (authLeft) authLeft.style.display = 'flex';
    }
}

const trackCanvas = document.getElementById('trackCanvas');
const trackCtx = trackCanvas.getContext('2d');
const rpmCanvas = document.getElementById('rpmCanvas');
const rpmCtx = rpmCanvas.getContext('2d');

const hudStage = document.getElementById('hudStage');
const hudCash = document.getElementById('hudCash');
const hudTime = document.getElementById('hudTime');
const hudShift = document.getElementById('hudShift');
const statusBanner = document.getElementById('statusBanner');
const overlayActions = document.getElementById('overlayActions');
// Auth UI elements
const authEmail = document.getElementById('authEmail');
const authPassword = document.getElementById('authPassword');
const authLoginBtn = document.getElementById('authLogin');
const authRegisterBtn = document.getElementById('authRegister');
const authLogoutBtn = document.getElementById('authLogout');
const authForgotBtn = document.getElementById('authForgot');
const authStatus = document.getElementById('authStatus');
const authLeft = document.querySelector('.auth-left');
const authBar = document.querySelector('.auth-bar');
const startButton = document.getElementById('startButton');
const gearValue = document.getElementById('gearValue');
const gasButton = document.getElementById('gasButton');
const nitroButton = document.getElementById('nitroButton');
const garageButton = document.getElementById('garageButton');
const garageOverlay = document.getElementById('garageOverlay');
const closeGarageButton = document.getElementById('closeGarageButton');
const resetGarageButton = document.getElementById('resetGarageButton');
const applyGarageButton = document.getElementById('applyGarageButton');
const gearSliderList = document.getElementById('gearSliderList');
const engineSlider = document.getElementById('engineSlider');
const engineValue = document.getElementById('engineValue');
const nitroPowerSlider = document.getElementById('nitroPowerSlider');
const nitroPowerValue = document.getElementById('nitroPowerValue');
const nitroDurationSlider = document.getElementById('nitroDurationSlider');
const nitroDurationValue = document.getElementById('nitroDurationValue');
const nitroChargesSlider = document.getElementById('nitroChargesSlider');
const nitroChargesValue = document.getElementById('nitroChargesValue');
const gaugePanel = document.querySelector('.gauge-panel');
if (gaugePanel) {
    gaugePanel.style.zIndex = '260';
    gaugePanel.style.pointerEvents = 'none';
}
// Sections de mise en page à basculer selon l'état
const hudSection = document.querySelector('.hud');
const playfield = document.querySelector('.playfield');
const footerEl = document.querySelector('.footer');

// Maintenir un 16:9 strict et adapter les canvases à l’écran
function resizeCanvases() {
    try {
        const shell = document.querySelector('.game-shell');
        if (!shell) return;
        const vw = Math.max(320, Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth));
        const vh = Math.max(200, Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight));
        // On tente de remplir la largeur, en respectant 16:9, et sans dépasser la hauteur
        let cssWidth = vw - 16; // petite marge
        let cssHeight = Math.round(cssWidth * 9 / 16);
        const maxHeight = vh - 170; // tenir compte des boutons + hud
        if (cssHeight > maxHeight) {
            cssHeight = Math.max(200, maxHeight);
            cssWidth = Math.round(cssHeight * 16 / 9);
        }
        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        // Track canvas dimension
        trackCanvas.style.width = cssWidth + 'px';
        trackCanvas.style.height = cssHeight + 'px';
        trackCanvas.width = Math.round(cssWidth * dpr);
        trackCanvas.height = Math.round(cssHeight * dpr);
        // RPM gauge dimension proportionnelle
        const gaugeSize = Math.max(160, Math.min(300, Math.round(cssHeight * 0.52)));
        rpmCanvas.style.width = gaugeSize + 'px';
        rpmCanvas.style.height = gaugeSize + 'px';
        rpmCanvas.width = Math.round(gaugeSize * dpr);
        rpmCanvas.height = Math.round(gaugeSize * dpr);
    } catch {}
}

const THROTTLE_KEYS = new Set(['ArrowUp', 'KeyW']);
const NITRO_KEYS = new Set(['KeyN', 'ShiftLeft', 'ShiftRight', 'KeyX']);
const throttleState = { keyboard: false, pointer: false };
const gearSliders = [];

const TRACK_LENGTH_METERS = 380;
const RPM_IDLE = 1200;
const RPM_MAX = 8000;
const RPM_SHIFT_MIN = 5200;
const RPM_SHIFT_MAX = 6900;
const RPM_REDLINE = 7500;
const MAX_GEAR = 8;

const baseGearProfile = [
    null,
    { topSpeed: 76, accelFactor: 1.38 },
    { topSpeed: 124, accelFactor: 1.16 },
    { topSpeed: 182, accelFactor: 0.98 },
    { topSpeed: 248, accelFactor: 0.84 },
    { topSpeed: 340, accelFactor: 0.72 },
    { topSpeed: 410, accelFactor: 0.64 },
    { topSpeed: 470, accelFactor: 0.58 },
    { topSpeed: 540, accelFactor: 0.52 }
];

const VICTORY_PAYOUT = 50000;

let gearProfile = baseGearProfile.map((entry) => (entry ? { ...entry } : null));

const tuning = {
    gearMultipliers: Array.from({ length: MAX_GEAR + 1 }, () => 1),
    enginePower: 1,
    nitroPower: 1.4,
    nitroDuration: 1.5,
    nitroCharges: 1
};

const playerRaceHistory = [];

const adState = {
    raceCount: 0,
    lastShownAt: 0,
    initDone: false,
};
let adInitPromise = null;
let adShowPromise = null;
const AD_RACE_INTERVAL = 3;
const AD_COOLDOWN_MS = 120000;

function isNativeAdContext() {
    if (typeof window === 'undefined') return false;
    const cap = window.Capacitor;
    if (!cap) return false;
    try {
        if (typeof cap.isNativePlatform === 'function') {
            return !!cap.isNativePlatform();
        }
        return !!(cap.platform && cap.platform !== 'web');
    } catch {
        return false;
    }
}

function getAdMobPluginForDrag() {
    if (typeof window === 'undefined') return null;
    const cap = window.Capacitor;
    if (!cap || !cap.Plugins) return null;
    const plugin = cap.Plugins.AdMob;
    return plugin && typeof plugin === 'object' ? plugin : null;
}

async function ensureDragAdsInitialized() {
    if (adState.initDone) return true;
    if (adInitPromise) {
        try {
            await adInitPromise;
        } catch {}
        return adState.initDone;
    }
    if (!isNativeAdContext()) return false;
    const plugin = getAdMobPluginForDrag();
    if (!plugin || typeof plugin.initialize !== 'function') return false;
    adInitPromise = (async () => {
        try {
            if (typeof plugin.requestConsent === 'function') {
                try {
                    await plugin.requestConsent();
                } catch (err) {
                    console.warn('[drag][ads] consent request failed', err);
                }
            }
            await plugin.initialize();
            adState.initDone = true;
            if (typeof plugin.loadInterstitial === 'function') {
                try {
                    await plugin.loadInterstitial();
                } catch (err) {
                    console.warn('[drag][ads] preload failed', err);
                }
            }
        } catch (err) {
            adState.initDone = false;
            console.warn('[drag][ads] init failed', err);
        } finally {
            adInitPromise = null;
        }
    })();
    await adInitPromise;
    return adState.initDone;
}

async function showDragInterstitialIfReady() {
    if (adShowPromise) return adShowPromise;
    adShowPromise = (async () => {
        try {
            const readyForAds = await ensureDragAdsInitialized();
            if (!readyForAds) return;
            const plugin = getAdMobPluginForDrag();
            if (!plugin) return;
            const now = Date.now();
            if (now - adState.lastShownAt < AD_COOLDOWN_MS) return;
            let ready = false;
            if (typeof plugin.isAdReady === 'function') {
                try {
                    const status = await plugin.isAdReady();
                    ready = !!(status && status.ready);
                } catch {}
            }
            if (!ready && typeof plugin.loadInterstitial === 'function') {
                try {
                    await plugin.loadInterstitial();
                } catch {}
                if (typeof plugin.isAdReady === 'function') {
                    try {
                        const status = await plugin.isAdReady();
                        ready = !!(status && status.ready);
                    } catch {}
                }
            }
            if (!ready || typeof plugin.showInterstitial !== 'function') return;
            await plugin.showInterstitial();
            adState.lastShownAt = Date.now();
            if (typeof plugin.loadInterstitial === 'function') {
                try {
                    await plugin.loadInterstitial();
                } catch {}
            }
        } catch (err) {
            console.warn('[drag][ads] show failed', err);
        } finally {
            adShowPromise = null;
        }
    })();
    await adShowPromise;
}

function handleRaceCompletedForAds() {
    adState.raceCount += 1;
    if (adState.raceCount % AD_RACE_INTERVAL !== 0) return;
    if (!isNativeAdContext()) return;
    void showDragInterstitialIfReady();
}

function recalculateGearProfile() {
    gearProfile = baseGearProfile.map((entry) => (entry ? { ...entry } : null));
    for (let gear = 1; gear <= MAX_GEAR; gear += 1) {
        const base = baseGearProfile[gear];
        const ratio = tuning.gearMultipliers[gear];
        const accelRatio = Math.pow(Math.max(0.6, ratio), -0.6);
        gearProfile[gear] = {
            topSpeed: base.topSpeed * ratio,
            accelFactor: base.accelFactor * accelRatio
        };
    }
}

recalculateGearProfile();

const game = {
    state: 'idle',
    stage: 1,
    cash: 0,
    timer: 0,
    countdown: 3,
    countdownTimer: 0,
    bannerTimer: 0,
    bannerColor: '',
    result: null,
    reward: 0,
    perfectWin: false
};

const player = {
    position: 0,
    speed: 0,
    rpm: RPM_IDLE,
    gear: 1,
    shiftMomentum: 0,
    limiterPenalty: 0,
    shiftText: '—',
    shiftTint: 'rgba(255,255,255,0.8)',
    shiftTimer: 0,
    finishTime: null,
    throttle: false,
    perfectShifts: 0,
    shiftsTaken: 0,
    nitroCharges: 0,
    nitroTimer: 0,
    nitroActive: false,
    launchApplied: false
};

const opponent = {
    position: 0,
    speed: 0,
    accel: 0,
    maxSpeed: 0,
    reactionDelay: 0.35,
    finishTime: null,
    targetTime: null,
    handicap: 1,
    shiftStumbleTimer: 0,
    stumbleInterval: null
};

let lastFrame = performance.now();
let activeThrottlePointer = null;
let activeNitroPointer = null;

startButton.addEventListener('click', () => {
    if (game.state === 'countdown') {
        return;
    }

    closeGarage();
    startRace();
});

window.addEventListener('keydown', (event) => {
    if (THROTTLE_KEYS.has(event.code)) {
        event.preventDefault();
        setThrottleSource('keyboard', true);
    }

    if (NITRO_KEYS.has(event.code)) {
        event.preventDefault();
        activateNitro();
    }

    if (event.code === 'Space') {
        event.preventDefault();
        handleShift();
    }

    if (event.code === 'Escape' && garageOverlay && !garageOverlay.hidden) {
        event.preventDefault();
        closeGarage();
    }
});

window.addEventListener('keyup', (event) => {
    if (THROTTLE_KEYS.has(event.code)) {
        event.preventDefault();
        setThrottleSource('keyboard', false);
    }
});

if (gasButton) {
    const releaseThrottle = (event) => {
        if (event && event.pointerId !== undefined && activeThrottlePointer !== null && event.pointerId !== activeThrottlePointer) {
            return;
        }
        if (event && gasButton.releasePointerCapture) {
            try {
                gasButton.releasePointerCapture(event.pointerId);
            } catch (_) {
                /* ignored: pointer capture not active */
            }
        }
        activeThrottlePointer = null;
        setThrottleSource('pointer', false);
    };

    gasButton.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        // Pendant la course, le gros bouton sert à SHIFTER
        if (game.state === 'running') {
            handleShift();
            return;
        }
        if (activeThrottlePointer === null) {
            activeThrottlePointer = event.pointerId;
            if (gasButton.setPointerCapture) {
                try {
                    gasButton.setPointerCapture(event.pointerId);
                } catch (_) {
                    /* ignored: pointer capture not supported */
                }
            }
        }
        setThrottleSource('pointer', true);
    });

    ['pointerup', 'pointercancel', 'pointerout'].forEach((type) => {
        gasButton.addEventListener(type, releaseThrottle);
    });

    gasButton.addEventListener('lostpointercapture', releaseThrottle);
    gasButton.addEventListener('contextmenu', (event) => event.preventDefault());
}

if (nitroButton) {
    const handleNitroRelease = (event) => {
        if (event && event.pointerId !== undefined && activeNitroPointer !== null && event.pointerId !== activeNitroPointer) {
            return;
        }
        activeNitroPointer = null;
        if (nitroButton.releasePointerCapture && event?.pointerId !== undefined) {
            try {
                nitroButton.releasePointerCapture(event.pointerId);
            } catch (_) {
                /* ignored: pointer capture not active */
            }
        }
    };

    nitroButton.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (activeNitroPointer === null) {
            activeNitroPointer = event.pointerId;
            if (nitroButton.setPointerCapture) {
                try {
                    nitroButton.setPointerCapture(event.pointerId);
                } catch (_) {
                    /* ignored: pointer capture not supported */
                }
            }
        }
        activateNitro();
    });

    ['pointerup', 'pointercancel', 'pointerout'].forEach((type) => {
        nitroButton.addEventListener(type, handleNitroRelease);
    });

    nitroButton.addEventListener('lostpointercapture', handleNitroRelease);
    nitroButton.addEventListener('contextmenu', (event) => event.preventDefault());
}

if (garageButton && garageOverlay) {
    garageButton.addEventListener('click', () => openGarage());
}

if (closeGarageButton) {
    closeGarageButton.addEventListener('click', () => closeGarage());
}

if (applyGarageButton) {
    applyGarageButton.addEventListener('click', () => {
        recalculateGearProfile();
        setBanner('Réglages appliqués.', 2, '#7ecbff');
        closeGarage();
    });
}

if (resetGarageButton) {
    resetGarageButton.addEventListener('click', () => {
        resetTuningToDefaults();
        updateGarageUI();
        setBanner('Réglages remis à zéro.', 2, '#d6ddff');
    });
}

// Auth events
if (authLoginBtn) {
    authLoginBtn.addEventListener('click', async () => {
        const email = (authEmail && authEmail.value) ? String(authEmail.value).trim() : '';
        const password = (authPassword && authPassword.value) ? String(authPassword.value) : '';
        if (!email || !password) {
            setBanner('Email et mot de passe requis.', 3, '#ffe66d');
            return;
        }
        try {
            await ensureCsrf();
            const loginRes = await apiFetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (loginRes && loginRes.token) setAuthToken(loginRes.token);
            clearStoredSession();
            await refreshAuthUi();
            await loadDragSessionAndSyncHUD();
            setBanner('Connecté.', 2, '#7cffb0');
        } catch (e) {
            setBanner('Connexion échouée. Vérifiez vos identifiants.', 3, '#ff6b6b');
        }
    });
}
if (authRegisterBtn) {
    authRegisterBtn.addEventListener('click', async () => {
        const email = (authEmail && authEmail.value) ? String(authEmail.value).trim() : '';
        const password = (authPassword && authPassword.value) ? String(authPassword.value) : '';
        if (!email || !password) {
            setBanner('Email et mot de passe requis.', 3, '#ffe66d');
            return;
        }
        try {
            await ensureCsrf();
            const regRes = await apiFetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            if (regRes && regRes.token) setAuthToken(regRes.token);
            clearStoredSession();
            await refreshAuthUi();
            await loadDragSessionAndSyncHUD();
            setBanner('Compte créé et connecté.', 2, '#7cffb0');
        } catch (e) {
            setBanner("Création de compte échouée (email déjà pris ?).", 3, '#ff6b6b');
        }
    });
}
if (authLogoutBtn) {
    authLogoutBtn.addEventListener('click', async () => {
        try {
            await ensureCsrf();
            await apiFetch('/api/auth/logout', { method: 'POST' });
        } catch {}
        clearStoredSession();
        clearAuthToken();
        await refreshAuthUi();
        await loadDragSessionAndSyncHUD().catch(() => {});
        setBanner('Déconnecté.', 2, '#d6ddff');
    });
}

if (authForgotBtn) {
    authForgotBtn.addEventListener('click', async () => {
        const email = (authEmail && authEmail.value) ? String(authEmail.value).trim() : '';
        if (!email) {
            setBanner('Entrez votre email pour recevoir le lien de réinitialisation.', 3, '#ffe66d');
            return;
        }
        try {
            await ensureCsrf();
            await apiFetch('/api/auth/request-reset', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            setBanner('Email de réinitialisation envoyé. Vérifiez votre boîte de réception.', 4, '#7cffb0');
        } catch (e) {
            setBanner("Impossible d'envoyer l'email pour le moment.", 3, '#ff6b6b');
        }
    });
}

if (garageOverlay) {
    garageOverlay.addEventListener('click', (event) => {
        if (event.target === garageOverlay) {
            closeGarage();
        }
    });
}

function startRace() {
    closeGarage();

    game.state = 'countdown';
    game.countdown = 3;
    game.countdownTimer = 0;
    game.timer = 0;
    game.result = null;
    game.reward = 0;
    game.perfectWin = false;

    recalculateGearProfile();
    resetPlayer();
    setupOpponent();
    setBanner('Prépare-toi : 3, 2, 1... GO !', 3, '#7ecbff');
    startButton.textContent = 'Course en cours';
    startButton.disabled = true;
    // Masquer les boutons Start/Garage pendant la course
    setOverlayActionsVisible(false);
    // Masquer la barre d'authentification pendant la course
    setAuthBarVisible(false);
    // Pendant la course: ne montrer que piste + cadran + boutons
    setHudVisible(false);
    setStatusBannerVisible(false);
    setPlayfieldVisible(true);
    setTrackVisible(true);
    setGaugeVisible(true);
    setRaceControlsVisible(true);
    setFooterVisible(false);
}

function resetPlayer() {
    player.position = 0;
    player.speed = 0;
    player.rpm = RPM_IDLE;
    player.gear = 1;
    player.shiftMomentum = 0;
    player.limiterPenalty = 0;
    player.shiftText = '—';
    player.shiftTint = 'rgba(255,255,255,0.8)';
    player.shiftTimer = 0;
    player.finishTime = null;
    player.throttle = false;
    player.perfectShifts = 0;
    player.shiftsTaken = 0;
    player.nitroCharges = tuning.nitroCharges;
    player.nitroTimer = 0;
    player.nitroActive = false;
    player.launchApplied = false;

    resetThrottle();
    hudShift.textContent = '—';
    hudShift.style.color = 'rgba(255,255,255,0.8)';
    updateNitroButton();
    updateGearDisplay();
    setShiftButtonMode(false);
}

function setupOpponent() {
    opponent.position = 0;
    opponent.speed = 0;
    opponent.finishTime = null;
    opponent.targetTime = null;
    opponent.handicap = 1;
    opponent.shiftStumbleTimer = 0;
    opponent.stumbleInterval = null;

    if (playerRaceHistory.length < 2) {
        opponent.reactionDelay = 0.9;
        opponent.accel = 22 + game.stage * 2.8;
        opponent.maxSpeed = 150 + game.stage * 6;
        opponent.handicap = 0.4;
        opponent.stumbleInterval = 1.1 + Math.random() * 0.4;
        return;
    }

    const referenceTime = playerRaceHistory[1];
    const ghostTime = Math.max(referenceTime, 7);
    opponent.targetTime = ghostTime;
    opponent.reactionDelay = clamp(ghostTime * 0.08, 0.18, 0.45);
    const effectiveTime = Math.max(ghostTime - opponent.reactionDelay, 1.4);
    const targetKmH = clamp((TRACK_LENGTH_METERS / effectiveTime) * 3.6, 140, 360);
    opponent.maxSpeed = targetKmH * 1.04;
    opponent.accel = clamp(targetKmH * 0.9, 48, 155);
}

function updateLaunchControl(dt) {
    const targetRpm = player.throttle ? RPM_SHIFT_MAX + 300 : RPM_IDLE;
    const rampRate = player.throttle ? 4200 + (tuning.enginePower - 1) * 1200 : 3600;
    const rpmDelta = clamp(targetRpm - player.rpm, -rampRate * dt, rampRate * dt);
    player.rpm = clamp(player.rpm + rpmDelta, RPM_IDLE, RPM_MAX + 200);

    if (!player.throttle && player.rpm <= RPM_IDLE + 20) {
        player.rpm = RPM_IDLE;
    }

    player.position = 0;
    player.speed = 0;
}

function applyRaceLaunch() {
    if (player.launchApplied) {
        return;
    }

    player.launchApplied = true;
    const rpmAtLaunch = player.rpm;
    let feedback;
    let tint;
    let launchSpeed;
    let momentumDelta;

    if (rpmAtLaunch < 2800) {
        feedback = 'Départ trop mou';
        tint = '#ff6b6b';
        launchSpeed = 8;
        momentumDelta = -0.28;
    } else if (rpmAtLaunch < 4400) {
        feedback = 'Réaction lente';
        tint = '#ffe66d';
        launchSpeed = 14;
        momentumDelta = -0.12;
    } else if (rpmAtLaunch <= 6200) {
        feedback = 'Départ parfait !';
        tint = '#7cffb0';
        launchSpeed = 26;
        momentumDelta = 0.18;
    } else if (rpmAtLaunch <= RPM_REDLINE + 300) {
        feedback = 'Patinage';
        tint = '#ffad60';
        launchSpeed = 20;
        momentumDelta = -0.16;
    } else {
        feedback = 'Patinage violent';
        tint = '#ff6b6b';
        launchSpeed = 15;
        momentumDelta = -0.28;
    }

    player.speed = launchSpeed;
    player.position = 0;
    player.shiftMomentum = clamp(player.shiftMomentum + momentumDelta, -0.4, 0.45);
    setShiftFeedback(feedback, tint, false);

    player.rpm = clamp(rpmAtLaunch - 900, RPM_IDLE + 200, RPM_MAX - 400);
}

function handleShift() {
    if (game.state !== 'running') {
        return;
    }

    if (player.gear >= MAX_GEAR) {
        setShiftFeedback('Dernière vitesse', '#d6ddff', false);
        return;
    }

    const rpmBefore = player.rpm;
    let momentumDelta;
    let feedback;
    let tint;

    if (rpmBefore >= RPM_SHIFT_MIN && rpmBefore <= RPM_SHIFT_MAX) {
        feedback = 'Parfait !';
        momentumDelta = 0.32;
        tint = '#7cffb0';
    } else if (rpmBefore > RPM_SHIFT_MAX && rpmBefore <= RPM_REDLINE + 600) {
        feedback = 'Trop tard';
        momentumDelta = -0.2;
        tint = '#ffad60';
    } else if (rpmBefore > RPM_REDLINE + 600) {
        feedback = 'Au rupteur';
        momentumDelta = -0.32;
        tint = '#ff6b6b';
    } else {
        feedback = 'Trop tôt';
        momentumDelta = -0.18;
        tint = '#ffe66d';
    }

    const isPerfectShift = feedback === 'Parfait !';
    player.shiftMomentum = clamp(player.shiftMomentum + momentumDelta, -0.4, 0.45);
    player.shiftsTaken = Math.min(player.shiftsTaken + 1, MAX_GEAR - 1);
    if (isPerfectShift) {
        player.perfectShifts = Math.min(player.perfectShifts + 1, MAX_GEAR);
    }
    setShiftFeedback(feedback, tint, true);

    const nextGear = player.gear + 1;
    const currentProfile = gearProfile[player.gear];
    const nextProfile = gearProfile[nextGear];
    const ratio = currentProfile.topSpeed / nextProfile.topSpeed;
    player.rpm = clamp(rpmBefore * ratio * 0.98, RPM_IDLE + 300, RPM_MAX - 800);
    player.speed = Math.min(player.speed, nextProfile.topSpeed * 0.96);
    player.gear = nextGear;
    updateGearDisplay();
}

function updateThrottleState() {
    const enabled = (throttleState.keyboard || throttleState.pointer) && game.state !== 'finished';
    player.throttle = enabled;
    if (gasButton) {
        gasButton.classList.toggle('is-active', enabled);
    }
}

function setThrottleSource(source, active) {
    if (!Object.prototype.hasOwnProperty.call(throttleState, source)) {
        return;
    }
    throttleState[source] = Boolean(active);
    updateThrottleState();
}

function resetThrottle() {
    throttleState.keyboard = false;
    throttleState.pointer = false;
    updateThrottleState();
}

function updateNitroButton() {
    if (!nitroButton) {
        return;
    }
    const chargesLeft = Math.max(0, player.nitroCharges);
    const label = player.nitroActive ? 'Nitro !' : `Nitro (${chargesLeft})`;
    nitroButton.textContent = label;
    nitroButton.setAttribute('aria-label', label);
    nitroButton.classList.toggle('is-active', player.nitroActive);
    const isDepleted = !player.nitroActive && chargesLeft === 0;
    nitroButton.classList.toggle('is-disabled', isDepleted);
    nitroButton.disabled = isDepleted;
}

function activateNitro() {
    if (game.state !== 'running' || player.nitroActive || player.nitroCharges <= 0) {
        return;
    }
    player.nitroActive = true;
    player.nitroTimer = tuning.nitroDuration;
    player.nitroCharges = Math.max(0, player.nitroCharges - 1);
    updateNitroButton();
    setBanner('Nitro activé !', 1.4, '#9cd4ff');
}

function setShiftFeedback(text, tint, includeCount = false) {
    const displayText = includeCount && player.shiftsTaken > 0
        ? `${text} (${player.perfectShifts}/${player.shiftsTaken})`
        : text;
    player.shiftText = displayText;
    player.shiftTint = tint;
    player.shiftTimer = 1.6;
    hudShift.textContent = displayText;
    hudShift.style.color = tint;
}

// Bascule le gros bouton en mode SHIFTER pendant la course
function setShiftButtonMode(enabled) {
    if (!gasButton) return;
    if (enabled) {
        gasButton.textContent = 'SHIFT';
        gasButton.setAttribute('aria-label', 'Changer de vitesse');
        gasButton.classList.add('shift-mode');
    } else {
        gasButton.textContent = 'Accélérer';
        gasButton.setAttribute('aria-label', "Pédale d'accélérateur");
        gasButton.classList.remove('shift-mode');
    }
}

function setBanner(text, duration = 2, tint = '') {
    statusBanner.textContent = text;
    statusBanner.style.color = tint || 'rgba(220,230,255,0.8)';
    game.bannerTimer = duration;
    game.bannerColor = tint;
}

// Affiche/masque les actions (Start/Garage) dans l'overlay pendant la course
function setOverlayActionsVisible(visible) {
    if (!overlayActions) return;
    overlayActions.style.display = visible ? 'flex' : 'none';
}

// Affiche/masque la barre d'authentification pendant la course
function setAuthBarVisible(visible) {
    if (!authBar) return;
    authBar.style.display = visible ? 'flex' : 'none';
}

function setStatusBannerVisible(visible) {
    if (!statusBanner) return;
    statusBanner.style.display = visible ? 'block' : 'none';
}

function setHudVisible(visible) {
    if (!hudSection) return;
    hudSection.style.display = visible ? 'grid' : 'none';
}

function setPlayfieldVisible(visible) {
    if (!playfield) return;
    playfield.style.display = visible ? '' : 'none';
}

function setFooterVisible(visible) {
    if (!footerEl) return;
    footerEl.style.display = visible ? 'block' : 'none';
}

function setGaugeVisible(visible) {
    if (!gaugePanel) return;
    gaugePanel.style.display = visible ? '' : 'none';
}

function setRaceControlsVisible(visible) {
    if (gasButton) gasButton.style.display = visible ? '' : 'none';
    if (nitroButton) nitroButton.style.display = visible ? '' : 'none';
}

function setTrackVisible(visible) {
    if (!trackCanvas) return;
    trackCanvas.style.display = visible ? '' : 'none';
}

function openGarage() {
    if (!garageOverlay) {
        return;
    }
    updateGarageUI();
    garageOverlay.hidden = false;
    garageOverlay.style.display = 'flex';
}

function closeGarage() {
    if (!garageOverlay) {
        return;
    }
    garageOverlay.hidden = true;
    garageOverlay.style.display = 'none';
    if (startButton) {
        startButton.focus({ preventScroll: true });
    }
}

function resetTuningToDefaults() {
    for (let gear = 1; gear <= MAX_GEAR; gear += 1) {
        tuning.gearMultipliers[gear] = 1;
    }
    tuning.enginePower = 1;
    tuning.nitroPower = 1.4;
    tuning.nitroDuration = 1.5;
    tuning.nitroCharges = 1;
    if (game.state !== 'running') {
        player.nitroCharges = tuning.nitroCharges;
    }
    updateNitroButton();
    recalculateGearProfile();
}

function recordPlayerTime(timeSeconds) {
    if (!Number.isFinite(timeSeconds) || timeSeconds <= 0) {
        return;
    }
    playerRaceHistory.push(timeSeconds);
    playerRaceHistory.sort((a, b) => a - b);
    if (playerRaceHistory.length > 10) {
        playerRaceHistory.splice(10);
    }
}

function updateGarageUI() {
    for (let gear = 1; gear <= MAX_GEAR; gear += 1) {
        const sliderEntry = gearSliders[gear];
        if (!sliderEntry) {
            continue;
        }
        const value = tuning.gearMultipliers[gear];
        sliderEntry.slider.value = value.toFixed(2);
        sliderEntry.value.textContent = `${value.toFixed(2)}×`;
    }

    if (engineSlider && engineValue) {
        engineSlider.value = tuning.enginePower.toFixed(2);
        engineValue.textContent = `${tuning.enginePower.toFixed(2)}×`;
    }

    if (nitroPowerSlider && nitroPowerValue) {
        nitroPowerSlider.value = tuning.nitroPower.toFixed(2);
        nitroPowerValue.textContent = `${tuning.nitroPower.toFixed(2)}×`;
    }

    if (nitroDurationSlider && nitroDurationValue) {
        nitroDurationSlider.value = tuning.nitroDuration.toFixed(1);
        nitroDurationValue.textContent = `${tuning.nitroDuration.toFixed(1)} s`;
    }

    if (nitroChargesSlider && nitroChargesValue) {
        nitroChargesSlider.value = tuning.nitroCharges.toString(10);
        nitroChargesValue.textContent = `${tuning.nitroCharges}`;
    }
}

function initializeGarageUI() {
    if (!gearSliderList) {
        return;
    }
    gearSliderList.innerHTML = '';
    gearSliders.length = MAX_GEAR + 1;
    for (let gear = 1; gear <= MAX_GEAR; gear += 1) {
        const group = document.createElement('div');
        group.className = 'slider-group';

        const sliderId = `gearSlider${gear}`;
        const label = document.createElement('label');
        label.setAttribute('for', sliderId);
        label.textContent = `Rapport ${gear}`;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.min = '0.75';
        slider.max = '1.3';
        slider.step = '0.01';
        slider.value = tuning.gearMultipliers[gear].toFixed(2);

        const valueDisplay = document.createElement('span');
        valueDisplay.className = 'slider-value';
        valueDisplay.textContent = `${tuning.gearMultipliers[gear].toFixed(2)}×`;

        slider.addEventListener('input', () => {
            const rawValue = Number(slider.value);
            const clamped = clamp(rawValue, 0.75, 1.3);
            tuning.gearMultipliers[gear] = Number(clamped.toFixed(2));
            valueDisplay.textContent = `${tuning.gearMultipliers[gear].toFixed(2)}×`;
            recalculateGearProfile();
        });

        group.append(label, slider, valueDisplay);
        gearSliderList.append(group);
        gearSliders[gear] = { slider, value: valueDisplay };
    }

    if (engineSlider && engineValue) {
        engineSlider.addEventListener('input', () => {
            const rawValue = parseFloat(engineSlider.value);
            tuning.enginePower = Number(clamp(rawValue, 0.9, 1.7).toFixed(2));
            engineValue.textContent = `${tuning.enginePower.toFixed(2)}×`;
        });
    }

    if (nitroPowerSlider && nitroPowerValue) {
        nitroPowerSlider.addEventListener('input', () => {
            const rawValue = parseFloat(nitroPowerSlider.value);
            tuning.nitroPower = Number(clamp(rawValue, 1, 1.9).toFixed(2));
            nitroPowerValue.textContent = `${tuning.nitroPower.toFixed(2)}×`;
        });
    }

    if (nitroDurationSlider && nitroDurationValue) {
        nitroDurationSlider.addEventListener('input', () => {
            const rawValue = parseFloat(nitroDurationSlider.value);
            tuning.nitroDuration = Number(clamp(rawValue, 0.6, 3).toFixed(1));
            nitroDurationValue.textContent = `${tuning.nitroDuration.toFixed(1)} s`;
        });
    }

    if (nitroChargesSlider && nitroChargesValue) {
        nitroChargesSlider.addEventListener('input', () => {
            const rawValue = parseInt(nitroChargesSlider.value, 10);
            tuning.nitroCharges = clamp(Number.isNaN(rawValue) ? 1 : rawValue, 1, 3);
            nitroChargesSlider.value = tuning.nitroCharges.toString(10);
            nitroChargesValue.textContent = `${tuning.nitroCharges}`;
            if (game.state !== 'running') {
                player.nitroCharges = tuning.nitroCharges;
                updateNitroButton();
            }
        });
    }

    updateGarageUI();
}

function update(dt) {
    switch (game.state) {
        case 'idle':
            break;
        case 'countdown':
            updateLaunchControl(dt);
            game.countdownTimer += dt;
            if (game.countdownTimer >= 1) {
                game.countdown -= 1;
                game.countdownTimer = 0;
                if (game.countdown <= 0) {
                    applyRaceLaunch();
                    setBanner('GO !', 1.2, '#7cffb0');
                    game.state = 'running';
                    // Auto‑throttle et bouton principal en mode shifter
                    try { throttleState.keyboard = true; } catch {}
                    updateThrottleState();
                    setShiftButtonMode(true);
                    game.timer = 0;
                    startButton.textContent = 'Course en cours';
                    updateGearDisplay();
                }
            }
            break;
        case 'running':
            game.timer += dt;
            updatePlayer(dt);
            updateOpponent(dt);
            checkFinish();
            break;
        case 'finished':
            game.timer = 0;
            break;
        default:
            break;
    }

    if (player.shiftTimer > 0) {
        player.shiftTimer = Math.max(0, player.shiftTimer - dt);
        if (player.shiftTimer === 0) {
            hudShift.textContent = '—';
            hudShift.style.color = 'rgba(255,255,255,0.8)';
        }
    }

    if (game.bannerTimer > 0) {
        game.bannerTimer = Math.max(0, game.bannerTimer - dt);
        if (game.bannerTimer === 0) {
            statusBanner.textContent = 'Maintiens la pédale (flèche haut ou bouton), déclenche le nitro (N/X ou bouton) et shift dans la zone verte.';
            statusBanner.style.color = 'rgba(220,230,255,0.8)';
        }
    }

    drawTrack();
    drawRpmGauge();
    updateHud();
}

function updatePlayer(dt) {
    const profile = gearProfile[player.gear];
    const stageBoost = 1 + (game.stage - 1) * 0.025;
    const momentumBoost = 1 + player.shiftMomentum * 0.5;
    const engineBoost = tuning.enginePower;
    const nitroBoost = player.nitroActive ? tuning.nitroPower : 1;
    const rpmGainBase = profile.accelFactor * 1400 * engineBoost;

    if (player.throttle) {
        let rpmGain = rpmGainBase * stageBoost * momentumBoost;
        if (player.nitroActive) {
            rpmGain *= 1.25;
        }
        player.rpm += rpmGain * dt;
    } else {
        const engineBrake = 2200 + Math.max(0, player.rpm - RPM_IDLE) * 0.35;
        player.rpm -= engineBrake * dt;
    }

    if (player.rpm > RPM_MAX) {
        player.rpm = Math.min(player.rpm, RPM_MAX + 180);
        player.limiterPenalty = clamp(player.limiterPenalty + dt * 1.6, 0, 1);
    } else {
        player.limiterPenalty = clamp(player.limiterPenalty - dt * 2.2, 0, 1);
    }

    player.rpm = clamp(player.rpm, RPM_IDLE, RPM_MAX + 180);

    const rpmRatio = clamp((player.rpm - RPM_IDLE) / (RPM_MAX - RPM_IDLE), 0, 1);
    const limiterFactor = 1 - player.limiterPenalty * 0.55;

    if (player.throttle) {
        const baseAccel = 16;
        let acceleration = baseAccel * profile.accelFactor * (0.28 + rpmRatio * 0.88) * momentumBoost * limiterFactor;
        acceleration *= engineBoost * nitroBoost;
        acceleration = Math.max(0, acceleration);
        player.speed += acceleration * dt;
    } else {
        const coastDrag = 24 + player.speed * 0.2;
        player.speed = Math.max(0, player.speed - coastDrag * dt);
        player.shiftMomentum = clamp(player.shiftMomentum - dt * 0.12, -0.4, 0.45);
    }

    const topSpeedBonus = player.nitroActive ? 1.08 : 1;
    player.speed = Math.min(player.speed, profile.topSpeed * topSpeedBonus);

    const metersPerSecond = player.speed / 3.6;
    player.position += metersPerSecond * dt;

    if (player.finishTime === null && player.position >= TRACK_LENGTH_METERS) {
        // Interpolate finish time so winner detection stays stable on variable frame rates.
        const overshoot = player.position - TRACK_LENGTH_METERS;
        const speedMps = Math.max(metersPerSecond, 0.01);
        const extraTime = overshoot / speedMps;
        player.finishTime = Math.max(0, game.timer - extraTime);
    }

    if (player.nitroActive) {
        player.nitroTimer = Math.max(0, player.nitroTimer - dt);
        if (player.nitroTimer === 0) {
            player.nitroActive = false;
            updateNitroButton();
        }
    }
}

function updateOpponent(dt) {
    if (game.timer < opponent.reactionDelay) {
        return;
    }

    if (opponent.targetTime) {
        const elapsed = Math.max(0, game.timer - opponent.reactionDelay);
        const remainingDistance = Math.max(0, TRACK_LENGTH_METERS - opponent.position);

        if (remainingDistance <= 0) {
            opponent.finishTime = opponent.finishTime ?? game.timer;
            enforceOpponentFinishFloor();
        } else {
            const timeRemaining = Math.max(opponent.targetTime - elapsed, 0.35);
            const requiredSpeed = (remainingDistance / timeRemaining) * 3.6;
            const accelStep = opponent.accel * dt;
            const speedDelta = requiredSpeed - opponent.speed;
            const maxDecel = accelStep * 1.4;
            opponent.speed += clamp(speedDelta, -maxDecel, accelStep);
            opponent.speed = clamp(opponent.speed, 0, opponent.maxSpeed);
            opponent.position += (opponent.speed / 3.6) * dt;
        }
    } else {
        opponent.speed += opponent.accel * opponent.handicap * dt;
        opponent.speed = Math.min(opponent.speed, opponent.maxSpeed * opponent.handicap);
        opponent.shiftStumbleTimer += dt;
        if (opponent.stumbleInterval && opponent.shiftStumbleTimer >= opponent.stumbleInterval) {
            opponent.shiftStumbleTimer = 0;
            opponent.speed *= 0.55 + Math.random() * 0.1;
        }
        opponent.position += (opponent.speed / 3.6) * dt;
    }

    if (opponent.finishTime === null && opponent.position >= TRACK_LENGTH_METERS) {
        const overshoot = opponent.position - TRACK_LENGTH_METERS;
        const speedMps = Math.max(opponent.speed / 3.6, 0.01);
        const extraTime = overshoot / speedMps;
        opponent.finishTime = Math.max(0, game.timer - extraTime);
        enforceOpponentFinishFloor();
    }
}

function enforceOpponentFinishFloor() {
    if (opponent.finishTime === null || playerRaceHistory.length < 2) {
        return;
    }
    const minAllowed = playerRaceHistory[1];
    if (opponent.finishTime < minAllowed) {
        opponent.finishTime = minAllowed;
    }
}

function checkFinish() {
    if (player.finishTime === null && opponent.finishTime === null) {
        return;
    }

    if (player.finishTime !== null && opponent.finishTime === null) {
        finishRace(true);
        return;
    }

    if (player.finishTime === null && opponent.finishTime !== null) {
        finishRace(false);
        return;
    }

    if (player.finishTime !== null && opponent.finishTime !== null) {
        finishRace(player.finishTime <= opponent.finishTime);
    }
}

async function finishRace(playerWins) {
    game.state = 'finished';
    startButton.textContent = 'Rejouer';
    startButton.disabled = false;
    // Ré-afficher les actions une fois la course terminée
    setOverlayActionsVisible(true);
    // Ré-afficher la barre d'authentification après la course
    setAuthBarVisible(true);
    // Après la course: cacher piste/cadran/boutons pour laisser la place au reste,
    // mais garder le conteneur visible pour afficher les actions (Rejouer/Garage)
    setTrackVisible(false);
    setGaugeVisible(false);
    setRaceControlsVisible(false);
    setHudVisible(true);
    setStatusBannerVisible(true);
    setFooterVisible(true);
    resetThrottle();
    setShiftButtonMode(false);
    activeThrottlePointer = null;
    activeNitroPointer = null;
    player.nitroActive = false;
    player.nitroTimer = 0;
    updateNitroButton();

    const forcedWin = player.perfectShifts >= 4;
    const finalWin = playerWins || forcedWin;
    game.perfectWin = forcedWin;

    // Affichage immédiat côté client (serveur reste autorité pour cash/stage/récompense)
    if (finalWin) {
        const tentativePayout = VICTORY_PAYOUT;
        const payoutText = tentativePayout.toLocaleString('fr-CA');
        game.reward = tentativePayout; // valeur provisoire, sera remplacée par la réponse serveur
        const bannerText = forcedWin ? `Victoire parfaite ! +${payoutText} $` : `Victoire ! +${payoutText} $`;
        setBanner(bannerText, 4, '#7cffb0');
        if (player.finishTime !== null) {
            recordPlayerTime(player.finishTime);
        }
        game.result = 'win';
    } else {
        setBanner('Défaite... retente ta chance.', 4, '#ff6b6b');
        game.result = 'loss';
    }

    // Envoi des résultats au serveur Millionnaire
    try {
        const sess = await ensureSession();
        const elapsedMs = Math.max(1, Math.round(((player.finishTime ?? game.timer) || 0) * 1000));
        const payload = {
            stage: game.stage,
            elapsedMs,
            win: finalWin,
            perfectShifts: player.perfectShifts,
            reward: finalWin ? VICTORY_PAYOUT : 0,
            deviceInfo: {
                ua: (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
                w: (typeof window !== 'undefined' ? window.innerWidth : 0),
                h: (typeof window !== 'undefined' ? window.innerHeight : 0),
                tz: (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? (Intl.DateTimeFormat().resolvedOptions().timeZone || '') : '')
            }
        };
        const resp = await apiFetch(`/api/games/${sess.gameId}/drag/result`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Mise à jour depuis le serveur (autorité)
        const newCash = Number(resp?.player?.cash ?? game.cash);
        const newStage = Number(resp?.drag?.stage ?? game.stage);
        const granted = Number(resp?.grantedReward ?? (finalWin ? VICTORY_PAYOUT : 0));
        game.cash = Number.isFinite(newCash) ? newCash : game.cash;
        game.stage = Number.isFinite(newStage) ? newStage : game.stage;
        game.reward = Number.isFinite(granted) ? granted : game.reward;

        // Ajuster la bannière si la récompense a été bloquée (cooldown, etc.)
        if (finalWin && game.reward <= 0) {
            setBanner('Victoire enregistrée (cooldown récompense).', 4, '#d6ddff');
        }
        updateHud();
    } catch (err) {
        // En cas d'échec réseau ou 4xx/5xx, on garde l’état visuel, mais on n’altère pas le cash localement
        setBanner('Serveur indisponible. Résultat enregistré localement.', 4, '#ffe66d');
    } finally {
        handleRaceCompletedForAds();
    }
}

function updateHud() {
    hudStage.textContent = game.state === 'finished' && game.result === 'win' ? game.stage - 1 : game.stage;
    hudCash.textContent = `${game.cash.toLocaleString('fr-CA')} $`;

    if (game.state === 'running') {
        hudTime.textContent = `${game.timer.toFixed(2)} s`;
    } else {
        hudTime.textContent = '0.00 s';
    }
}

function updateGearDisplay() {
    if (game.state === 'idle') {
        gearValue.textContent = 'N';
        return;
    }

    gearValue.textContent = player.gear.toString();
}

function drawTrack() {
    const { width, height } = trackCanvas;

    const skyGradient = trackCtx.createLinearGradient(0, 0, 0, height);
    skyGradient.addColorStop(0, '#141726');
    skyGradient.addColorStop(0.5, '#11131f');
    skyGradient.addColorStop(1, '#090a11');
    trackCtx.fillStyle = skyGradient;
    trackCtx.fillRect(0, 0, width, height);

    const trackTop = 120;
    const trackBottom = height - 80;
    const trackGradient = trackCtx.createLinearGradient(0, trackTop, 0, trackBottom);
    trackGradient.addColorStop(0, '#454a67');
    trackGradient.addColorStop(0.5, '#2a2e46');
    trackGradient.addColorStop(1, '#202337');
    trackCtx.fillStyle = trackGradient;
    trackCtx.fillRect(60, trackTop, width - 120, trackBottom - trackTop);

    trackCtx.fillStyle = 'rgba(255,255,255,0.08)';
    trackCtx.fillRect(60, (trackTop + trackBottom) / 2 - 2, width - 120, 4);

    drawFinishLine(width - 160, trackTop, trackBottom);

    drawCrowdLights(trackTop, width);

    const laneOffset = 60;
    const progressPlayer = clamp(player.position / TRACK_LENGTH_METERS, 0, 1);
    const progressOpponent = clamp(opponent.position / TRACK_LENGTH_METERS, 0, 1);
    const carStart = 130;
    const carEnd = width - 210;
    const playerX = carStart + progressPlayer * (carEnd - carStart);
    const opponentX = carStart + progressOpponent * (carEnd - carStart);

    drawCar(opponentX, (trackTop + trackBottom) / 2 - laneOffset, '#6c8bff', '#2035ff');
    drawCar(playerX, (trackTop + trackBottom) / 2 + laneOffset - 30, '#ff5f7a', '#ff1f5a');

    if (game.state === 'countdown') {
        trackCtx.fillStyle = 'rgba(0,0,0,0.4)';
        trackCtx.fillRect(0, 0, width, height);
        trackCtx.fillStyle = '#ffffff';
        trackCtx.font = '900 160px Rajdhani, sans-serif';
        trackCtx.textAlign = 'center';
        trackCtx.textBaseline = 'middle';
        trackCtx.shadowColor = 'rgba(124,255,176,0.7)';
        trackCtx.shadowBlur = 18;
        trackCtx.fillText(game.countdown.toString(), width / 2, height / 2);
        trackCtx.shadowBlur = 0;
    }

    if (game.state === 'finished') {
        trackCtx.fillStyle = 'rgba(0,0,0,0.5)';
        trackCtx.fillRect(0, 0, width, height);
        trackCtx.textAlign = 'center';
        trackCtx.textBaseline = 'middle';
        trackCtx.font = '800 64px Rajdhani, sans-serif';
        trackCtx.fillStyle = game.result === 'win' ? '#7cffb0' : '#ff6b6b';
        const message = game.result === 'win'
            ? (game.perfectWin ? `Victoire parfaite ! +${game.reward} $` : `Victoire ! +${game.reward} $`)
            : 'Défaite';
        trackCtx.fillText(message, width / 2, height / 2 - 20);
        if (game.result === 'win') {
            trackCtx.font = '600 28px Rajdhani, sans-serif';
            trackCtx.fillStyle = '#d6ddff';
            const sub = game.perfectWin ? '4 shifts parfaits sur 5 — avantage acquis !' : 'Prochaine distance plus difficile...';
            trackCtx.fillText(sub, width / 2, height / 2 + 32);
        }
    }

    trackCtx.textAlign = 'left';
    trackCtx.textBaseline = 'alphabetic';
    trackCtx.font = '600 20px Rajdhani, sans-serif';
    trackCtx.fillStyle = '#d9dcff';
    trackCtx.fillText(`Vitesse: ${Math.round(player.speed)} km/h`, 80, height - 32);
    trackCtx.fillText(`Distance: ${Math.min(TRACK_LENGTH_METERS, Math.round(player.position))} m`, 280, height - 32);
}

function drawFinishLine(x, top, bottom) {
    const stripeHeight = 16;
    for (let y = top; y < bottom; y += stripeHeight) {
        trackCtx.fillStyle = (Math.floor((y - top) / stripeHeight) % 2 === 0) ? '#f5f7ff' : '#1a1c2b';
        trackCtx.fillRect(x, y, 34, stripeHeight);
    }
}

function drawCrowdLights(trackTop, width) {
    // Soft moving light halos to give a subtle sense of spectators and production.
    trackCtx.save();
    trackCtx.globalAlpha = 0.45;
    for (let i = 0; i < 16; i++) {
        const lightX = 80 + i * ((width - 160) / 15);
        const radius = 28 + (Math.sin((performance.now() / 600) + i) + 1) * 6;
        const gradient = trackCtx.createRadialGradient(lightX, trackTop - 24, 0, lightX, trackTop - 24, radius);
        gradient.addColorStop(0, 'rgba(255,255,255,0.7)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        trackCtx.fillStyle = gradient;
        trackCtx.beginPath();
        trackCtx.arc(lightX, trackTop - 24, radius, 0, Math.PI * 2);
        trackCtx.fill();
    }
    trackCtx.restore();
}

function drawCar(x, y, bodyColor, accentColor) {
    trackCtx.save();
    const carWidth = 120;
    const carHeight = 42;
    const gradient = trackCtx.createLinearGradient(x, y, x, y + carHeight);
    gradient.addColorStop(0, lightenColor(bodyColor, 0.35));
    gradient.addColorStop(0.5, bodyColor);
    gradient.addColorStop(1, darkenColor(bodyColor, 0.35));

    trackCtx.fillStyle = gradient;
    drawRoundedRect(trackCtx, x, y, carWidth, carHeight, 12);

    trackCtx.fillStyle = accentColor;
    trackCtx.fillRect(x + carWidth * 0.62, y + 8, carWidth * 0.14, carHeight - 16);

    trackCtx.fillStyle = 'rgba(255,255,255,0.32)';
    trackCtx.fillRect(x + 12, y + 10, carWidth * 0.38, carHeight - 20);

    drawWheel(x + carWidth * 0.22, y + carHeight + 6);
    drawWheel(x + carWidth * 0.78, y + carHeight + 6);

    trackCtx.restore();
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
}

function drawWheel(cx, cy) {
    trackCtx.fillStyle = '#05060a';
    trackCtx.beginPath();
    trackCtx.arc(cx, cy, 12, 0, Math.PI * 2);
    trackCtx.fill();
    trackCtx.fillStyle = '#8b90a8';
    trackCtx.beginPath();
    trackCtx.arc(cx, cy, 7, 0, Math.PI * 2);
    trackCtx.fill();
}

function drawRpmGauge() {
    const { width, height } = rpmCanvas;
    rpmCtx.clearRect(0, 0, width, height);

    const centerX = width / 2;
    const centerY = height / 2 + 40;
    const radius = Math.min(width, height) / 2 - 24;
    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;

    rpmCtx.beginPath();
    rpmCtx.arc(centerX, centerY, radius + 12, startAngle, endAngle);
    rpmCtx.strokeStyle = 'rgba(255,255,255,0.06)';
    rpmCtx.lineWidth = 22;
    rpmCtx.stroke();

    drawGaugeArc(centerX, centerY, radius, startAngle, endAngle, RPM_SHIFT_MIN / RPM_MAX, RPM_SHIFT_MAX / RPM_MAX, '#7cffb0');
    drawGaugeArc(centerX, centerY, radius, startAngle, endAngle, RPM_SHIFT_MAX / RPM_MAX, 1, '#ff6b6b');
    drawGaugeArc(centerX, centerY, radius, startAngle, endAngle, 0, RPM_SHIFT_MIN / RPM_MAX, '#3b3f56');

    rpmCtx.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
        const ratio = i / 8;
        const angle = startAngle + ratio * (endAngle - startAngle);
        const inner = radius - 10;
        const outer = radius + 10;
        rpmCtx.strokeStyle = 'rgba(214,219,240,0.7)';
        rpmCtx.beginPath();
        rpmCtx.moveTo(centerX + Math.cos(angle) * inner, centerY + Math.sin(angle) * inner);
        rpmCtx.lineTo(centerX + Math.cos(angle) * outer, centerY + Math.sin(angle) * outer);
        rpmCtx.stroke();

        rpmCtx.fillStyle = 'rgba(214,219,240,0.6)';
        rpmCtx.font = '600 16px Rajdhani, sans-serif';
        rpmCtx.textAlign = 'center';
        rpmCtx.textBaseline = 'middle';
        const labelRadius = radius + 24;
        rpmCtx.fillText((i * 1).toString(), centerX + Math.cos(angle) * labelRadius, centerY + Math.sin(angle) * labelRadius);
    }

    const rpmRatio = clamp(player.rpm / RPM_MAX, 0, 1);
    const needleAngle = startAngle + rpmRatio * (endAngle - startAngle);
    rpmCtx.strokeStyle = '#f9f9ff';
    rpmCtx.lineWidth = 4;
    rpmCtx.beginPath();
    rpmCtx.moveTo(centerX, centerY);
    rpmCtx.lineTo(centerX + Math.cos(needleAngle) * (radius - 18), centerY + Math.sin(needleAngle) * (radius - 18));
    rpmCtx.stroke();

    rpmCtx.fillStyle = '#ff6b8b';
    rpmCtx.beginPath();
    rpmCtx.arc(centerX, centerY, 8, 0, Math.PI * 2);
    rpmCtx.fill();

    rpmCtx.fillStyle = '#f5f7ff';
    rpmCtx.font = '700 28px Rajdhani, sans-serif';
    rpmCtx.textAlign = 'center';
    rpmCtx.fillText(`${Math.round(player.rpm)} RPM`, centerX, centerY - radius / 2);
}

function drawGaugeArc(cx, cy, radius, startAngle, endAngle, startRatio, endRatio, color) {
    rpmCtx.beginPath();
    rpmCtx.arc(cx, cy, radius, startAngle + startRatio * (endAngle - startAngle), startAngle + endRatio * (endAngle - startAngle));
    rpmCtx.strokeStyle = color;
    rpmCtx.lineWidth = 18;
    const previousCap = rpmCtx.lineCap;
    rpmCtx.lineCap = 'round';
    rpmCtx.stroke();
    rpmCtx.lineCap = previousCap;
}

function lightenColor(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const toHex = (value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
    return `#${toHex(r + (255 - r) * amount)}${toHex(g + (255 - g) * amount)}${toHex(b + (255 - b) * amount)}`;
}

function darkenColor(hex, amount) {
    const { r, g, b } = hexToRgb(hex);
    const toHex = (value) => Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
    return `#${toHex(r * (1 - amount))}${toHex(g * (1 - amount))}${toHex(b * (1 - amount))}`;
}

function hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const bigint = parseInt(clean, 16);
    return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastFrame) / 1000, 0.05);
    lastFrame = timestamp;
    update(dt);
    requestAnimationFrame(gameLoop);
}

initializeGarageUI();
player.nitroCharges = tuning.nitroCharges;
updateNitroButton();
updateThrottleState();
updateGearDisplay();
if (garageOverlay) {
    garageOverlay.style.display = 'none';
}
setBanner('Lance la course, maintiens la pédale (flèche haut ou bouton), utilise le nitro (N/X ou bouton) et shift dans la zone verte.', 6, '#d6ddff');
// Appliquer taille 16:9 et recalculer à chaque rotation/redimensionnement
resizeCanvases();
window.addEventListener('resize', () => { resizeCanvases(); });
requestAnimationFrame(gameLoop);

// Synchroniser l’état initial (banque/niveau) depuis le serveur au chargement
refreshAuthUi().then(() => loadDragSessionAndSyncHUD().catch(() => {}));
