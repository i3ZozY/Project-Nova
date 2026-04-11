// Project Nova – Frontend Script

(function () {
    'use strict';

    // Theme color tokens
    const NOVA = {
        bgPrimary:     '#0e0e24',
        bgSecondary:   '#16163a',
        bgTertiary:    'rgba(14, 14, 36, 0.92)',
        bgHover:       'rgba(32, 32, 62, 0.95)',
        bgContainer:   'rgba(22, 22, 46, 0.78)',
        accent:        '#a855f7',
        accentLight:   '#c084fc',
        accentDark:    '#7e22ce',
        border:        'rgba(168, 85, 247, 0.45)',
        borderHover:   'rgba(192, 132, 252, 0.9)',
        text:          '#f5f3ff',
        textSecondary: '#ddd6fe',
        gradient:      'linear-gradient(135deg, #a855f7 0%, #4c1d95 100%)',
        gradientLight: 'linear-gradient(135deg, #c084fc 0%, #a855f7 100%)',
        shadow:        'rgba(168, 85, 247, 0.5)',
        shadowHover:   'rgba(168, 85, 247, 0.8)',
        rgbString:     '168, 85, 247'
    };

    // ─── Utilities ──────────────────────────────────────────────────────────────

    function isBigPictureMode() {
        const c = document.documentElement.className;
        const ua = navigator.userAgent;
        let s = 0;
        if (c.includes('BasicUI')) s += 3;
        if (c.includes('DesktopUI')) s -= 3;
        if (ua.includes('Valve Steam Gamepad')) s += 2;
        if (ua.includes('Valve Steam Client')) s -= 2;
        if (c.includes('touch')) s += 1;
        return s > 0;
    }
    window.__PROJECTNOVA_IS_BIG_PICTURE__ = isBigPictureMode();

    function openUrl(url) {
        if (typeof Millennium !== 'undefined')
            Millennium.callServerMethod('projectnova', 'OpenExternalUrl', { url, contentScriptQuery: '' });
        else window.open(url, '_blank');
    }

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    function friendlyError(error) {
        if (!error) return 'The operation could not be completed. Please check your App ID and try again.';
        const e = String(error).toLowerCase();
        if (e.includes('exit code 1') || e.includes('exit code: 1') || e.includes('exited with 1') || e.includes('script exited with code 1'))
            return 'The process could not complete. This usually means the App ID is wrong, the game is not supported by this method, or the files could not be found on the server. Please double-check your App ID and try a different download method.';
        if (e.includes('exit code 2') || e.includes('exit code: 2'))
            return 'The process stopped unexpectedly. The App ID may be incorrect or the server is temporarily unavailable. Please try again or switch to a different download method.';
        if (e.includes('exit code'))
            return 'The process stopped with an error. Please try again or choose a different download method.';
        if (e.includes('api key') || e.includes('api_key') || e.includes('unauthorized') || e.includes('401') || e.includes('403'))
            return 'Your API key is missing or invalid. Open Settings → API Keys and make sure you have entered the correct key.';
        if (e.includes('timeout') || e.includes('timed out'))
            return 'The connection timed out. Check your internet connection and try again.';
        if (e.includes('not found') || e.includes('404'))
            return 'The required files could not be found for this game. The game may not be supported by this download method — try a different one.';
        if (e.includes('network') || e.includes('connection refused') || e.includes('econnrefused'))
            return 'A network error occurred. Check your internet connection and try again.';
        if (e.includes('no internet') || e.includes('offline'))
            return 'You appear to be offline. Check your internet connection and try again.';
        return 'Something went wrong. Details: ' + error;
    }

    // ─── Image Cache ───────────────────────────────────────────────────

    // In-memory LRU cache for resolved image URLs (max 100 app IDs)
    window.__PN_IMAGE_CACHE__ = window.__PN_IMAGE_CACHE__ || {};
    const PN_CACHE_MAX = 100;

    function pnCacheGet(key) {
        const entry = window.__PN_IMAGE_CACHE__[key];
        if (!entry) return null;
        entry.ts = Date.now();
        return entry.url;
    }

    function pnCacheSet(key, url) {
        const cache = window.__PN_IMAGE_CACHE__;
        const keys = Object.keys(cache);
        if (keys.length >= PN_CACHE_MAX) {
            // Evict the least recently used entry
            let lru = keys[0];
            for (const k of keys) if (cache[k].ts < cache[lru].ts) lru = k;
            delete cache[lru];
        }
        cache[key] = { url, ts: Date.now() };
    }

    // ─── Game Data / Image Helpers ───────────────────────────────────────────────

    const steamGameNameCache = {};

    function fetchSteamGameName(appid) {
        if (!appid) return Promise.resolve(null);
        if (steamGameNameCache[appid]) return Promise.resolve(steamGameNameCache[appid]);
        return fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`)
            .then(r => r.json())
            .then(d => {
                if (d?.[appid]?.success && d[appid].data?.name) {
                    steamGameNameCache[appid] = d[appid].data.name;
                    return d[appid].data.name;
                }
                return null;
            })
            .catch(() => null);
    }

    function getCDNUrl(appid, type) {
        return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/${type}`;
    }

    // Fetches header/capsule/background URLs from the Steam API, with caching
    const steamImageApiCache = {};
    function fetchSteamStoreImages(appid) {
        // Check per-field cache first
        const hk = `${appid}:header`, ck = `${appid}:capsule`, bk = `${appid}:background`;
        const hc = pnCacheGet(hk), cc = pnCacheGet(ck), bc = pnCacheGet(bk);
        if (hc && cc) return Promise.resolve({ header: hc, capsule: cc, background: bc });

        if (steamImageApiCache[appid]) return steamImageApiCache[appid];

        const req = fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`)
            .then(r => r.json())
            .then(d => {
                const data = d[appid]?.data;
                const urls = data ? {
                    header:     data.header_image  || null,
                    capsule:    data.capsule_image  || null,
                    background: data.background     || null,
                } : {};
                if (urls.header)     pnCacheSet(`${appid}:header`,     urls.header);
                if (urls.capsule)    pnCacheSet(`${appid}:capsule`,    urls.capsule);
                if (urls.background) pnCacheSet(`${appid}:background`, urls.background);
                return urls;
            })
            .catch(() => ({}));

        steamImageApiCache[appid] = req;
        req.finally(() => { delete steamImageApiCache[appid]; });
        return req;
    }

    // Tries Steam API first, then CDN fallbacks, resolves to a usable background URL
    function getBestBackgroundUrl(appid) {
        const bgCached = pnCacheGet(`${appid}:background`) || pnCacheGet(`${appid}:header`);
        if (bgCached) return Promise.resolve(bgCached);

        return new Promise(resolve => {
            fetchSteamStoreImages(appid).then(api => {
                const url = api.header || api.background || api.capsule;
                if (url) return resolve(url);

                const cdnCandidates = [
                    getCDNUrl(appid, 'header.jpg'),
                    getCDNUrl(appid, 'capsule_616x353.jpg'),
                    getCDNUrl(appid, 'page_bg_generated_v6b.jpg'),
                ];
                let idx = 0;
                const tryNext = () => {
                    if (idx >= cdnCandidates.length) return resolve(null);
                    const img = new Image();
                    img.onload = () => { pnCacheSet(`${appid}:background`, cdnCandidates[idx]); resolve(cdnCandidates[idx]); };
                    img.onerror = () => { idx++; tryNext(); };
                    img.src = cdnCandidates[idx];
                };
                tryNext();
            }).catch(() => resolve(null));
        });
    }

    // Creates an <img> that walks through fallback CDN URLs if the primary fails
    function loadImageWithFallbacks(imgElement, appid, preferredType, fallbackTypes, style) {
        imgElement.style.cssText = style;
        const tryCdn = () => {
            const urls = fallbackTypes.map(t => getCDNUrl(appid, t));
            let i = 0;
            const next = () => {
                if (i < urls.length) { imgElement.src = urls[i++]; }
                else imgElement.style.display = 'none';
            };
            imgElement.onerror = next;
            next();
        };
        fetchSteamStoreImages(appid).then(apiUrls => {
            let url = null;
            if (preferredType.includes('header')) url = apiUrls.header;
            else if (preferredType.includes('capsule')) url = apiUrls.capsule;
            if (!url) url = apiUrls.header || apiUrls.capsule || apiUrls.background;
            if (url) { imgElement.src = url; imgElement.onerror = () => tryCdn(); }
            else tryCdn();
        }).catch(() => tryCdn());
    }

    function makeImgWithFallback(appid, preferredType, fallbackTypes, style) {
        const img = document.createElement('img');
        loadImageWithFallbacks(img, appid, preferredType, fallbackTypes, style);
        return img;
    }

    // Game thumbnail — uses contain so no part of the logo is cropped
    function makeGameThumb(appid, width, height, radius) {
        return makeImgWithFallback(
            appid, 'capsule',
            ['capsule_sm_120.jpg', 'capsule_231x87.jpg', 'header.jpg', 'logo.png'],
            `max-width:${width}px;max-height:${height}px;width:auto;height:auto;` +
            `border-radius:${radius}px;object-fit:contain;background:#0a0a1a;` +
            `border:1px solid rgba(168,85,247,0.25);`
        );
    }

    // ─── Reusable Game Info Box ──────────────────────────────────────────────────
    // Builds the bordered card with game background, thumbnail, name, and app id.
    // Used across: Add preview, Download popup, Success modal, Remove confirm,
    //              Import success, Installed Games list items.
    function createGameInfoBox(appid, gameName, opts = {}) {
        const box = document.createElement('div');
        box.style.cssText = `
            position: relative;
            border-radius: 18px;
            padding: ${opts.compact ? '14px 16px' : '20px 18px'};
            margin-bottom: 16px;
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            background-image: linear-gradient(145deg, #1a1a3e, #0f0f2a);
            border: 2px solid rgba(168,85,247,0.5);
            box-shadow: inset 0 0 0 1000px rgba(13,13,34,0.55), 0 4px 24px rgba(0,0,0,0.4);
            overflow: hidden;
        `;

        const inner = document.createElement('div');
        inner.style.cssText = 'position:relative;z-index:2;display:flex;align-items:center;gap:14px;';

        const thumb = makeGameThumb(appid, opts.thumbW || 120, opts.thumbH || 68, 8);
        inner.appendChild(thumb);

        const text = document.createElement('div');
        text.style.flex = '1';
        text.innerHTML = `
            <div style="font-weight:700;font-size:${opts.nameSize || '17px'};color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.7);">
                ${gameName || 'Unknown Game'}
            </div>
            <div style="font-size:12px;color:#e0d0ff;text-shadow:0 1px 4px rgba(0,0,0,0.6);margin-top:3px;">
                App ID: ${appid}
            </div>
        `;
        inner.appendChild(text);
        box.appendChild(inner);

        // Asynchronously apply the real background image
        getBestBackgroundUrl(appid).then(bgUrl => {
            if (bgUrl) {
                const img = new Image();
                img.onload = () => { box.style.backgroundImage = `url('${bgUrl}')`; };
                img.onerror = () => {};
                img.src = bgUrl;
            }
        });

        return box;
    }

    // ─── Backend helpers ─────────────────────────────────────────────────────────

    function fetchGamesDatabase() {
        if (typeof Millennium === 'undefined') return Promise.resolve({});
        return Millennium.callServerMethod('projectnova', 'GetGamesDatabase', { contentScriptQuery: '' })
            .then(res => { let p = (res && (res.result || res.value)) || res; if (typeof p === 'string') p = JSON.parse(p); return p || {}; })
            .catch(() => ({}));
    }

    function fetchFixes(appid) {
        if (typeof Millennium === 'undefined') return Promise.resolve(null);
        return Millennium.callServerMethod('projectnova', 'CheckForFixes', { appid, contentScriptQuery: '' })
            .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; return (p && p.success) ? p : null; })
            .catch(() => null);
    }

    function fetchSettingsConfig(forceRefresh) {
        if (!forceRefresh && window.__ProjectNovaSettings?.schema) return Promise.resolve(window.__ProjectNovaSettings);
        if (typeof Millennium === 'undefined') return Promise.reject(new Error('Backend unavailable'));
        return Millennium.callServerMethod('projectnova', 'GetSettingsConfig', { contentScriptQuery: '' })
            .then(res => {
                const p = typeof res === 'string' ? JSON.parse(res) : res;
                if (!p?.success) throw new Error(p?.error || 'Failed');
                const cfg = { schemaVersion: p.schemaVersion || 0, schema: p.schema || [], values: p.values || {} };
                window.__ProjectNovaSettings = cfg;
                return cfg;
            });
    }

    function getCurrentAppId() {
        const m = window.location.href.match(/\/app\/(\d+)/);
        return m ? parseInt(m[1], 10) : null;
    }

    // ─── CSS Styles ──────────────────────────────────────────────────────────────

    function generateThemeStyles() {
        return `
        body, html { overflow-x: hidden !important; }
        .pn-overlay, .pn-overlay * { box-sizing: border-box; }

        .pn-overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.82);
            backdrop-filter: blur(16px) saturate(1.2);
            z-index: 100000;
            display: flex; align-items: center; justify-content: center;
            animation: pnOverlayIn 0.25s ease;
            overflow: hidden !important;
        }

        @keyframes pnOverlayIn  { from { opacity:0; } to { opacity:1; } }
        @keyframes pnModalIn    { from { opacity:0; transform:scale(0.92) translateY(20px); } to { opacity:1; transform:scale(1) translateY(0); } }
        @keyframes pnCardIn     { from { opacity:0; transform:translateX(-18px); } to { opacity:1; transform:translateX(0); } }
        @keyframes pnShimmer    { 0% { background-position:-600px 0; } 100% { background-position:600px 0; } }
        @keyframes pnToastIn    { from { opacity:0; transform:translateY(20px) scale(0.93); } to { opacity:1; transform:translateY(0) scale(1); } }
        @keyframes pnToastOut   { from { opacity:1; transform:translateY(0) scale(1); } to { opacity:0; transform:translateY(12px) scale(0.95); } }
        @keyframes pnSpinner    { to { transform: rotate(360deg); } }
        @keyframes pnFadeOut    { from { opacity:1; transform:scale(1); } to { opacity:0; transform:scale(0.96); } }
        @keyframes pnBarPulse   { 0%,100% { opacity:1; } 50% { opacity:0.7; } }

        .pn-modal {
            position: relative;
            background: linear-gradient(150deg, #0f0f27 0%, #171738 100%);
            color: ${NOVA.text};
            border: 1px solid rgba(168,85,247,0.38);
            border-radius: 22px;
            width: 590px; max-width: 96vw; max-height: 88vh;
            padding: 26px 30px;
            box-shadow:
                0 32px 100px rgba(0,0,0,0.75),
                0 0 0 1px rgba(168,85,247,0.15),
                inset 0 1px 0 rgba(255,255,255,0.05);
            animation: pnModalIn 0.32s cubic-bezier(0.23, 1, 0.32, 1);
            display: flex; flex-direction: column;
            overflow: visible !important;
            background-size: cover;
            background-position: center top;
        }

        .pn-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 22px;
            padding-bottom: 18px;
            border-bottom: 1px solid rgba(168,85,247,0.22);
            flex-shrink: 0;
            overflow: visible !important;
        }
        .pn-modal-title {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 20px;
            color: ${NOVA.text};
            font-weight: 700;
            letter-spacing: -0.015em;
        }
        .pn-modal-title-icon {
            width: 30px; height: 30px; border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
        }
        .pn-modal-close, .pn-back-btn {
            display: flex; align-items: center; justify-content: center;
            width: 38px; height: 38px;
            background: rgba(168,85,247,0.08);
            border: 1px solid rgba(168,85,247,0.3);
            border-radius: 11px; color: ${NOVA.accentLight};
            font-size: 16px; text-decoration: none; cursor: pointer; flex-shrink: 0;
            transition: background 0.25s, border-color 0.25s,
                        transform 0.28s cubic-bezier(0.34,1.56,0.64,1),
                        box-shadow 0.25s, color 0.25s;
        }
        .pn-modal-close:hover, .pn-back-btn:hover {
            background: rgba(168,85,247,0.18); border-color: ${NOVA.accentLight};
            transform: scale(1.06); box-shadow: 0 0 14px rgba(168,85,247,0.45); color: #fff;
        }
        .pn-modal-body {
            flex: 1; overflow-y: auto !important; overflow-x: hidden !important;
            font-size: 14px; line-height: 1.6; color: ${NOVA.textSecondary};
            scrollbar-width: thin; scrollbar-color: rgba(168,85,247,0.5) transparent;
            padding: 6px 16px 6px 0; margin-right: -16px; word-wrap: break-word;
        }
        .pn-modal-body::-webkit-scrollbar { width: 5px; }
        .pn-modal-body::-webkit-scrollbar-track { background: transparent; }
        .pn-modal-body::-webkit-scrollbar-thumb { background: rgba(168,85,247,0.4); border-radius: 99px; }

        /* Buttons */
        .pn-btn {
            padding: 10px 20px;
            background: rgba(168,85,247,0.08);
            border: 1px solid rgba(168,85,247,0.35);
            border-radius: 12px; color: ${NOVA.text};
            font-size: 14px; font-weight: 600; text-decoration: none;
            transition:
                background 0.25s ease, border-color 0.25s ease,
                box-shadow 0.25s ease, color 0.25s ease,
                transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1);
            cursor: pointer;
            display: inline-flex; align-items: center; justify-content: center;
            gap: 8px; white-space: nowrap; position: relative;
            overflow: visible !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            will-change: transform; transform: translateZ(0); backface-visibility: hidden;
        }
        .pn-btn:hover:not([data-disabled="1"]) {
            background: rgba(168,85,247,0.18); border-color: ${NOVA.accentLight};
            transform: scale(1.03); box-shadow: 0 6px 20px rgba(168,85,247,0.4);
            color: #fff; z-index: 20;
        }
        .pn-btn.primary {
            background: ${NOVA.gradient}; border-color: transparent;
            color: #fff; font-weight: 700;
            box-shadow: 0 4px 16px rgba(168,85,247,0.4);
        }
        .pn-btn.primary:hover:not([data-disabled="1"]) {
            background: ${NOVA.gradientLight}; transform: scale(1.03);
            box-shadow: 0 8px 24px rgba(168,85,247,0.55);
        }
        .pn-btn.danger {
            background: rgba(239,68,68,0.09); border-color: rgba(239,68,68,0.38);
            color: #fca5a5;
        }
        .pn-btn.danger:hover:not([data-disabled="1"]) {
            background: rgba(239,68,68,0.22); border-color: #f87171;
            color: #fff; transform: scale(1.03);
            box-shadow: 0 6px 20px rgba(239,68,68,0.38);
        }
        .pn-btn.secondary {
            background: rgba(168,85,247,0.05);
            border-color: rgba(168,85,247,0.25);
            color: ${NOVA.textSecondary};
            font-size: 13px; padding: 8px 14px;
        }
        .pn-btn.secondary:hover:not([data-disabled="1"]) {
            background: rgba(168,85,247,0.14); border-color: ${NOVA.accentLight};
            color: #fff; transform: scale(1.02);
        }

        /* Toggle */
        .pn-toggle { position:relative; display:inline-block; width:48px; height:24px; flex-shrink:0; }
        .pn-toggle input { opacity:0; width:0; height:0; }
        .pn-slider {
            position:absolute; cursor:pointer; top:0; left:0; right:0; bottom:0;
            background:rgba(255,255,255,0.13); transition:0.25s; border-radius:24px;
            border:1px solid rgba(255,255,255,0.1);
        }
        .pn-slider:before {
            position:absolute; content:""; height:18px; width:18px; left:3px; bottom:2px;
            background:#fff; transition:0.25s; border-radius:50%; box-shadow:0 2px 4px rgba(0,0,0,0.3);
        }
        input:checked + .pn-slider { background:${NOVA.accent}; border-color:${NOVA.accent}; }
        input:checked + .pn-slider:before { transform:translateX(24px); }

        /* Cards */
        .pn-card {
            display:flex; align-items:center; gap:16px;
            padding:16px 18px;
            background:rgba(168,85,247,0.05);
            border:1px solid rgba(168,85,247,0.22);
            border-radius:16px; cursor:pointer;
            transition:
                background 0.25s ease, border-color 0.25s ease,
                transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.25s ease;
            margin-bottom:10px; text-decoration:none; color:inherit;
            animation:pnCardIn 0.4s cubic-bezier(0.23, 1, 0.32, 1) backwards;
            overflow:visible !important; will-change:transform;
            transform:translateZ(0); backface-visibility:hidden; margin-right:8px;
        }
        .pn-card:hover {
            background:rgba(168,85,247,0.11); border-color:${NOVA.accentLight};
            transform:translateX(3px) scale(1.01);
            box-shadow:0 8px 28px rgba(168,85,247,0.25); z-index:15;
        }
        .pn-card-icon {
            width:44px; height:44px; border-radius:12px;
            background:rgba(168,85,247,0.13); border:1px solid rgba(168,85,247,0.3);
            display:flex; align-items:center; justify-content:center;
            font-size:18px; color:${NOVA.accentLight}; flex-shrink:0;
            transition:background 0.25s, border-color 0.25s,
                        transform 0.28s cubic-bezier(0.34,1.56,0.64,1);
        }
        .pn-card:hover .pn-card-icon { background:rgba(168,85,247,0.24); border-color:${NOVA.accentLight}; transform:scale(1.06); }
        .pn-card-label { font-weight:700; font-size:15px; color:${NOVA.text}; margin-bottom:2px; }
        .pn-card-desc  { font-size:12px; color:${NOVA.textSecondary}; opacity:0.85; }

        /* Card stagger */
        .pn-card:nth-child(1)  { animation-delay:0.04s; }
        .pn-card:nth-child(2)  { animation-delay:0.10s; }
        .pn-card:nth-child(3)  { animation-delay:0.16s; }
        .pn-card:nth-child(4)  { animation-delay:0.22s; }
        .pn-card:nth-child(5)  { animation-delay:0.28s; }
        .pn-card:nth-child(6)  { animation-delay:0.34s; }
        .pn-card:nth-child(7)  { animation-delay:0.40s; }
        .pn-card:nth-child(8)  { animation-delay:0.46s; }
        .pn-card:nth-child(9)  { animation-delay:0.52s; }
        .pn-card:nth-child(10) { animation-delay:0.58s; }

        /* Progress bar */
        .pn-progress-wrap {
            background: rgba(0,0,0,0.45);
            border-radius: 14px;
            border: 1px solid rgba(168,85,247,0.28);
            padding: 3px;
            margin: 12px 0 6px;
        }
        .pn-progress-track {
            background: rgba(0,0,0,0.4);
            height: 14px; border-radius: 11px;
            overflow: hidden; position: relative;
        }
        .pn-progress-fill {
            height: 100%; width: 0%;
            background: linear-gradient(90deg, #6d28d9, #a855f7, #c084fc, #a855f7, #6d28d9);
            background-size: 400% 100%;
            animation: pnShimmer 2.4s linear infinite;
            border-radius: 11px;
            transition: width 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            position: relative;
        }
        .pn-progress-fill::after {
            content: ''; position: absolute; top: 0; right: 0;
            width: 60px; height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35));
            border-radius: 0 11px 11px 0;
        }
        .pn-progress-fill.done {
            background: linear-gradient(90deg, #166534, #16a34a, #22c55e) !important;
            animation: none !important;
        }
        .pn-progress-label {
            display: flex; justify-content: space-between;
            font-size: 12px; font-weight: 600;
            color: ${NOVA.accentLight}; margin-top: 6px;
            letter-spacing: 0.02em;
        }

        /* Search */
        .pn-search-wrap { position:relative; margin-bottom:20px; }
        .pn-search {
            width:100%; padding:12px 16px 12px 44px;
            background:rgba(168,85,247,0.07); border:1px solid rgba(168,85,247,0.32);
            border-radius:14px; color:${NOVA.text}; font-size:14px; outline:none;
            transition:border-color 0.25s, box-shadow 0.25s;
        }
        .pn-search:focus { border-color:${NOVA.accent}; box-shadow:0 0 0 3px rgba(168,85,247,0.18); }
        .pn-search-icon {
            position:absolute; left:14px; top:50%; transform:translateY(-50%);
            color:${NOVA.textSecondary}; font-size:16px;
        }

        /* Section labels */
        .pn-section-label {
            font-size:10.5px; font-weight:800; letter-spacing:0.14em;
            text-transform:uppercase; color:${NOVA.accentLight};
            margin:26px 0 10px; opacity:0.78; padding-left:2px;
        }

        /* Inputs & selects */
        .pn-input, .pn-select {
            width:100%; padding:10px 14px;
            background:rgba(8,8,22,0.8); color:${NOVA.text};
            border:1px solid rgba(168,85,247,0.32);
            border-radius:10px; font-size:14px; outline:none;
            transition:border-color 0.25s, box-shadow 0.25s;
        }
        .pn-input:focus, .pn-select:focus {
            border-color:${NOVA.accent}; box-shadow:0 0 0 3px rgba(168,85,247,0.18);
        }
        .pn-select {
            cursor:pointer; appearance:none;
            background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%23ddd6fe' stroke-width='1.5' fill='none'/%3E%3C/svg%3E");
            background-repeat:no-repeat; background-position:right 12px center;
            background-color:rgba(8,8,22,0.8); padding-right:36px;
        }

        /* Message boxes */
        .pn-info-box {
            background:rgba(168,85,247,0.08); border-left:3px solid ${NOVA.accent};
            padding:13px 17px; border-radius:0 12px 12px 0;
            color:${NOVA.textSecondary}; margin-bottom:16px;
            font-size:13px; line-height:1.65;
        }
        .pn-warn-box {
            background:rgba(255,193,7,0.08); border-left:3px solid #ffc107;
            padding:13px 17px; border-radius:0 12px 12px 0;
            color:#ffd966; margin-bottom:16px; font-size:13px; line-height:1.65;
        }
        .pn-success-box {
            background:rgba(92,184,92,0.09); border-left:3px solid #22c55e;
            padding:13px 17px; border-radius:0 12px 12px 0;
            color:#86efac; margin-bottom:16px; font-size:13px; line-height:1.65;
        }
        .pn-error-box {
            background:rgba(239,68,68,0.09); border-left:3px solid #f87171;
            padding:13px 17px; border-radius:0 12px 12px 0;
            color:#fca5a5; margin-bottom:16px; font-size:13px; line-height:1.65;
        }

        /* Game items in lists */
        .pn-game-item {
            position: relative; overflow: hidden;
            display:flex; justify-content:space-between; align-items:center;
            border-radius:16px; margin-bottom:12px;
            border:1px solid rgba(168,85,247,0.25);
            transition:border-color 0.25s, box-shadow 0.25s,
                        transform 0.28s cubic-bezier(0.34,1.56,0.64,1);
            will-change:transform; transform:translateZ(0); backface-visibility:hidden;
            min-height: 90px;
        }
        .pn-game-item:hover {
            border-color:${NOVA.accentLight};
            transform:scale(1.01);
            box-shadow:0 6px 20px rgba(168,85,247,0.2);
            z-index:5;
        }
        /* Background layer inside game item */
        .pn-game-item-bg {
            position:absolute; inset:0; z-index:0;
            background-size:cover; background-position:center;
            opacity:0; transition:opacity 0.4s ease;
        }
        .pn-game-item-bg.loaded { opacity:1; }
        .pn-game-item-overlay {
            position:absolute; inset:0; z-index:1;
            background:rgba(10,10,30,0.82);
        }
        .pn-game-item-content {
            position:relative; z-index:2;
            display:flex; justify-content:space-between; align-items:center;
            width:100%; padding:14px 16px;
        }

        /* Header Button */
        .projectnova-header-button {
            display: inline-flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 36px !important;
            height: 36px !important;
            border-radius: 12px !important;
            background: rgba(168,85,247,0.25) !important;
            border: 1px solid rgba(168,85,247,0.4) !important;
            cursor: pointer !important;
            margin-left: 8px !important;
            margin-top: 0 !important;
            margin-bottom: 0 !important;
            vertical-align: middle !important;
            line-height: 1 !important;
            align-self: center !important;
            flex-shrink: 0 !important;
            transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, transform 0.28s cubic-bezier(0.34,1.56,0.64,1) !important;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2) !important;
            text-decoration: none !important;
            position: relative !important;
            top: 0 !important;
            bottom: 0 !important;
            will-change: transform;
            transform: translateZ(0);
            backface-visibility: hidden;
        }
        .projectnova-header-button:hover {
            background: rgba(168,85,247,0.45) !important;
            border-color: #c084fc !important;
            box-shadow: 0 0 14px rgba(168,85,247,0.5) !important;
            transform: scale(1.08) !important;
            z-index: 10 !important;
        }
        .projectnova-header-button:hover {
            background:rgba(168,85,247,0.48) !important;
            border-color:#c084fc !important;
            box-shadow:0 0 16px rgba(168,85,247,0.55) !important;
            transform:scale(1.08) !important;
        }

        /* Steam page injected buttons */
        a.projectnova-button, a.projectnova-restart-button, a.projectnova-remove-button {
            transition:background 0.25s, border-color 0.25s, box-shadow 0.25s,
                        color 0.25s, transform 0.28s cubic-bezier(0.34,1.56,0.64,1) !important;
            will-change:transform; transform:translateZ(0); backface-visibility:hidden;
        }
        a.projectnova-button:hover, a.projectnova-restart-button:hover, a.projectnova-remove-button:hover {
            background:rgba(168,85,247,0.24) !important;
            border-color:rgba(192,132,252,0.82) !important;
            box-shadow:0 4px 20px rgba(168,85,247,0.42) !important;
            color:#fff !important; text-decoration:none !important;
            transform:scale(1.02) !important;
        }

        /* Toast — slides up from bottom, stacks vertically */
        .pn-toast-stack {
            position: fixed; bottom: 24px; right: 24px; z-index: 200000;
            display: flex; flex-direction: column-reverse; gap: 10px;
            pointer-events: none;
        }
        .pn-toast {
            pointer-events: all;
            padding: 13px 16px 0 16px;
            border-radius: 14px;
            background: linear-gradient(135deg, #18183c 0%, #1e1e48 100%);
            border: 1px solid rgba(168,85,247,0.55);
            color: ${NOVA.text}; font-size: 14px; font-weight: 600;
            box-shadow: 0 16px 48px rgba(0,0,0,0.65), 0 0 0 1px rgba(168,85,247,0.18);
            display: flex; flex-direction: column;
            animation: pnToastIn 0.38s cubic-bezier(0.22,1,0.36,1);
            max-width: 380px; min-width: 260px; cursor: pointer;
            transition: box-shadow 0.2s, transform 0.2s;
            overflow: hidden;
        }
        .pn-toast:hover { box-shadow: 0 18px 54px rgba(0,0,0,0.7), 0 0 0 1px rgba(168,85,247,0.35); transform: translateY(-2px); }
        .pn-toast.exit  { animation: pnToastOut 0.3s ease forwards; pointer-events: none; }
        .pn-toast-row   { display: flex; align-items: center; gap: 12px; padding-bottom: 13px; }
        .pn-toast-icon  { font-size: 20px; flex-shrink: 0; }
        .pn-toast-icon.success { color: #22c55e; }
        .pn-toast-icon.error   { color: #f87171; }
        .pn-toast-icon.info    { color: ${NOVA.accentLight}; }
        .pn-toast-icon.warning { color: #fbbf24; }
        .pn-toast-close {
            margin-left: auto; flex-shrink: 0;
            color: rgba(255,255,255,0.35); font-size: 13px;
            transition: color 0.15s; padding: 2px 4px;
        }
        .pn-toast:hover .pn-toast-close { color: rgba(255,255,255,0.75); }
        .pn-toast-timer {
            height: 3px; width: 100%; background: rgba(255,255,255,0.1);
            border-radius: 0 0 14px 14px;
            position: relative; overflow: hidden;
        }
        .pn-toast-timer-fill {
            position: absolute; left: 0; top: 0; height: 100%; width: 100%;
            border-radius: 0 0 14px 14px;
            transition: width linear;
        }
        .pn-toast-timer-fill.success { background: #22c55e; }
        .pn-toast-timer-fill.error   { background: #f87171; }
        .pn-toast-timer-fill.info    { background: ${NOVA.accentLight}; }
        .pn-toast-timer-fill.warning { background: #fbbf24; }

        /* API key layout */
        .pn-apikey-row {
            display:flex; align-items:center; gap:14px;
            padding:16px 18px;
            background:rgba(168,85,247,0.05);
            border:1px solid rgba(168,85,247,0.22);
            border-radius:14px; margin-bottom:12px;
            transition:border-color 0.25s; flex-wrap:wrap;
        }
        .pn-apikey-row:hover { border-color:rgba(168,85,247,0.45); }
        .pn-apikey-info { flex:1; min-width:120px; }
        .pn-apikey-info-name { font-size:14px; font-weight:600; color:${NOVA.text}; margin-bottom:2px; }
        .pn-apikey-info-desc { font-size:11px; color:${NOVA.textSecondary}; opacity:0.8; line-height:1.4; }
        .pn-apikey-input-wrap { display:flex; align-items:center; gap:10px; flex:2; min-width:200px; }
        .pn-apikey-input-wrap .pn-input { flex:1; min-width:0; }

        /* Manifest controls */
        .pn-manifest-controls {
            display:flex; gap:12px; align-items:stretch; margin-bottom:14px;
        }
        .pn-manifest-controls .pn-select { flex:1; }
        .pn-manifest-controls .pn-btn { white-space:nowrap; }

        /* Utility */
        .pn-flex-row { display:flex; gap:12px; align-items:center; }
        .pn-flex-col { display:flex; flex-direction:column; gap:8px; }
        .pn-w-100   { width:100%; }
        .pn-mt-4    { margin-top:16px; }
        .pn-mb-4    { margin-bottom:16px; }
    `;
    }

    function ensureNovaTheme() {
        const existing = document.getElementById('projectnova-theme-styles');
        if (existing) existing.remove();
        const s = document.createElement('style');
        s.id = 'projectnova-theme-styles';
        s.textContent = generateThemeStyles();
        document.head.appendChild(s);
    }

    function ensureFontAwesome() {
        if (document.getElementById('projectnova-fontawesome')) return;
        const link = document.createElement('link');
        link.id = 'projectnova-fontawesome';
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
        link.integrity = 'sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==';
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
    }

    // ─── Toast ───────────────────────────────────────────────────────────────────

    function _getOrCreateToastStack() {
        let stack = document.getElementById('pn-toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'pn-toast-stack';
            stack.className = 'pn-toast-stack';
            document.body.appendChild(stack);
        }
        return stack;
    }

    // Slides up from bottom-right, stacks multiple toasts, auto-dismisses with timer bar
    function showToast(message, type = 'success', duration = 5000) {
        const stack = _getOrCreateToastStack();

        // Cap stacked toasts at 4
        while (stack.children.length >= 4) {
            const oldest = stack.lastElementChild;
            if (oldest) { oldest.classList.add('exit'); setTimeout(() => oldest.remove(), 300); }
            if (stack.children.length >= 4) stack.lastElementChild?.remove();
        }

        const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info', warning: 'fa-triangle-exclamation' };
        const toast = document.createElement('div');
        toast.className = 'pn-toast';

        toast.innerHTML = `
            <div class="pn-toast-row">
                <i class="fa-solid ${icons[type] || icons.info} pn-toast-icon ${type}"></i>
                <span style="flex:1;line-height:1.45;">${message}</span>
                <i class="fa-solid fa-xmark pn-toast-close"></i>
            </div>
            <div class="pn-toast-timer"><div class="pn-toast-timer-fill ${type}" style="width:100%;transition-duration:${duration}ms;"></div></div>
        `;

        stack.prepend(toast);

        // Start timer bar shrink on next frame
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const fill = toast.querySelector('.pn-toast-timer-fill');
            if (fill) fill.style.width = '0%';
        }));

        const dismiss = () => {
            clearTimeout(timer);
            toast.classList.add('exit');
            setTimeout(() => toast.remove(), 320);
        };
        const timer = setTimeout(dismiss, duration);
        toast.addEventListener('click', dismiss);
    }

    // ─── Nova Icon ───────────────────────────────────────────────────────────────

    const NOVA_SVG = `<svg fill="#e31be5" width="24" height="24" viewBox="0 0 504 504"><path d="M495.947,111.21c-18.032-31.24-62.452-43.284-125.068-33.92c-6.476,0.976-10.94,7.008-9.968,13.488 c0.964,6.48,7.008,10.944,13.48,9.98c51.556-7.712,88.372,0.42,101.012,22.316c24.088,41.72-39.852,138.192-173.432,215.312 c-61.076,35.264-123.98,58.544-177.132,65.56c-48.868,6.448-83.876-1.936-96.048-23.016c-12.636-21.892-1.284-57.828,31.14-98.592 c4.076-5.128,3.228-12.588-1.9-16.668c-5.116-4.08-12.584-3.228-16.664,1.896C1.979,317.09-9.785,361.562,8.243,392.794 c14.02,24.272,44.172,37,86.408,37c10.392,0,21.508-0.776,33.292-2.336c56.16-7.412,122.18-31.752,185.888-68.532 C450.571,279.978,530.563,171.17,495.947,111.21z"/><path d="M252.099,38.574c-117.684,0-213.432,95.744-213.432,213.428c0,69.496,33.408,131.32,84.984,170.32 c5.712-0.348,11.656-0.92,17.828-1.74c53.152-7.012,116.06-30.296,177.132-65.56c66.98-38.668,116.436-82.204,146.084-121.264 C455.403,124.59,363.631,38.574,252.099,38.574z"/><path d="M330.471,375.566c-59.5,34.352-121.008,57.84-174.616,66.832c28.936,14.692,61.624,23.028,96.248,23.028 c111.5,0,203.248-85.964,212.588-195.088C431.775,306.83,385.767,343.642,330.471,375.566z"/></svg>`;
    let _novaIconDataUrl = null;

    function loadIconIntoElement(el, size) {
        const fallback = () => { el.innerHTML = NOVA_SVG.replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`); };
        if (_novaIconDataUrl) {
            const img = document.createElement('img');
            img.src = _novaIconDataUrl; img.style.cssText = `width:${size}px;height:${size}px;`;
            el.innerHTML = ''; el.appendChild(img); return;
        }
        if (typeof Millennium !== 'undefined') {
            Millennium.callServerMethod('projectnova', 'GetIconDataUrl', {})
                .then(res => {
                    try {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (p?.success && p.dataUrl) {
                            _novaIconDataUrl = p.dataUrl;
                            const img = document.createElement('img');
                            img.src = _novaIconDataUrl; img.style.cssText = `width:${size}px;height:${size}px;`;
                            el.innerHTML = ''; el.appendChild(img); return;
                        }
                    } catch (_) {}
                    fallback();
                }).catch(fallback);
        } else fallback();
    }

    // ─── Core Modal ──────────────────────────────────────────────────────────────

    function createModal(titleText, contentCallback, onClose, opts = {}) {
        const overlay = document.createElement('div');
        overlay.className = 'pn-overlay';

        // Track whether we've already navigated away (prevents double-navigation)
        let _navigated = false;
        const safeNavigate = (fn) => {
            if (_navigated) return;
            _navigated = true;
            if (overlay.parentNode) overlay.remove();
            if (fn) setTimeout(() => { try { fn(); } catch (_) {} }, 55);
        };

        overlay.addEventListener('mousedown', e => {
            if (e.target === overlay) {
                safeNavigate(onClose || null);
            }
        });

        const modal = document.createElement('div');
        modal.className = 'pn-modal';
        if (opts.bgImage) {
            modal.style.backgroundImage = `linear-gradient(rgba(8,8,22,0.9), rgba(10,10,26,0.96)), url(${opts.bgImage})`;
            modal.style.backgroundSize = 'cover';
            modal.style.backgroundPosition = 'center top';
            modal.style.backgroundRepeat = 'no-repeat';
        }

        const header = document.createElement('div');
        header.className = 'pn-modal-header';

        if (opts.backAction && !opts.isMainMenu) {
            const backBtn = document.createElement('a');
            backBtn.href = '#'; backBtn.className = 'pn-back-btn'; backBtn.title = 'Go back';
            backBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            backBtn.onclick = e => {
                e.preventDefault(); e.stopPropagation();
                safeNavigate(opts.backAction);
            };
            header.appendChild(backBtn);
        }

        const titleSpan = document.createElement('div');
        titleSpan.className = 'pn-modal-title';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'pn-modal-title-icon';
        loadIconIntoElement(iconSpan, 24);
        titleSpan.appendChild(iconSpan);
        titleSpan.appendChild(document.createTextNode(' ' + titleText));
        header.appendChild(titleSpan);

        const headerRight = document.createElement('div');
        headerRight.style.cssText = 'display:flex;gap:10px;';

        // FAQ button
        if (opts.faqAction) {
            const faqBtn = document.createElement('a');
            faqBtn.href = '#';
            faqBtn.className = 'pn-modal-close';
            faqBtn.style.cssText = 'position:static;transform:none;';
            faqBtn.title = 'FAQ';
            faqBtn.innerHTML = '<i class="fa-regular fa-circle-question"></i>';
            faqBtn.onclick = e => { e.preventDefault(); safeNavigate(opts.faqAction); };
            headerRight.appendChild(faqBtn);
        }

        // Settings button (NEW)
        if (opts.settingsAction) {
            const settingsBtn = document.createElement('a');
            settingsBtn.href = '#';
            settingsBtn.className = 'pn-modal-close';
            settingsBtn.style.cssText = 'position:static;transform:none;';
            settingsBtn.title = 'Settings';
            settingsBtn.innerHTML = '<i class="fa-solid fa-gear"></i>';
            settingsBtn.onclick = e => { e.preventDefault(); safeNavigate(opts.settingsAction); };
            headerRight.appendChild(settingsBtn);
        }

        const closeBtn = document.createElement('a');
        closeBtn.href = '#';
        closeBtn.className = 'pn-modal-close';
        closeBtn.style.cssText = 'position:static;transform:none;';
        closeBtn.title = 'Close';
        closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
        closeBtn.onclick = e => { e.preventDefault(); safeNavigate(onClose || null); };
        headerRight.appendChild(closeBtn);
        header.appendChild(headerRight);

        const body = document.createElement('div');
        body.className = 'pn-modal-body';
        body.style.cssText = 'font-weight:500;text-align:center;';

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        contentCallback(body, overlay, safeNavigate);
        return overlay;
    }

    function ShowProjectNovaAlert(title, message, parentOverlay) {
        createModal(title, body => {
            body.style.textAlign = 'left';
            body.innerHTML = `<p style="color:${NOVA.textSecondary};line-height:1.7;">${message}</p>`;
        }, () => { if (parentOverlay) parentOverlay.remove(); });
    }

    function showProjectNovaConfirm(title, message, onConfirm, onCancel) {
        createModal(title, (body, overlay, safeNavigate) => {
            body.style.textAlign = 'left';
            const p = document.createElement('p');
            p.style.cssText = `color:${NOVA.textSecondary};line-height:1.7;margin-bottom:24px;`;
            p.textContent = message;
            body.appendChild(p);
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:12px;justify-content:center;';
            const cancelBtn = document.createElement('a');
            cancelBtn.href = '#'; cancelBtn.className = 'pn-btn';
            cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i><span>Cancel</span>';
            cancelBtn.onclick = e => { e.preventDefault(); safeNavigate(onCancel || null); };
            const okBtn = document.createElement('a');
            okBtn.href = '#'; okBtn.className = 'pn-btn primary';
            okBtn.innerHTML = '<i class="fa-solid fa-check"></i><span>Confirm</span>';
            okBtn.onclick = e => { e.preventDefault(); safeNavigate(onConfirm || null); };
            row.appendChild(cancelBtn); row.appendChild(okBtn);
            body.appendChild(row);
        });
    }

    // Confirmation modal that shows a game info box before asking
    function showRemoveConfirmWithGameBox(appid, gameName, onConfirm, onCancel) {
        const overlay = createModal('Remove Game', (body, overlay, safeNavigate) => {
            body.style.textAlign = 'left';
            body.style.padding = '0';

            const box = createGameInfoBox(appid, gameName);
            body.appendChild(box);

            const msg = document.createElement('p');
            msg.style.cssText = `color:${NOVA.textSecondary};line-height:1.7;margin-bottom:20px;font-size:14px;`;
            msg.textContent = `Are you sure you want to remove "${gameName || 'this game'}" from your library?`;
            body.appendChild(msg);

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:12px;justify-content:center;';

            const cancelBtn = document.createElement('a');
            cancelBtn.href = '#'; cancelBtn.className = 'pn-btn';
            cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Keep it';
            cancelBtn.onclick = e => { e.preventDefault(); safeNavigate(onCancel || null); };

            const removeBtn = document.createElement('a');
            removeBtn.href = '#'; removeBtn.className = 'pn-btn danger';
            removeBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>&nbsp;Remove';
            removeBtn.onclick = e => { e.preventDefault(); safeNavigate(onConfirm || null); };

            row.appendChild(cancelBtn); row.appendChild(removeBtn);
            body.appendChild(row);
        });
        const modalEl = overlay.querySelector('.pn-modal');
        if (modalEl) modalEl.style.width = '700px';
    }

    function showGameAddedSuccessModal(appid, gameName) {
        const overlay = createModal('Game Added!', (body, overlay, safeNavigate) => {
            body.style.textAlign = 'left';
            body.style.padding = '0';

            const successBadge = document.createElement('div');
            successBadge.style.cssText = 'text-align:center;margin-bottom:16px;';
            successBadge.innerHTML = `<i class="fa-solid fa-circle-check" style="font-size:36px;color:#22c55e;"></i>`;
            body.appendChild(successBadge);

            const title = document.createElement('div');
            title.style.cssText = `text-align:center;font-size:17px;font-weight:700;color:${NOVA.text};margin-bottom:16px;`;
            title.textContent = `"${gameName || 'App ID ' + appid}" has been added to your library!`;
            body.appendChild(title);

            const box = createGameInfoBox(appid, gameName);
            body.appendChild(box);

            const row = document.createElement('div');
            row.style.cssText = 'display:flex;gap:12px;margin-top:4px;';

            const installBtn = document.createElement('a');
            installBtn.href = '#'; installBtn.className = 'pn-btn primary';
            installBtn.style.flex = '1';
            installBtn.innerHTML = '<i class="fa-solid fa-download"></i>&nbsp;Install Now';
            installBtn.onclick = e => {
                e.preventDefault(); safeNavigate(null);
                window.location.href = 'steam://install/' + appid;
            };

            const closeBtn = document.createElement('a');
            closeBtn.href = '#'; closeBtn.className = 'pn-btn';
            closeBtn.innerHTML = '<i class="fa-solid fa-check"></i>&nbsp;Done';
            closeBtn.onclick = e => { e.preventDefault(); safeNavigate(null); };

            row.appendChild(installBtn); row.appendChild(closeBtn);
            body.appendChild(row);
        });
        const modalEl = overlay.querySelector('.pn-modal');
        if (modalEl) modalEl.style.width = '700px';
    }

    // ─── Main Menu ───────────────────────────────────────────────────────────────

    function showSettingsPopup() {
        if (document.querySelector('.pn-overlay')) return;
        ensureNovaTheme();
        ensureFontAwesome();

        createModal('Project Nova Menu', (body, overlay) => {
            body.style.textAlign = 'left';

            if (window.__PROJECTNOVA_IS_BIG_PICTURE__) {
                const tip = document.createElement('div');
                tip.className = 'pn-info-box';
                tip.innerHTML = '<i class="fa-solid fa-info-circle" style="margin-right:8px;"></i>Use mouse or controller to navigate.';
                body.appendChild(tip);
            }

            const searchWrap = document.createElement('div');
            searchWrap.className = 'pn-search-wrap';
            const searchIcon = document.createElement('i');
            searchIcon.className = 'fa-solid fa-magnifying-glass pn-search-icon';
            const searchInput = document.createElement('input');
            searchInput.className = 'pn-search';
            searchInput.placeholder = 'Search…';
            searchWrap.appendChild(searchIcon);
            searchWrap.appendChild(searchInput);
            body.appendChild(searchWrap);

            const currentAppid = getCurrentAppId();
            const onAppPage = currentAppid !== null;

            function createCard(icon, label, desc, onClick) {
                const card = document.createElement('div');
                card.className = 'pn-card';
                card.dataset.label = label.toLowerCase();
                card.dataset.desc  = desc.toLowerCase();
                card.innerHTML = `
                    <div class="pn-card-icon"><i class="fa-solid ${icon}"></i></div>
                    <div style="flex:1;">
                        <div class="pn-card-label">${label}</div>
                        <div class="pn-card-desc">${desc}</div>
                    </div>
                    <i class="fa-solid fa-chevron-right" style="color:rgba(255,255,255,0.22);font-size:11px;"></i>
                `;
                card.onclick = () => { overlay.remove(); onClick(); };
                return card;
            }

            function createSection(label) {
                const el = document.createElement('div');
                el.className = 'pn-section-label';
                el.textContent = label;
                return el;
            }

            // Game section
            body.appendChild(createSection('Game'));
            body.appendChild(createCard('fa-wrench', 'Game Fixer', 'Apply or manage game fixes', () => {
                if (onAppPage) {
                    Millennium.callServerMethod('projectnova', 'GetGameInstallPath', { appid: currentAppid })
                        .then(pathRes => {
                            const p = typeof pathRes === 'string' ? JSON.parse(pathRes) : pathRes;
                            window.__PROJECTNOVA_GAME_INSTALL_PATH__ = p?.success && p.installPath ? p.installPath : null;
                            window.__PROJECTNOVA_GAME_IS_INSTALLED__ = !!window.__PROJECTNOVA_GAME_INSTALL_PATH__;
                            showFixesLoadingPopupAndCheck(currentAppid, () => showSettingsPopup());
                        })
                        .catch(() => {
                            window.__PROJECTNOVA_GAME_IS_INSTALLED__ = false;
                            showFixesLoadingPopupAndCheck(currentAppid, () => showSettingsPopup());
                        });
                } else {
                    showFixesByAppIdPopup(() => showSettingsPopup());
                }
            }));

            body.appendChild(createCard('fa-rocket', 'Add a game to your library', 'Add any game to your library via its Steam App ID', () => showAddByAppIdPopup(() => showSettingsPopup())));

            // Remove added games — always shows confirm with game box
            body.appendChild(createCard('fa-trash-can', 'Remove added game', 'Remove a game that was added to your library', () => {
                if (onAppPage) {
                    Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid: currentAppid })
                        .then(res => {
                            const p = typeof res === 'string' ? JSON.parse(res) : res;
                            if (p?.success && p.exists) {
                                fetchSteamGameName(currentAppid).then(name => {
                                    showRemoveConfirmWithGameBox(currentAppid, name, () => {
                                        Millennium.callServerMethod('projectnova', 'DeleteProjectNovaForApp', { appid: currentAppid })
                                            .then(() => {
                                                window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
                                                window.__PROJECTNOVA_REMOVE_INSERTED__ = false;
                                                addProjectNovaButton();
                                                showToast('Game removed from your library.', 'success');
                                            })
                                            .catch(() => ShowProjectNovaAlert('Error', 'Could not remove the game. Please try again.'));
                                    }, () => showSettingsPopup());
                                });
                            } else {
                                ShowProjectNovaAlert('Not Added to your library', 'This game was not added to your library, so there is nothing to remove here.');
                            }
                        })
                        .catch(() => showRemoveByAppIdPopup(() => showSettingsPopup()));
                } else {
                    showRemoveByAppIdPopup(() => showSettingsPopup());
                }
            }));

            // Tools section
            body.appendChild(createSection('Tools'));
            body.appendChild(createCard('fa-upload',  'Import Game Files', 'Drag & drop or select .lua or .zip files to add games', () => showImportFilesModal(() => showSettingsPopup())));
            body.appendChild(createCard('fa-list',    'Manage Installed Games', 'View, manage, or remove games and their fixes', () => showInstalledGamesPopup(() => showSettingsPopup())));
            body.appendChild(createCard('fa-download','Manifest Updater', 'Update Steam depot manifests and resolve issues such as "No Internet Connection"', () => showManifestUpdaterModal(() => showSettingsPopup())));

            // System section
            body.appendChild(createSection('System'));
            body.appendChild(createCard('fa-power-off', 'Restart Steam', 'Restart Steam to apply changes or fix issues', () => {
                showProjectNovaConfirm('Restart Steam', 'Are you sure you want to restart Steam now?', 
                    () => Millennium.callServerMethod('projectnova', 'RestartSteam', {}),
                    () => showSettingsPopup() 
                );
            }));

            // Search filter
            searchInput.addEventListener('input', () => {
                const q = searchInput.value.trim().toLowerCase();
                body.querySelectorAll('.pn-section-label').forEach(sec => {
                    let el = sec.nextSibling; let hasVisible = false;
                    while (el && !el.classList?.contains('pn-section-label')) {
                        if (el.classList?.contains('pn-card')) {
                            const matches = !q || el.dataset.label?.includes(q) || el.dataset.desc?.includes(q);
                            el.style.display = matches ? '' : 'none';
                            if (matches) hasVisible = true;
                        }
                        el = el.nextSibling;
                    }
                    sec.style.display = hasVisible ? '' : 'none';
                });
            });
            setTimeout(() => searchInput.focus(), 80);
        }, null, {
            isMainMenu: true,
            faqAction: () => { showFAQModal(() => showSettingsPopup()); },
            settingsAction: () => { showSettingsManagerPopup(() => showSettingsPopup()); }
        });
    }

    // ─── Import Game Files ───────────────────────────────────────────────────────

    function showImportFilesModal(backFn) {
        createModal('Import Game Files', (body, overlay, safeNavigate) => {
            body.style.textAlign = 'left';
            body.innerHTML = `
                <div class="pn-info-box"><i class="fa-solid fa-cloud-upload" style="margin-right:8px;"></i>Drag and drop a .lua or .zip file here, or click to browse.</div>
                <div id="import-dropzone" style="
                    border:2px dashed ${NOVA.border}; border-radius:16px; padding:40px 20px;
                    text-align:center; background:rgba(168,85,247,0.05); cursor:pointer;
                    transition:all 0.2s ease; margin-bottom:16px;">
                    <i class="fa-solid fa-cloud-arrow-up" style="font-size:36px;color:${NOVA.accentLight};margin-bottom:12px;"></i>
                    <div style="font-size:15px;font-weight:600;color:${NOVA.text};">Choose a file or drag it here</div>
                    <div style="font-size:12px;color:${NOVA.textSecondary};margin-top:6px;">.lua or .zip files only</div>
                    <input type="file" id="import-file-input" accept=".lua,.zip" style="display:none;" />
                </div>
                <div id="import-status" style="display:none;margin-top:16px;"></div>
                <a href="#" id="import-cancel-btn" class="pn-btn" style="width:100%;margin-top:8px;"><i class="fa-solid fa-xmark"></i>&nbsp;Cancel</a>
            `;

            const dropzone  = body.querySelector('#import-dropzone');
            const fileInput = body.querySelector('#import-file-input');
            const statusDiv = body.querySelector('#import-status');
            const cancelBtn = body.querySelector('#import-cancel-btn');

            dropzone.addEventListener('click', () => fileInput.click());
            dropzone.addEventListener('dragover', e => {
                e.preventDefault();
                dropzone.style.borderColor = NOVA.accent;
                dropzone.style.background  = 'rgba(168,85,247,0.12)';
            });
            dropzone.addEventListener('dragleave', () => {
                dropzone.style.borderColor = NOVA.border;
                dropzone.style.background  = 'rgba(168,85,247,0.05)';
            });
            dropzone.addEventListener('drop', e => {
                e.preventDefault();
                dropzone.style.borderColor = NOVA.border;
                dropzone.style.background  = 'rgba(168,85,247,0.05)';
                if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
            });
            fileInput.addEventListener('change', () => {
                if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
            });
            cancelBtn.onclick = e => { e.preventDefault(); safeNavigate(backFn || null); };

            function handleFile(file) {
                const name = file.name.toLowerCase();
                if (!name.endsWith('.lua') && !name.endsWith('.zip')) {
                    statusDiv.style.display = 'block';
                    statusDiv.innerHTML = `<div class="pn-error-box"><i class="fa-solid fa-circle-xmark"></i>&nbsp;Invalid file type. Only .lua or .zip files are accepted.</div>`;
                    return;
                }

                // Extract App ID from filename
                let appidFromName = null;
                const baseName = file.name.replace(/\.(lua|zip)$/i, '');
                if (/^\d+$/.test(baseName)) {
                    appidFromName = parseInt(baseName, 10);
                }

                statusDiv.style.display = 'block';
                statusDiv.innerHTML = `<div style="text-align:center;padding:16px;"><i class="fa-solid fa-spinner fa-spin" style="color:${NOVA.accent};"></i><br><span style="color:${NOVA.textSecondary};">Processing ${file.name}…</span></div>`;
                dropzone.style.pointerEvents = 'none';
                dropzone.style.opacity = '0.6';

                // Check if game is already added (if we have an App ID)
                const checkPromise = (appidFromName && typeof Millennium !== 'undefined')
                    ? Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid: appidFromName })
                        .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; return (p?.success && p.exists); })
                        .catch(() => false)
                    : Promise.resolve(false);

                checkPromise.then(isAlreadyAdded => {
                    if (isAlreadyAdded) {
                        // Show inline warning inside the import modal
                        statusDiv.style.display = 'block';
                        statusDiv.innerHTML = `<div class="pn-warn-box"><i class="fa-solid fa-triangle-exclamation"></i>&nbsp;This game is already in your library, so there is nothing to add.</div>`;
                        dropzone.style.pointerEvents = '';
                        dropzone.style.opacity = '1';
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = ev => {
                        const base64 = ev.target.result.split(',')[1];
                        Millennium.callServerMethod('projectnova', 'ImportGameFile', { content: base64, filename: file.name })
                            .then(res => {
                                const p = typeof res === 'string' ? JSON.parse(res) : res;
                                if (p?.success) {
                                    safeNavigate(null);
                                    const gName = p.name || null;
                                    const gId   = p.appid || null;
                                    if (gId) {
                                        fetchSteamGameName(gId).then(n => {
                                            showGameAddedSuccessModal(gId, n || gName);
                                        });
                                    } else {
                                        showToast(`"${gName || 'Game'}" imported successfully!`, 'success');
                                    }
                                    window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
                                    window.__PROJECTNOVA_REMOVE_INSERTED__ = false;
                                    addProjectNovaButton();
                                } else {
                                    statusDiv.innerHTML = `<div class="pn-error-box"><i class="fa-solid fa-circle-xmark"></i>&nbsp;Import failed: ${p?.error || 'Unknown error'}</div>`;
                                    dropzone.style.pointerEvents = '';
                                    dropzone.style.opacity = '1';
                                }
                            })
                            .catch(err => {
                                statusDiv.innerHTML = `<div class="pn-error-box"><i class="fa-solid fa-circle-xmark"></i>&nbsp;Import error: ${err}</div>`;
                                dropzone.style.pointerEvents = '';
                                dropzone.style.opacity = '1';
                            });
                    };
                    reader.readAsDataURL(file);
                });
            }
        }, null, { backAction: backFn });
    }

    // ─── Add by App ID ───────────────────────────────────────────────────────────

    function showAddByAppIdPopup(backFn) {
        const currentAppId = getCurrentAppId();
        createModal('Add a Game to Your Library', (body, overlay, safeNavigate) => {
            body.style.textAlign = 'left';
            body.innerHTML = `
                <div class="pn-info-box"><i class="fa-solid fa-info-circle" style="margin-right:8px;"></i>Enter the Steam App ID of the game you want to add.</div>
                <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:${NOVA.textSecondary};">Steam App ID</div>
                <div style="display:flex;gap:12px;margin-bottom:10px;">
                    <input type="text" id="add-appid-input" class="pn-input" placeholder="e.g. 50130" inputmode="numeric" value="${currentAppId || ''}" style="flex:1;">
                    <a href="#" id="lookup-appid-btn" class="pn-btn primary" style="white-space:nowrap;"><i class="fa-solid fa-magnifying-glass"></i>&nbsp;Look Up</a>
                </div>
                <a href="#" id="steamdb-appid-btn" class="pn-btn" style="width:100%;margin-bottom:4px;"><i class="fa-solid fa-arrow-up-right-from-square"></i>&nbsp;Find App ID on SteamDB</a>
                <div id="game-preview" style="margin-top:18px;display:none;"></div>
                <div id="action-area" style="margin-top:12px;display:none;"></div>
            `;
            const input      = body.querySelector('#add-appid-input');
            const lookupBtn  = body.querySelector('#lookup-appid-btn');
            const preview    = body.querySelector('#game-preview');
            const actionArea = body.querySelector('#action-area');
            body.querySelector('#steamdb-appid-btn').onclick = e => { e.preventDefault(); openUrl('https://steamdb.info/'); };

            let resolvedAppid = currentAppId;
            if (currentAppId) setTimeout(() => lookupBtn.click(), 100);

            lookupBtn.onclick = e => {
                e.preventDefault();
                const val = parseInt(input.value.trim(), 10);
                if (isNaN(val)) { input.style.borderColor = '#ff5050'; input.focus(); return; }
                input.style.borderColor = NOVA.border;
                resolvedAppid = val;
                lookupBtn.style.pointerEvents = 'none';
                lookupBtn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;"></i>&nbsp;Looking up…';
                preview.style.display = 'none';
                actionArea.style.display = 'none';

                Promise.all([
                    fetchSteamGameName(val),
                    (typeof Millennium !== 'undefined'
                        ? Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid: val })
                            .then(r => { const p = typeof r === 'string' ? JSON.parse(r) : r; return !!(p?.success && p.exists); })
                            .catch(() => false)
                        : Promise.resolve(false))
                ]).then(([name, isAdded]) => {
                    lookupBtn.style.pointerEvents = '';
                    lookupBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>&nbsp;Look Up';

                    preview.style.display = 'block';
                    preview.innerHTML = '';

                    if (name) {
                        const box = createGameInfoBox(val, name, { thumbW: 110, thumbH: 64, nameSize: '16px' });
                        preview.appendChild(box);

                        actionArea.style.display = 'block';
                        actionArea.innerHTML = '';

                        if (isAdded) {
                            const alreadyMsg = document.createElement('div');
                            alreadyMsg.className = 'pn-warn-box';
                            alreadyMsg.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>This game is already in your library, so there is nothing to add.';
                            actionArea.appendChild(alreadyMsg);
                        } else {
                            const addBtn = document.createElement('a');
                            addBtn.href = '#'; addBtn.className = 'pn-btn primary';
                            addBtn.style.cssText = 'width:100%;padding:14px 20px;font-size:15px;justify-content:center;';
                            addBtn.innerHTML = '<i class="fa-solid fa-rocket"></i>&nbsp;Add to your library';
                            addBtn.onclick = e2 => {
                                e2.preventDefault();
                                if (runState.inProgress) return;
                                overlay.remove();
                                startAddFlow(resolvedAppid);
                            };
                            actionArea.appendChild(addBtn);
                        }
                    } else {
                        preview.innerHTML = `<div class="pn-warn-box"><i class="fa-solid fa-triangle-exclamation"></i>&nbsp;No game found for App ID <strong>${val}</strong>. Please double-check the ID and try again.</div>`;
                    }
                });
            };
            input.addEventListener('keydown', e => { if (e.key === 'Enter') lookupBtn.click(); });
            setTimeout(() => input.focus(), 50);
        }, null, { backAction: backFn });
    }

    const runState = { inProgress: false, appid: null, cancelRequested: false };

    function startAddFlow(appid) {
        // Check if game is already added via Project Nova
        if (typeof Millennium !== 'undefined') {
            Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid })
                .then(res => {
                    const p = typeof res === 'string' ? JSON.parse(res) : res;
                    if (p?.success && p.exists) {
                        // Show a toast notification instead of a modal
                        showToast('This game is already in your library, so there is nothing to add.', 'warning', 4000);
                        return;
                    }
                    // Not added, proceed with normal flow
                    proceedWithAdd();
                })
                .catch(() => {
                    // If check fails, still allow attempt (fail-safe)
                    proceedWithAdd();
                });
        } else {
            proceedWithAdd();
        }

        function proceedWithAdd() {
            fetchGamesDatabase().then(db => {
                const gameData = db?.[String(appid)];
                const doAdd = () => {
                    showDownloadPopupForAppId(appid);
                    runState.inProgress = true;
                    runState.appid = appid;
                    runState.cancelRequested = false;
                    Millennium.callServerMethod('projectnova', 'StartAddViaProjectNova', { appid });
                };
                if (gameData?.playable === 0) {
                    createModal('Warning', (wBody, wOverlay) => {
                        wBody.style.textAlign = 'left';
                        wBody.innerHTML = `<p class="pn-warn-box"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>This game may not work correctly with Project Nova. You can still try adding it, but it might not run as expected. Proceed with caution.</p>`;
                        const btnRow = document.createElement('div');
                        btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:12px;';
                        const proceedBtn = document.createElement('a');
                        proceedBtn.href = '#'; proceedBtn.className = 'pn-btn primary';
                        proceedBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i>&nbsp;Proceed Anyway';
                        const cancelBtn = document.createElement('a');
                        cancelBtn.href = '#'; cancelBtn.className = 'pn-btn';
                        cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Cancel';
                        proceedBtn.onclick = e => { e.preventDefault(); wOverlay.remove(); doAdd(); };
                        cancelBtn.onclick  = e => { e.preventDefault(); wOverlay.remove(); };
                        btnRow.appendChild(cancelBtn); btnRow.appendChild(proceedBtn);
                        wBody.appendChild(btnRow);
                    }, null, { backAction: () => showSettingsPopup() });
                } else doAdd();
            });
        }
    }

    // ─── Download Popup ──────────────────────────────────────

    function showDownloadPopupForAppId(appid) {
        createModal('Adding game to your library', (body, overlay) => {
            body.style.textAlign = 'left';
            body.style.padding = '0';

            const bgBox = document.createElement('div');
            bgBox.style.cssText = `
                position:relative; border-radius:18px; padding:18px;
                margin-bottom:14px;
                background-size:cover; background-position:center;
                background-image:linear-gradient(145deg,#1a1a3e,#0f0f2a);
                border:2px solid rgba(168,85,247,0.5);
                box-shadow:inset 0 0 0 1000px rgba(10,10,30,0.62);
                overflow:hidden;
            `;

            const gameRow = document.createElement('div');
            gameRow.style.cssText = 'position:relative;z-index:2;display:flex;align-items:center;gap:14px;margin-bottom:14px;';
            const thumb = makeGameThumb(appid, 110, 64, 8);
            gameRow.appendChild(thumb);
            const gameTextDiv = document.createElement('div');
            gameTextDiv.style.flex = '1';
            gameTextDiv.innerHTML = `
                <div style="font-weight:700;font-size:16px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.7);">App ID: ${appid}</div>
                <div id="pn-game-name-label" style="font-size:13px;color:#e0d0ff;text-shadow:0 1px 4px rgba(0,0,0,0.6);margin-top:3px;">Loading…</div>
            `;
            gameRow.appendChild(gameTextDiv);
            bgBox.appendChild(gameRow);

            const apiList = document.createElement('div');
            apiList.style.cssText = 'position:relative;z-index:2;margin-bottom:10px;max-height:120px;overflow-y:auto;';
            apiList.innerHTML = `<div style="color:rgba(255,255,255,0.6);font-size:12px;">Connecting to download sources…</div>`;
            bgBox.appendChild(apiList);

            const statusMsg = document.createElement('div');
            statusMsg.style.cssText = 'position:relative;z-index:2;font-size:13px;font-weight:600;color:rgba(255,255,255,0.85);margin-bottom:8px;min-height:20px;';
            statusMsg.textContent = 'Checking availability…';
            bgBox.appendChild(statusMsg);

            const progressWrap = document.createElement('div');
            progressWrap.className = 'pn-progress-wrap';
            progressWrap.style.display = 'none';
            progressWrap.style.position = 'relative';
            progressWrap.style.zIndex = '2';
            const progressTrack = document.createElement('div');
            progressTrack.className = 'pn-progress-track';
            const progressBar = document.createElement('div');
            progressBar.className = 'pn-progress-fill';
            progressBar.style.width = '0%';
            progressTrack.appendChild(progressBar);
            progressWrap.appendChild(progressTrack);
            bgBox.appendChild(progressWrap);

            const progressLabelDiv = document.createElement('div');
            progressLabelDiv.className = 'pn-progress-label';
            progressLabelDiv.style.cssText = 'display:none;position:relative;z-index:2;';
            const pctSpan  = document.createElement('span');
            const sizeSpan = document.createElement('span');
            progressLabelDiv.appendChild(pctSpan);
            progressLabelDiv.appendChild(sizeSpan);
            bgBox.appendChild(progressLabelDiv);

            body.appendChild(bgBox);

            getBestBackgroundUrl(appid).then(bgUrl => {
                if (bgUrl) {
                    const img = new Image();
                    img.onload  = () => { bgBox.style.backgroundImage = `url('${bgUrl}')`; };
                    img.onerror = () => {};
                    img.src = bgUrl;
                }
            });

            fetchSteamGameName(appid).then(name => {
                const label = body.querySelector('#pn-game-name-label');
                if (label && name) label.textContent = name;
                else if (label) label.style.display = 'none';
            });

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:10px;margin-top:4px;justify-content:center;';

            const cancelBtn = document.createElement('a');
            cancelBtn.href = '#'; cancelBtn.className = 'pn-btn danger';
            cancelBtn.innerHTML = '<i class="fa-solid fa-stop"></i>&nbsp;Cancel Download';
            cancelBtn.style.display = 'none';
            cancelBtn.onclick = e => {
                e.preventDefault();
                if (cancelBtn.dataset.cancelling === '1') return;
                cancelBtn.dataset.cancelling = '1';
                cancelBtn.style.opacity = '0.6';
                cancelBtn.style.pointerEvents = 'none';
                cancelBtn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;"></i>&nbsp;Cancelling…';
                statusMsg.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;color:#fbbf24;margin-right:6px;"></i>Cancelling download…';
                
                clearInterval(pollInterval);
                runState.cancelRequested = true;
                runState.inProgress = false;
                
                Millennium.callServerMethod('projectnova', 'CancelAddViaProjectNova', { appid })
                    .finally(() => {
                        statusMsg.innerHTML = '<i class="fa-solid fa-ban" style="color:#fbbf24;margin-right:6px;"></i>Download cancelled.';
                        cancelBtn.style.display = 'none';
                        hideBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Close';
                        showToast('Download cancelled.', 'warning');
                    });
            };

            const hideBtn = document.createElement('a');
            hideBtn.href = '#'; hideBtn.className = 'pn-btn';
            hideBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>&nbsp;Hide';
            hideBtn.title = 'The download will continue in the background.';
            hideBtn.onclick = e => { e.preventDefault(); overlay.remove(); };

            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(hideBtn);
            body.appendChild(btnRow);

            const apiRowMap = {};
            const apiNames = [];
            let successApi = null;
            let currentApi = null;
            const processedApis = new Set();

            Millennium.callServerMethod('projectnova', 'GetApiList', {})
                .then(res => {
                    const p = typeof res === 'string' ? JSON.parse(res) : res;
                    if (p?.success && Array.isArray(p.apis) && p.apis.length) {
                        apiList.innerHTML = '';
                        apiList.style.cssText = `
                            position:relative;z-index:2;margin-bottom:10px;
                            background:rgba(0,0,0,0.25);border-radius:10px;
                            border:1px solid rgba(168,85,247,0.2);overflow:hidden;
                        `;
                        p.apis.forEach((api, idx) => {
                            apiNames.push(api.name);
                            const row = document.createElement('div');
                            row.style.cssText = `
                                display:flex;justify-content:space-between;align-items:center;
                                padding:7px 12px;font-size:12px;
                                ${idx < p.apis.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,0.06);' : ''}
                            `;
                            const nameEl = document.createElement('span');
                            nameEl.style.cssText = 'color:rgba(255,255,255,0.75);font-weight:500;';
                            nameEl.textContent = api.name;
                            const statusEl = document.createElement('span');
                            statusEl.className = 'api-status';
                            statusEl.style.cssText = 'color:rgba(255,255,255,0.3);font-size:11px;font-weight:600;letter-spacing:0.03em;';
                            statusEl.textContent = 'Waiting';
                            row.appendChild(nameEl);
                            row.appendChild(statusEl);
                            apiList.appendChild(row);
                            apiRowMap[api.name] = { row, statusEl };
                        });
                    }
                });

            const pollInterval = setInterval(() => {
                if (runState.cancelRequested) {
                    clearInterval(pollInterval);
                    return;
                }
                Millennium.callServerMethod('projectnova', 'GetAddViaProjectNovaStatus', { appid })
                    .then(res => {
                        if (runState.cancelRequested) {
                            clearInterval(pollInterval);
                            return;
                        }
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        const st = p?.state || {};

                        // Process API errors from state (timeouts, etc.)
                        if (st.apiErrors) {
                            Object.entries(st.apiErrors).forEach(([apiName, err]) => {
                                if (apiRowMap[apiName] && !processedApis.has(apiName) && apiName !== successApi) {
                                    const errType = err.type || 'error';
                                    if (errType === 'timeout') {
                                        apiRowMap[apiName].statusEl.innerHTML = `<i class="fa-solid fa-clock" style="margin-right:4px;"></i>Timeout`;
                                    } else {
                                        apiRowMap[apiName].statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark" style="margin-right:4px;"></i>Not Found`;
                                    }
                                    apiRowMap[apiName].statusEl.style.color = '#f87171';
                                    processedApis.add(apiName);
                                }
                            });
                        }

                        // Update current API being checked
                        if (st.status === 'checking' && st.currentApi) {
                            const apiName = st.currentApi;
                            if (apiName !== currentApi) {
                                // Mark previous API as Not Found (if it wasn't the success one)
                                if (currentApi && !processedApis.has(currentApi) && currentApi !== successApi) {
                                    apiRowMap[currentApi].statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark" style="margin-right:4px;"></i>Not Found`;
                                    apiRowMap[currentApi].statusEl.style.color = '#f87171';
                                    processedApis.add(currentApi);
                                }
                                currentApi = apiName;
                                if (apiRowMap[currentApi] && !processedApis.has(currentApi)) {
                                    apiRowMap[currentApi].statusEl.innerHTML = `<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;margin-right:4px;"></i>Checking`;
                                    apiRowMap[currentApi].statusEl.style.color = NOVA.accentLight;
                                }
                            }
                        }

                        // When download starts, mark the current API as Found and skip all later APIs
                        if ((st.status === 'downloading' || st.status === 'processing') && currentApi) {
                            if (!successApi) {
                                successApi = currentApi;
                                if (apiRowMap[successApi]) {
                                    apiRowMap[successApi].statusEl.innerHTML = `<i class="fa-solid fa-circle-check" style="margin-right:4px;"></i>Found`;
                                    apiRowMap[successApi].statusEl.style.color = '#22c55e';
                                    processedApis.add(successApi);
                                }
                                // Mark all APIs after the successful one as Skipped immediately
                                const successIndex = apiNames.indexOf(successApi);
                                if (successIndex !== -1) {
                                    for (let i = successIndex + 1; i < apiNames.length; i++) {
                                        const name = apiNames[i];
                                        if (apiRowMap[name] && !processedApis.has(name)) {
                                            apiRowMap[name].statusEl.innerHTML = `<i class="fa-solid fa-minus" style="margin-right:4px;"></i>Skipped`;
                                            apiRowMap[name].statusEl.style.color = 'rgba(255,255,255,0.4)';
                                            processedApis.add(name);
                                        }
                                    }
                                }
                            }
                            progressWrap.style.display = 'block';
                            progressLabelDiv.style.display = 'flex';
                            cancelBtn.style.display = 'inline-flex';
                            const total = st.totalBytes || 0;
                            const read  = st.bytesRead  || 0;
                            const pct = total > 0 ? Math.floor((read / total) * 100) : 0;
                            progressBar.style.width = pct + '%';
                            statusMsg.textContent = `Downloading… ${pct}%`;
                            pctSpan.textContent = pct + '%';
                            if (total > 0) sizeSpan.textContent = `${formatBytes(read)} / ${formatBytes(total)}`;
                        }

                        if (st.status === 'done') {
                            clearInterval(pollInterval);
                            // Mark any remaining APIs as Skipped (those that weren't processed yet)
                            apiNames.forEach(name => {
                                if (apiRowMap[name] && !processedApis.has(name) && name !== successApi) {
                                    apiRowMap[name].statusEl.innerHTML = `<i class="fa-solid fa-minus" style="margin-right:4px;"></i>Skipped`;
                                    apiRowMap[name].statusEl.style.color = 'rgba(255,255,255,0.4)';
                                }
                            });
                            progressBar.style.width = '100%';
                            progressBar.classList.add('done');
                            pctSpan.textContent = '100%';
                            statusMsg.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#22c55e;margin-right:6px;"></i>Download complete!';
                            cancelBtn.style.display = 'none';
                            hideBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Close';
                            runState.inProgress = false;

                            const existingBtn = document.querySelector('.projectnova-button');
                            if (existingBtn) existingBtn.remove();
                            window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
                            window.__PROJECTNOVA_REMOVE_INSERTED__ = false;
                            addProjectNovaButton();

                            fetchSteamGameName(appid).then(name => {
                                setTimeout(() => {
                                    overlay.remove();
                                    showGameAddedSuccessModal(appid, name);
                                }, 900);
                                showToast('<strong>' + (name || 'App ID ' + appid) + '</strong> has been added to your library!', 'success', 7000);
                            });
                        }

                        if (st.status === 'cancelled') {
                            clearInterval(pollInterval);
                            statusMsg.innerHTML = '<i class="fa-solid fa-ban" style="color:#fbbf24;margin-right:6px;"></i>Download cancelled.';
                            cancelBtn.style.display = 'none';
                            hideBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Close';
                            runState.inProgress = false;
                        }

                        if (st.status === 'failed') {
                            clearInterval(pollInterval);
                            if (currentApi && apiRowMap[currentApi] && !processedApis.has(currentApi)) {
                                apiRowMap[currentApi].statusEl.innerHTML = `<i class="fa-solid fa-circle-xmark" style="margin-right:4px;"></i>Failed`;
                                apiRowMap[currentApi].statusEl.style.color = '#f87171';
                                processedApis.add(currentApi);
                            }
                            const msg = st.error ? friendlyError(st.error) : 'The download failed. Please try again or use a different download method.';
                            statusMsg.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#f87171;margin-right:6px;"></i>Download failed.';
                            const errBox = document.createElement('div');
                            errBox.className = 'pn-error-box';
                            errBox.style.cssText = 'margin-top:10px;position:relative;z-index:2;';
                            errBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>${msg}`;
                            bgBox.appendChild(errBox);
                            cancelBtn.style.display = 'none';
                            hideBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Close';
                            runState.inProgress = false;
                        }
                    });
            }, 250);
        }, null, { backAction: () => showSettingsPopup() });
    }

    // ─── Remove by App ID ────────────────────────────────────────────────────────

    function showRemoveByAppIdPopup(backFn) {
        const currentAppId = getCurrentAppId();
        createModal('Remove Added Game', (body, overlay) => {
            body.style.textAlign = 'left';
            body.innerHTML = `
                <div class="pn-info-box"><i class="fa-solid fa-info-circle" style="margin-right:8px;"></i>Enter the Steam App ID of the game you want to remove from your library.</div>
                <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:${NOVA.textSecondary};">Steam App ID</div>
                <div style="display:flex;gap:12px;margin-bottom:10px;">
                    <input type="text" id="remove-appid" class="pn-input" placeholder="e.g. 50130" inputmode="numeric" value="${currentAppId || ''}" style="flex:1;">
                    <a href="#" id="lookup-remove-btn" class="pn-btn primary" style="white-space:nowrap;"><i class="fa-solid fa-magnifying-glass"></i>&nbsp;Look Up</a>
                </div>
                <a href="#" id="steamdb-remove-btn" class="pn-btn" style="width:100%;margin-bottom:4px;"><i class="fa-solid fa-arrow-up-right-from-square"></i>&nbsp;Find App ID on SteamDB</a>
                <div id="remove-preview" style="margin-top:18px;display:none;"></div>
                <div id="remove-action-area" style="margin-top:12px;display:none;"></div>
            `;
            body.querySelector('#steamdb-remove-btn').onclick = e => { e.preventDefault(); openUrl('https://steamdb.info/'); };

            const input      = body.querySelector('#remove-appid');
            const lookupBtn  = body.querySelector('#lookup-remove-btn');
            const preview    = body.querySelector('#remove-preview');
            const actionArea = body.querySelector('#remove-action-area');

            if (currentAppId) setTimeout(() => lookupBtn.click(), 100);

            lookupBtn.onclick = e => {
                e.preventDefault();
                const val = parseInt(input.value.trim(), 10);
                if (isNaN(val)) { input.style.borderColor = '#ff5050'; input.focus(); return; }
                input.style.borderColor = NOVA.border;
                lookupBtn.style.pointerEvents = 'none';
                lookupBtn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;"></i>&nbsp;Looking up…';
                preview.style.display = 'none'; actionArea.style.display = 'none';

                Promise.all([
                    fetchSteamGameName(val),
                    (typeof Millennium !== 'undefined'
                        ? Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid: val })
                            .then(r => { const p = typeof r === 'string' ? JSON.parse(r) : r; return !!(p?.success && p.exists); })
                            .catch(() => false)
                        : Promise.resolve(false))
                ]).then(([name, isAdded]) => {
                    lookupBtn.style.pointerEvents = '';
                    lookupBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>&nbsp;Look Up';

                    preview.style.display = 'block';
                    preview.innerHTML = '';

                    if (name) {
                        const box = createGameInfoBox(val, name, { thumbW: 110, thumbH: 64, nameSize: '16px' });
                        preview.appendChild(box);

                        actionArea.style.display = 'block';
                        actionArea.innerHTML = '';

                        if (isAdded) {
                            const removeBtn = document.createElement('a');
                            removeBtn.href = '#'; removeBtn.className = 'pn-btn danger';
                            removeBtn.style.cssText = 'width:100%;padding:14px 20px;font-size:15px;justify-content:center;';
                            removeBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>&nbsp;Remove from your library';
                            removeBtn.onclick = e2 => {
                                e2.preventDefault();
                                overlay.remove();
                                showRemoveConfirmWithGameBox(val, name, () => {
                                    Millennium.callServerMethod('projectnova', 'DeleteProjectNovaForApp', { appid: val })
                                        .then(() => {
                                            window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
                                            window.__PROJECTNOVA_REMOVE_INSERTED__ = false;
                                            addProjectNovaButton();
                                            if (backFn) setTimeout(() => backFn(), 55);
                                            showToast('Game removed from your library.', 'success');
                                        })
                                        .catch(() => ShowProjectNovaAlert('Error', 'Could not remove the game. Please try again.'));
                                }, () => { if (backFn) backFn(); });
                            };
                            actionArea.appendChild(removeBtn);
                        } else {
                            const notAddedMsg = document.createElement('div');
                            notAddedMsg.className = 'pn-warn-box';
                            notAddedMsg.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>This game was not added to your library, so there is nothing to remove.';
                            actionArea.appendChild(notAddedMsg);
                        }
                    } else {
                        preview.innerHTML = `<div class="pn-warn-box"><i class="fa-solid fa-triangle-exclamation"></i>&nbsp;No game found for App ID <strong>${val}</strong>. Please double-check the ID and try again.</div>`;
                    }
                });
            };

            input.addEventListener('keydown', e => { if (e.key === 'Enter') lookupBtn.click(); });
            setTimeout(() => input.focus(), 50);
        }, null, { backAction: backFn });
    }

    // ─── Manage Installed Games ────────────────────────────────────

    function showInstalledGamesPopup(backFn) {
        createModal('Manage Installed Games', (body, overlay) => {
            body.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fa-solid fa-spinner" style="font-size:22px;color:${NOVA.accent};animation:pnSpinner 0.8s linear infinite;"></i><br><br>Loading your games…</div>`;

            Millennium.callServerMethod('projectnova', 'GetInstalledLuaScripts', {})
                .then(res => {
                    const p = typeof res === 'string' ? JSON.parse(res) : res;
                    if (!p?.success || !p.scripts?.length) {
                        body.innerHTML = `<div style="text-align:center;padding:40px;">
                            <i class="fa-solid fa-inbox" style="font-size:32px;color:${NOVA.accentLight};opacity:0.45;"></i>
                            <br><br><strong style="font-size:16px;">No games added yet</strong>
                            <br><span style="font-size:13px;color:${NOVA.textSecondary};">Games you add to your library will appear here.</span>
                        </div>`;
                        return;
                    }
                    body.innerHTML = '';
                    body.style.textAlign = 'left';

                    // Search bar
                    const searchWrap = document.createElement('div');
                    searchWrap.className = 'pn-search-wrap';
                    const searchIcon = document.createElement('i');
                    searchIcon.className = 'fa-solid fa-magnifying-glass pn-search-icon';
                    const searchInput = document.createElement('input');
                    searchInput.className = 'pn-search';
                    searchInput.placeholder = 'Search by game name or App ID…';
                    searchWrap.appendChild(searchIcon);
                    searchWrap.appendChild(searchInput);
                    body.appendChild(searchWrap);

                    const countLabel = document.createElement('div');
                    countLabel.style.cssText = `font-size:12px;color:${NOVA.textSecondary};margin-bottom:14px;`;
                    countLabel.textContent = `${p.scripts.length} game(s) added to your library`;
                    body.appendChild(countLabel);

                    const list = document.createElement('div');
                    const gameItems = [];

                    p.scripts.forEach(script => {
                        // Each game item has a background image layer
                        const item = document.createElement('div');
                        item.className = 'pn-game-item';
                        item.dataset.name  = (script.gameName || '').toLowerCase();
                        item.dataset.appid = String(script.appid);

                        // Background layer
                        const bgLayer = document.createElement('div');
                        bgLayer.className = 'pn-game-item-bg';
                        const overlayLayer = document.createElement('div');
                        overlayLayer.className = 'pn-game-item-overlay';

                        // Content layer
                        const content = document.createElement('div');
                        content.className = 'pn-game-item-content';

                        // Thumbnail
                        const iconWrap = document.createElement('div');
                        iconWrap.style.flexShrink = '0';
                        const iconImg = makeGameThumb(script.appid, 90, 55, 7);
                        iconWrap.appendChild(iconImg);

                        // Text info
                        const disabledBadge = script.isDisabled
                            ? `<span style="background:rgba(255,80,80,0.15);color:#ff5050;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;margin-left:8px;">DISABLED</span>` : '';
                        const textDiv = document.createElement('div');
                        textDiv.style.cssText = 'flex:1;margin-left:12px;';
                        textDiv.innerHTML = `
                            <div style="font-weight:700;font-size:15px;color:${NOVA.text};">${script.gameName || 'Unknown Game'} ${disabledBadge}</div>
                            <div style="font-size:12px;color:${NOVA.textSecondary};margin-top:2px;">App ID: ${script.appid}</div>
                        `;

                        // Action buttons — icon‑only
                        const btnGroup = document.createElement('div');
                        btnGroup.style.cssText = 'display:flex;gap:6px;flex-shrink:0;align-items:center;';

                        // 1. Remove button (icon‑only)
                        const removeBtn = document.createElement('a');
                        removeBtn.href = '#'; 
                        removeBtn.className = 'pn-btn danger';
                        removeBtn.style.cssText = 'padding:7px 10px;font-size:14px;';
                        removeBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
                        removeBtn.title = 'Remove from your library';
                        removeBtn.onclick = e => {
                            e.preventDefault();
                            showRemoveConfirmWithGameBox(script.appid, script.gameName, () => {
                                Millennium.callServerMethod('projectnova', 'DeleteProjectNovaForApp', { appid: script.appid })
                                    .then(() => {
                                        item.style.animation = 'pnFadeOut 0.22s ease forwards';
                                        setTimeout(() => {
                                            item.remove();
                                            if (list.children.length === 0)
                                                body.innerHTML = `<div style="text-align:center;padding:40px;">No games added yet.</div>`;
                                        }, 240);
                                        window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
                                        window.__PROJECTNOVA_REMOVE_INSERTED__ = false;
                                        addProjectNovaButton();
                                        showToast('Game removed from your library.', 'success');
                                    })
                                    .catch(() => ShowProjectNovaAlert('Error', 'Could not remove the game. Please try again.'));
                            });
                        };

                        // 2. Fix button (icon‑only)
                        const fixesBtn = document.createElement('a');
                        fixesBtn.href = '#'; 
                        fixesBtn.className = 'pn-btn';
                        fixesBtn.style.cssText = 'padding:7px 10px;font-size:14px;';
                        fixesBtn.innerHTML = '<i class="fa-solid fa-wrench"></i>';
                        fixesBtn.title = 'Open Game Fixer';
                        fixesBtn.onclick = e => {
                            e.preventDefault(); 
                            overlay.remove();
                            Millennium.callServerMethod('projectnova', 'GetGameInstallPath', { appid: script.appid })
                                .then(r => {
                                    const pl = typeof r === 'string' ? JSON.parse(r) : r;
                                    window.__PROJECTNOVA_GAME_INSTALL_PATH__ = pl?.success && pl.installPath ? pl.installPath : null;
                                    window.__PROJECTNOVA_GAME_IS_INSTALLED__ = !!window.__PROJECTNOVA_GAME_INSTALL_PATH__;
                                    showFixesLoadingPopupAndCheck(script.appid, backFn);
                                })
                                .catch(() => {
                                    window.__PROJECTNOVA_GAME_IS_INSTALLED__ = false;
                                    showFixesLoadingPopupAndCheck(script.appid, backFn);
                                });
                        };

                        // 3. Store button (icon‑only)
                        const storeBtn = document.createElement('a');
                        storeBtn.href = '#'; 
                        storeBtn.className = 'pn-btn secondary';
                        storeBtn.style.cssText = 'padding:7px 10px;font-size:14px;';
                        storeBtn.innerHTML = '<i class="fa-brands fa-steam"></i>';
                        storeBtn.title = 'Open in Steam Store';
                        storeBtn.onclick = e => {
                            e.preventDefault();
                            window.location.href = `steam://store/${script.appid}`;
                        };

                        // 4. SteamDB button (icon‑only)
                        const steamdbBtn = document.createElement('a');
                        steamdbBtn.href = '#'; 
                        steamdbBtn.className = 'pn-btn secondary';
                        steamdbBtn.style.cssText = 'padding:7px 10px;font-size:14px;';
                        steamdbBtn.innerHTML = '<i class="fa-solid fa-database"></i>';
                        steamdbBtn.title = 'Open on SteamDB';
                        steamdbBtn.onclick = e => {
                            e.preventDefault();
                            openUrl(`https://steamdb.info/app/${script.appid}/`);
                        };

                        btnGroup.appendChild(steamdbBtn);
                        btnGroup.appendChild(storeBtn);
                        btnGroup.appendChild(fixesBtn);
                        btnGroup.appendChild(removeBtn);

                        content.appendChild(iconWrap);
                        content.appendChild(textDiv);
                        content.appendChild(btnGroup);

                        item.appendChild(bgLayer);
                        item.appendChild(overlayLayer);
                        item.appendChild(content);
                        list.appendChild(item);
                        gameItems.push(item);

                        // Apply background image to game item card
                        getBestBackgroundUrl(script.appid).then(bgUrl => {
                            if (bgUrl) {
                                bgLayer.style.backgroundImage = `url('${bgUrl}')`;
                                bgLayer.classList.add('loaded');
                            }
                        });
                    });

                    body.appendChild(list);
                    searchInput.addEventListener('input', () => {
                        const q = searchInput.value.trim().toLowerCase();
                        gameItems.forEach(item => {
                            item.style.display = (!q || item.dataset.name.includes(q) || item.dataset.appid.includes(q)) ? '' : 'none';
                        });
                    });
                    setTimeout(() => searchInput.focus(), 60);
                })
                .catch(() => {
                    body.innerHTML = `<div class="pn-error-box"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>Could not load your installed games. Please try again.</div>`;
                });
        }, null, { backAction: backFn });
    }

    // ─── Fixes by App ID ─────────────────────────────────────────────────────────

    function showFixesByAppIdPopup(backFn) {
        createModal('Game Fixer', (body, overlay, safeNavigate) => {
            body.style.textAlign = 'left';
            body.innerHTML = `
                <div class="pn-info-box"><i class="fa-solid fa-wrench" style="margin-right:8px;"></i>Enter the Steam App ID of the game you want to apply fixes for.</div>
                <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:${NOVA.textSecondary};">Steam App ID</div>
                <div style="display:flex;gap:12px;margin-bottom:10px;">
                    <input type="text" id="fixes-appid-input" class="pn-input" placeholder="e.g. 50130" inputmode="numeric" style="flex:1;">
                    <a href="#" id="fixes-check-btn" class="pn-btn primary" style="white-space:nowrap;"><i class="fa-solid fa-wrench"></i>&nbsp;Check Fixes</a>
                </div>
                <a href="#" id="steamdb-fixes-btn" class="pn-btn" style="width:100%;"><i class="fa-solid fa-arrow-up-right-from-square"></i>&nbsp;Find App ID on SteamDB</a>
            `;
            const input    = body.querySelector('#fixes-appid-input');
            const checkBtn = body.querySelector('#fixes-check-btn');
            body.querySelector('#steamdb-fixes-btn').onclick = e => { e.preventDefault(); openUrl('https://steamdb.info/'); };

            checkBtn.onclick = e => {
                e.preventDefault();
                const val = parseInt(input.value.trim(), 10);
                if (isNaN(val)) { input.style.borderColor = '#ff5050'; input.focus(); return; }
                input.style.borderColor = NOVA.border;
                checkBtn.style.pointerEvents = 'none';
                checkBtn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;"></i>&nbsp;Checking…';
                Millennium.callServerMethod('projectnova', 'GetGameInstallPath', { appid: val })
                    .then(r => {
                        const pl = typeof r === 'string' ? JSON.parse(r) : r;
                        window.__PROJECTNOVA_GAME_INSTALL_PATH__ = pl?.success && pl.installPath ? pl.installPath : null;
                        window.__PROJECTNOVA_GAME_IS_INSTALLED__ = !!window.__PROJECTNOVA_GAME_INSTALL_PATH__;
                        safeNavigate(() => showFixesLoadingPopupAndCheck(val, backFn));
                    })
                    .catch(() => {
                        window.__PROJECTNOVA_GAME_INSTALL_PATH__ = null;
                        window.__PROJECTNOVA_GAME_IS_INSTALLED__ = false;
                        safeNavigate(() => showFixesLoadingPopupAndCheck(val, backFn));
                    });
            };
            input.addEventListener('keydown', e => { if (e.key === 'Enter') checkBtn.click(); });
            setTimeout(() => input.focus(), 50);
        }, null, { backAction: backFn });
    }

    // ─── Fixes Menu ──────────────────────────────────────────────────────────────

    function showFixesLoadingPopupAndCheck(appid, backFn) {
        const primaryBg = getCDNUrl(appid, 'page_bg_generated_v6b.jpg');
        createModal('Checking Fixes…', (body, overlay, safeNavigate) => {
            body.innerHTML = `<div style="text-align:center;padding:30px;">
                <i class="fa-solid fa-spinner" style="font-size:22px;color:${NOVA.accent};animation:pnSpinner 0.8s linear infinite;"></i>
                <br><br><span style="color:${NOVA.textSecondary};">Looking for available fixes for this game…</span>
            </div>`;

            Promise.all([
                fetchFixes(appid),
                (typeof Millennium !== 'undefined'
                    ? Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid })
                        .then(r => { const p = typeof r === 'string' ? JSON.parse(r) : r; return !!(p?.success && p.exists); })
                        .catch(() => false)
                    : Promise.resolve(false))
            ]).then(([payload, isGameAdded]) => {
                if (payload?.success) {
                    safeNavigate(() => showFixesResultsPopup(payload, window.__PROJECTNOVA_GAME_IS_INSTALLED__ === true, isGameAdded, backFn));
                } else {
                    safeNavigate(() => ShowProjectNovaAlert('No Fixes Found', payload?.error || 'No fixes were found for this game, or it is not in the database yet.'));
                }
            }).catch(() => {
                safeNavigate(() => ShowProjectNovaAlert('Connection Error', 'Could not check for fixes. Make sure you are connected to the internet and try again.'));
            });
        }, null, { backAction: backFn, bgImage: primaryBg });
    }

    function showFixesResultsPopup(data, isGameInstalled, isGameAdded, backFn) {
        const overlay = createModal('Game Fixer', (body, modalOverlay) => {
            body.style.textAlign = 'left'; body.style.padding = '0';

            // Bordered background box with game info
            const bgBox = document.createElement('div');
            bgBox.style.cssText = `
                position:relative; border-radius:18px; padding:20px 18px;
                margin-bottom:16px; background-size:cover; background-position:center;
                background-repeat:no-repeat;
                border:2px solid rgba(168,85,247,0.5);
                box-shadow:inset 0 0 0 1000px rgba(13,13,34,0.55), 0 4px 24px rgba(0,0,0,0.4);
                overflow:hidden;
                background-image:linear-gradient(145deg,#1a1a3e,#0f0f2a);
            `;

            const boxContent = document.createElement('div');
            boxContent.style.cssText = 'position:relative;z-index:2;';

            const infoRow = document.createElement('div');
            infoRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:20px;';
            const icon = makeGameThumb(data.appid, 120, 68, 8);
            infoRow.appendChild(icon);
            const titleDiv = document.createElement('div');
            titleDiv.innerHTML = `
                <div style="font-weight:700;font-size:18px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,0.7);">${data.gameName || 'Unknown Game'}</div>
                <div style="font-size:13px;color:#eee;text-shadow:0 1px 4px rgba(0,0,0,0.6);">App ID: ${data.appid}</div>
            `;
            infoRow.appendChild(titleDiv);
            boxContent.appendChild(infoRow);

            // Status badge for install/add state
            if (!isGameInstalled) {
                const warn = document.createElement('div');
                warn.className = 'pn-warn-box';
                warn.style.cssText = 'margin-bottom:16px;background:rgba(255,193,7,0.15);backdrop-filter:blur(4px);';
                if (!isGameAdded) {
                    warn.innerHTML = '<i class="fa-solid fa-circle-plus" style="margin-right:6px;"></i>This game is not in your library yet. Add it first before applying fixes.';
                } else {
                    warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>Game is added but not installed. Install it first so fixes can be applied.';
                }
                boxContent.appendChild(warn);
            }

            const columns = document.createElement('div');
            columns.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;';

            function makeFixButton(label, text, iconClass, isAvailable, onClick) {
                const wrapper = document.createElement('div');
                const lbl = document.createElement('div');
                lbl.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#e0b0ff;margin-bottom:8px;text-shadow:0 1px 4px rgba(0,0,0,0.5);';
                lbl.textContent = label;
                const btn = document.createElement('a');
                btn.href = '#'; btn.className = 'pn-btn';
                btn.style.cssText = `width:100%;justify-content:center;background:rgba(20,20,40,0.85);backdrop-filter:blur(4px);border:1px solid rgba(168,85,247,0.5);box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
                if (!isAvailable) { btn.style.opacity = '0.45'; btn.style.pointerEvents = 'none'; }
                btn.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${text}</span>`;
                btn.onclick = e => { e.preventDefault(); if (isAvailable) onClick(); };
                wrapper.appendChild(lbl); wrapper.appendChild(btn);
                return wrapper;
            }

            const leftCol = document.createElement('div');
            const rightCol = document.createElement('div');

            const genericStatus = data.genericFix.status;
            leftCol.appendChild(makeFixButton('Generic Fix',
                genericStatus === 200 ? 'Apply Generic Fix' : 'No generic fix available',
                genericStatus === 200 ? 'fa-check-circle' : 'fa-circle-xmark',
                genericStatus === 200 && isGameInstalled,
                () => { if (genericStatus === 200 && isGameInstalled) applyFix(data.appid, `https://files.luatools.work/GameBypasses/${data.appid}.zip`, 'Generic Fix', data.gameName, overlay, backFn); }
            ));

            const onlineStatus = data.onlineFix.status;
            leftCol.appendChild(makeFixButton('Online Fix',
                onlineStatus === 200 ? 'Apply Online Fix' : 'No online fix available',
                onlineStatus === 200 ? 'fa-check-circle' : 'fa-circle-xmark',
                onlineStatus === 200 && isGameInstalled,
                () => { if (onlineStatus === 200 && isGameInstalled) applyFix(data.appid, data.onlineFix.url || `https://files.luatools.work/OnlineFix1/${data.appid}.zip`, 'Online Fix', data.gameName, overlay, backFn); }
            ));

            rightCol.appendChild(makeFixButton('All-In-One Fixes', 'Online Fix (Unsteam)', 'fa-globe', isGameInstalled,
                () => { if (isGameInstalled) applyFix(data.appid, 'https://github.com/madoiscool/lt_api_links/releases/download/unsteam/Win64.zip', 'Online Fix (Unsteam)', data.gameName, overlay, backFn); }
            ));
            rightCol.appendChild(makeFixButton('Manage Game', 'Un-Fix (verify game)', 'fa-rotate', isGameInstalled,
                () => {
                    if (isGameInstalled) {
                        overlay.remove();
                        showProjectNovaConfirm('Remove Fixes', 'Are you sure you want to un-fix? This will remove fix files and verify game files.', () => startUnfix(data.appid, backFn), () => showFixesResultsPopup(data, isGameInstalled, isGameAdded, backFn));
                    }
                }
            ));

            columns.appendChild(leftCol);
            columns.appendChild(rightCol);
            boxContent.appendChild(columns);
            bgBox.appendChild(boxContent);
            body.appendChild(bgBox);

            // Apply background image to the box
            getBestBackgroundUrl(data.appid).then(bgUrl => {
                if (bgUrl) {
                    const img = new Image();
                    img.onload  = () => { bgBox.style.backgroundImage = `url('${bgUrl}')`; };
                    img.onerror = () => {};
                    img.src = bgUrl;
                }
            });

            // Bottom action buttons — smart based on install/add state
            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display:flex;gap:12px;margin-top:4px;';

            if (isGameInstalled && window.__PROJECTNOVA_GAME_INSTALL_PATH__) {
                // Game is installed — show Open Folder as primary
                const folderBtn = document.createElement('a');
                folderBtn.href = '#'; folderBtn.className = 'pn-btn';
                folderBtn.style.cssText = 'flex:1;padding:12px 20px;justify-content:center;';
                folderBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i>&nbsp;Open Game Folder';
                folderBtn.onclick = e => {
                    e.preventDefault();
                    Millennium.callServerMethod('projectnova', 'OpenGameFolder', { path: window.__PROJECTNOVA_GAME_INSTALL_PATH__ });
                };
                btnContainer.appendChild(folderBtn);

                const storeBtn = document.createElement('a');
                storeBtn.href = '#'; storeBtn.className = 'pn-btn';
                storeBtn.style.cssText = 'flex:1;padding:12px 20px;justify-content:center;';
                storeBtn.innerHTML = '<i class="fa-solid fa-store"></i>&nbsp;Store Page';
                storeBtn.onclick = e => { e.preventDefault(); openUrl(`https://store.steampowered.com/app/${data.appid}`); };
                btnContainer.appendChild(storeBtn);

            } else if (isGameAdded && !isGameInstalled) {
                // Added but not installed — offer Install Game
                const installBtn = document.createElement('a');
                installBtn.href = '#'; installBtn.className = 'pn-btn primary';
                installBtn.style.cssText = 'flex:1;padding:12px 20px;justify-content:center;';
                installBtn.innerHTML = '<i class="fa-solid fa-download"></i>&nbsp;Install Game';
                installBtn.onclick = e => { e.preventDefault(); window.location.href = 'steam://install/' + data.appid; };
                btnContainer.appendChild(installBtn);

                const storeBtn = document.createElement('a');
                storeBtn.href = '#'; storeBtn.className = 'pn-btn';
                storeBtn.style.cssText = 'flex:1;padding:12px 20px;justify-content:center;';
                storeBtn.innerHTML = '<i class="fa-solid fa-store"></i>&nbsp;Store Page';
                storeBtn.onclick = e => { e.preventDefault(); openUrl(`https://store.steampowered.com/app/${data.appid}`); };
                btnContainer.appendChild(storeBtn);

            } else {
                // Not added at all — offer Add to Library
                const addBtn = document.createElement('a');
                addBtn.href = '#'; addBtn.className = 'pn-btn primary';
                addBtn.style.cssText = 'flex:1;padding:12px 20px;justify-content:center;';
                addBtn.innerHTML = '<i class="fa-solid fa-rocket"></i>&nbsp;Add to your library';
                addBtn.onclick = e => {
                    e.preventDefault();
                    overlay.remove();
                    startAddFlow(data.appid);
                };
                btnContainer.appendChild(addBtn);

                const storeBtn = document.createElement('a');
                storeBtn.href = '#'; storeBtn.className = 'pn-btn';
                storeBtn.style.cssText = 'flex:1;padding:12px 20px;justify-content:center;';
                storeBtn.innerHTML = '<i class="fa-solid fa-store"></i>&nbsp;Store Page';
                storeBtn.onclick = e => { e.preventDefault(); openUrl(`https://store.steampowered.com/app/${data.appid}`); };
                btnContainer.appendChild(storeBtn);
            }

            body.appendChild(btnContainer);
        }, null, { backAction: backFn });

        const modalEl = overlay.querySelector('.pn-modal');
        if (modalEl) modalEl.style.width = '700px';
        return overlay;
    }

    function applyFix(appid, downloadUrl, fixType, gameName, resultsOverlay, backFn) {
        if (resultsOverlay) resultsOverlay.remove();
        if (!window.__PROJECTNOVA_GAME_INSTALL_PATH__) {
            ShowProjectNovaAlert('Game Folder Not Found', 'Could not find the game installation folder. Make sure the game is installed and try again.');
            return;
        }
        Millennium.callServerMethod('projectnova', 'ApplyGameFix', { appid, downloadUrl, installPath: window.__PROJECTNOVA_GAME_INSTALL_PATH__, fixType, gameName })
            .then(res => {
                const p = typeof res === 'string' ? JSON.parse(res) : res;
                if (p?.success) showFixDownloadProgress(appid, fixType, backFn);
                else ShowProjectNovaAlert('Could Not Apply Fix', p?.error ? friendlyError(p.error) : 'Could not start the fix download. Please try again.');
            })
            .catch(() => ShowProjectNovaAlert('Error', 'An error occurred while trying to apply the fix. Please try again.'));
    }

    function showFixDownloadProgress(appid, fixType, backFn) {
        const bgUrl = getCDNUrl(appid, 'library_hero.jpg');
        createModal('Applying Fix: ' + fixType, (body) => {
            body.style.textAlign = 'left';
            const statusMsg = document.createElement('div');
            statusMsg.style.cssText = `font-size:14px;font-weight:600;margin-bottom:14px;color:${NOVA.text};`;
            statusMsg.textContent = 'Downloading fix files…';
            body.appendChild(statusMsg);

            const pw = document.createElement('div'); pw.className = 'pn-progress-wrap';
            const pt = document.createElement('div'); pt.className = 'pn-progress-track';
            const progressBar = document.createElement('div'); progressBar.className = 'pn-progress-fill'; progressBar.style.width = '0%';
            pt.appendChild(progressBar); pw.appendChild(pt);
            body.appendChild(pw);

            const progressLabel = document.createElement('div');
            progressLabel.className = 'pn-progress-label';
            progressLabel.innerHTML = '<span class="pn-pct">0%</span><span></span>';
            body.appendChild(progressLabel);

            const interval = setInterval(() => {
                Millennium.callServerMethod('projectnova', 'GetApplyFixStatus', { appid })
                    .then(res => {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (!p?.success) return;
                        const state = p.state || {};
                        if (state.status === 'downloading') {
                            const pct = state.totalBytes > 0 ? Math.floor((state.bytesRead / state.totalBytes) * 100) : 0;
                            progressBar.style.width = pct + '%';
                            statusMsg.textContent = `Downloading… ${pct}%`;
                            progressLabel.querySelector('.pn-pct').textContent = pct + '%';
                        } else if (state.status === 'done') {
                            progressBar.style.width = '100%';
                            progressBar.classList.add('done');
                            statusMsg.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#22c55e;margin-right:8px;"></i>${fixType} applied successfully!`;
                            clearInterval(interval);
                            showToast(fixType + ' fix applied!', 'success');
                        } else if (state.status === 'failed') {
                            statusMsg.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#f87171;margin-right:8px;"></i>The fix could not be applied.`;
                            const errBox = document.createElement('div');
                            errBox.className = 'pn-error-box'; errBox.style.marginTop = '10px';
                            errBox.textContent = state.error ? friendlyError(state.error) : 'Something went wrong. Please try again.';
                            body.appendChild(errBox);
                            clearInterval(interval);
                        }
                    });
            }, 500);
        }, null, { bgImage: bgUrl });
    }

    function startUnfix(appid, backFn) {
        Millennium.callServerMethod('projectnova', 'UnFixGame', { appid, installPath: window.__PROJECTNOVA_GAME_INSTALL_PATH__ })
            .then(res => {
                const p = typeof res === 'string' ? JSON.parse(res) : res;
                if (p?.success) showUnfixProgress(appid, backFn);
                else ShowProjectNovaAlert('Error', p?.error ? friendlyError(p.error) : 'Could not start the restore process. Please try again.');
            })
            .catch(() => ShowProjectNovaAlert('Error', 'An error occurred while trying to restore game files. Please try again.'));
    }

    function showUnfixProgress(appid, backFn) {
        const bgUrl = getCDNUrl(appid, 'library_hero.jpg');
        createModal('Restoring Game Files', (body) => {
            body.style.textAlign = 'left';
            const msg = document.createElement('div');
            msg.style.cssText = `font-size:14px;font-weight:600;color:${NOVA.text};margin-bottom:14px;`;
            msg.textContent = 'Removing fix files and restoring original game files…';
            body.appendChild(msg);

            const pw = document.createElement('div'); pw.className = 'pn-progress-wrap';
            const pt = document.createElement('div'); pt.className = 'pn-progress-track';
            const progressBar = document.createElement('div'); progressBar.className = 'pn-progress-fill'; progressBar.style.width = '0%';
            pt.appendChild(progressBar); pw.appendChild(pt); body.appendChild(pw);

            const subMsg = document.createElement('div');
            subMsg.style.cssText = `font-size:12px;color:${NOVA.textSecondary};margin-top:8px;`;
            body.appendChild(subMsg);

            const interval = setInterval(() => {
                Millennium.callServerMethod('projectnova', 'GetUnfixStatus', { appid })
                    .then(res => {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (!p?.success) return;
                        const state = p.state || {};
                        if (state.status === 'done') {
                            progressBar.style.width = '100%'; progressBar.classList.add('done');
                            msg.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#22c55e;margin-right:8px;"></i>Done! Removed ${state.filesRemoved || 0} files.`;
                            subMsg.textContent = 'Steam is now verifying the game files to restore them. This may take a few minutes.';
                            setTimeout(() => { window.location.href = 'steam://validate/' + appid; }, 1200);
                            clearInterval(interval);
                        } else if (state.status === 'failed') {
                            msg.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#f87171;margin-right:8px;"></i>Restore failed.`;
                            subMsg.textContent = state.error ? friendlyError(state.error) : 'Something went wrong. Please try again.';
                            clearInterval(interval);
                        }
                    });
            }, 500);
        }, null, { backAction: backFn, bgImage: bgUrl });
    }

    // ─── Settings (Fetch API Sources and Check for Updates moved here) ─

    function showSettingsManagerPopup(backFn) {
        createModal('Settings', (body, overlay) => {
            body.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fa-solid fa-spinner" style="font-size:22px;color:${NOVA.accent};animation:pnSpinner 0.8s linear infinite;"></i></div>`;
            fetchSettingsConfig(true).then(config => {
                const values = JSON.parse(JSON.stringify(config.values || {}));
                const schema = config.schema || [];
                body.innerHTML = '';
                body.style.textAlign = 'left';

                let saveTimer = null;
                function scheduleSave(groupKey, optionKey, val) {
                    if (!values[groupKey]) values[groupKey] = {};
                    values[groupKey][optionKey] = val;
                    clearTimeout(saveTimer);
                    saveTimer = setTimeout(() => {
                        const changes = {};
                        for (const g of schema) {
                            const gc = {};
                            for (const o of (g.options || [])) {
                                const newVal = values[g.key]?.[o.key];
                                const oldVal = config.values?.[g.key]?.[o.key];
                                if (newVal !== undefined && newVal !== oldVal) gc[o.key] = newVal;
                            }
                            if (Object.keys(gc).length) changes[g.key] = gc;
                        }
                        if (values.general?.morrenusApiKey    !== config.values?.general?.morrenusApiKey)    { if (!changes.general) changes.general = {}; changes.general.morrenusApiKey    = values.general.morrenusApiKey; }
                        if (values.general?.manifesthubApiKey !== config.values?.general?.manifesthubApiKey) { if (!changes.general) changes.general = {}; changes.general.manifesthubApiKey = values.general.manifesthubApiKey; }
                        if (!Object.keys(changes).length) return;
                        Millennium.callServerMethod('projectnova', 'ApplySettingsChanges', { changesJson: JSON.stringify(changes) })
                            .then(res => {
                                const p = typeof res === 'string' ? JSON.parse(res) : res;
                                if (p?.success) {
                                    for (const gk of Object.keys(changes)) {
                                        if (!config.values[gk]) config.values[gk] = {};
                                        Object.assign(config.values[gk], changes[gk]);
                                    }
                                }
                            });
                    }, 500);
                }

                // Schema-based settings groups
                for (const group of schema) {
                    if (!group.options?.length) continue;
                    if (!values[group.key]) values[group.key] = {};
                    const groupDiv = document.createElement('div');
                    groupDiv.style.cssText = `background:rgba(168,85,247,0.05);border:1px solid rgba(168,85,247,0.22);border-radius:14px;padding:18px 20px;margin-bottom:16px;`;
                    const groupTitle = document.createElement('div');
                    groupTitle.style.cssText = `font-size:15px;font-weight:700;color:${NOVA.accentLight};margin-bottom:10px;display:flex;align-items:center;gap:8px;`;
                    groupTitle.innerHTML = `<i class="fa-solid fa-gear" style="font-size:13px;"></i>${group.label || group.key}`;
                    groupDiv.appendChild(groupTitle);

                    for (const opt of group.options) {
                        if (['useSteamLanguage','language','theme','morrenusApiKey','manifesthubApiKey'].includes(opt.key)) continue;
                        const optDiv = document.createElement('div');
                        optDiv.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.05);display:flex;justify-content:space-between;align-items:center;gap:16px;';
                        const labelWrap = document.createElement('div'); labelWrap.style.flex = '1';
                        const label = document.createElement('div');
                        label.style.cssText = `font-size:14px;font-weight:500;color:${NOVA.text};`;
                        label.textContent = opt.label;
                        const desc = document.createElement('div');
                        desc.style.cssText = `margin-top:3px;font-size:12px;color:${NOVA.textSecondary};`;
                        desc.textContent = opt.description || '';
                        labelWrap.appendChild(label); labelWrap.appendChild(desc); optDiv.appendChild(labelWrap);

                        const currentVal = (values[group.key][opt.key] !== undefined) ? values[group.key][opt.key] : opt.default;
                        let control;
                        if (opt.type === 'toggle') {
                            const toggleLabel = document.createElement('label'); toggleLabel.className = 'pn-toggle';
                            const input = document.createElement('input'); input.type = 'checkbox'; input.checked = currentVal === true;
                            const slider = document.createElement('span'); slider.className = 'pn-slider';
                            input.addEventListener('change', () => scheduleSave(group.key, opt.key, input.checked));
                            toggleLabel.appendChild(input); toggleLabel.appendChild(slider); control = toggleLabel;
                        } else if (opt.type === 'select') {
                            const select = document.createElement('select'); select.className = 'pn-select'; select.style.width = '180px';
                            for (const choice of (opt.choices || [])) {
                                const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.label; select.appendChild(option);
                            }
                            select.value = currentVal; select.onchange = () => scheduleSave(group.key, opt.key, select.value); control = select;
                        } else if (opt.type === 'text') {
                            const input = document.createElement('input'); input.className = 'pn-input'; input.type = 'text'; input.style.width = '180px';
                            input.placeholder = opt.metadata?.placeholder || ''; input.value = currentVal || '';
                            input.oninput = () => scheduleSave(group.key, opt.key, input.value); control = input;
                        } else { control = document.createElement('div'); }
                        optDiv.appendChild(control); groupDiv.appendChild(optDiv);
                    }
                    body.appendChild(groupDiv);
                }

                // API Keys section
                const apiKeysSection = document.createElement('div');
                apiKeysSection.style.cssText = `background:rgba(168,85,247,0.05);border:1px solid rgba(168,85,247,0.22);border-radius:14px;padding:18px 20px;margin-bottom:16px;`;
                const apiKeysTitle = document.createElement('div');
                apiKeysTitle.style.cssText = `font-size:15px;font-weight:700;color:${NOVA.accentLight};margin-bottom:14px;display:flex;align-items:center;gap:8px;`;
                apiKeysTitle.innerHTML = `<i class="fa-solid fa-key" style="font-size:13px;"></i>API Keys`;
                apiKeysSection.appendChild(apiKeysTitle);

                function makeApiKeyRow(name, desc, storageKey, getUrl) {
                    const row = document.createElement('div'); row.className = 'pn-apikey-row';
                    const info = document.createElement('div'); info.className = 'pn-apikey-info';
                    info.innerHTML = `<div class="pn-apikey-info-name">${name}</div><div class="pn-apikey-info-desc">${desc}</div>`;
                    const inputWrap = document.createElement('div'); inputWrap.className = 'pn-apikey-input-wrap';
                    const inp = document.createElement('input'); inp.className = 'pn-input'; inp.type = 'text'; inp.placeholder = 'Enter your API key';
                    inp.value = values.general?.[storageKey] || '';
                    inp.oninput = () => scheduleSave('general', storageKey, inp.value);
                    const getBtn = document.createElement('a'); getBtn.href = '#'; getBtn.className = 'pn-btn primary';
                    getBtn.innerHTML = '<i class="fa-solid fa-arrow-up-right-from-square"></i>&nbsp;Get Key';
                    getBtn.onclick = e => { e.preventDefault(); openUrl(getUrl); };
                    inputWrap.appendChild(inp); inputWrap.appendChild(getBtn);
                    row.appendChild(info); row.appendChild(inputWrap);
                    return row;
                }

                apiKeysSection.appendChild(makeApiKeyRow('Morrenus API Key', 'Used for adding games and updating Manifests via Morrenus', 'morrenusApiKey', 'https://manifest.morrenus.xyz/'));
                apiKeysSection.appendChild(makeApiKeyRow('ManifestHub API Key', 'Used for adding games and updating Manifests via ManifestHub', 'manifesthubApiKey', 'https://manifesthub1.filegear-sg.me/'));
                body.appendChild(apiKeysSection);

                // Fetch API Sources in Settings
                const utilSection = document.createElement('div');
                utilSection.style.cssText = `background:rgba(168,85,247,0.05);border:1px solid rgba(168,85,247,0.22);border-radius:14px;padding:18px 20px;margin-bottom:16px;`;
                const utilTitle = document.createElement('div');
                utilTitle.style.cssText = `font-size:15px;font-weight:700;color:${NOVA.accentLight};margin-bottom:14px;display:flex;align-items:center;gap:8px;`;
                utilTitle.innerHTML = `<i class="fa-solid fa-sliders" style="font-size:13px;"></i>Maintenance`;
                utilSection.appendChild(utilTitle);

                const fetchRow = document.createElement('div');
                fetchRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid rgba(255,255,255,0.05);';
                const fetchInfo = document.createElement('div');
                fetchInfo.innerHTML = `<div style="font-size:14px;font-weight:500;color:${NOVA.text};">Fetch API Sources</div><div style="font-size:12px;color:${NOVA.textSecondary};margin-top:2px;">Update the list of available download sources</div>`;
                const fetchBtn = document.createElement('a');
                fetchBtn.href = '#'; fetchBtn.className = 'pn-btn';
                fetchBtn.innerHTML = '<i class="fa-solid fa-server"></i>&nbsp;Fetch Now';
                fetchBtn.onclick = e => {
                    e.preventDefault();
                    fetchBtn.style.pointerEvents = 'none';
                    fetchBtn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;"></i>&nbsp;Fetching…';
                    Millennium.callServerMethod('projectnova', 'FetchFreeApisNow', {})
                        .then(res => {
                            const p = typeof res === 'string' ? JSON.parse(res) : res;
                            fetchBtn.style.pointerEvents = '';
                            fetchBtn.innerHTML = '<i class="fa-solid fa-server"></i>&nbsp;Fetch Now';
                            if (p?.success) showToast('API sources updated!' + (p.count ? ' Found ' + p.count + ' sources.' : ''), 'success');
                            else ShowProjectNovaAlert('Could Not Update', 'Could not update API sources. Check your internet connection and try again.');
                        });
                };
                fetchRow.appendChild(fetchInfo); fetchRow.appendChild(fetchBtn);
                utilSection.appendChild(fetchRow);

                // Check for Updates in Settings
                const updateRow = document.createElement('div');
                updateRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-top:12px;';
                const updateInfo = document.createElement('div');
                updateInfo.innerHTML = `<div style="font-size:14px;font-weight:500;color:${NOVA.text};">Check for Updates</div><div style="font-size:12px;color:${NOVA.textSecondary};margin-top:2px;">Check if a newer version of Project Nova is available</div>`;
                const updateBtn = document.createElement('a');
                updateBtn.href = '#'; updateBtn.className = 'pn-btn';
                updateBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>&nbsp;Check';
                updateBtn.onclick = e => {
                    e.preventDefault();
                    updateBtn.style.pointerEvents = 'none';
                    updateBtn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;"></i>&nbsp;Checking…';
                    Millennium.callServerMethod('projectnova', 'CheckForUpdatesNow', {})
                        .then(res => {
                            const p = typeof res === 'string' ? JSON.parse(res) : res;
                            updateBtn.style.pointerEvents = '';
                            updateBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i>&nbsp;Check';
                            if (p?.success && p.message) {
                                showProjectNovaConfirm('Update Available', p.message, () => Millennium.callServerMethod('projectnova', 'RestartSteam', {}));
                            } else {
                                ShowProjectNovaAlert('Up to Date', 'You are already on the latest version of Project Nova.');
                            }
                        });
                };
                updateRow.appendChild(updateInfo); updateRow.appendChild(updateBtn);
                utilSection.appendChild(updateRow);
                body.appendChild(utilSection);

                if (!schema.length) body.innerHTML = `<div class="pn-info-box">No settings are available at this time.</div>`;
            }).catch(err => {
                body.style.textAlign = 'left';
                body.innerHTML = `<div class="pn-error-box"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>Could not load settings. Please try closing and reopening this page.<br><br><span style="font-size:11px;opacity:0.7;">${err.message}</span></div>`;
            });
        }, null, { backAction: backFn });
    }

    // ─── Manifest Updater ────────────────────────────────────────────────────────

    function showManifestUpdaterModal(backFn) {
        createModal('Manifest Updater', (body, overlay) => {
            body.style.textAlign = 'left';
            body.innerHTML = `
                <div class="pn-info-box"><i class="fa-solid fa-download" style="margin-right:8px;"></i>Update Steam depot manifests and resolve issues such as "No Internet Connection".</div>
                <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:${NOVA.textSecondary};">Steam App ID</div>
                <input type="text" id="manifest-appid" class="pn-input" placeholder="e.g. 50130" style="width:100%;margin-bottom:16px;" inputmode="numeric">
                <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:${NOVA.textSecondary};">Download Method</div>
                <div class="pn-manifest-controls">
                    <select id="manifest-mode" class="pn-select">
                        <option value="github">GitHub Mirror</option>
                        <option value="github+morrenus">GitHub + Morrenus</option>
                        <option value="github+manifesthub">GitHub + ManifestHub</option>
                    </select>
                    <a href="#" id="start-manifest-update" class="pn-btn primary"><i class="fa-solid fa-play"></i>&nbsp;Start Update</a>
                </div>
                <div id="api-key-hint" style="display:none;"></div>
                <div id="manifest-progress" style="display:none;margin-top:16px;">
                    <div class="pn-progress-wrap"><div class="pn-progress-track"><div id="manifest-progress-bar" class="pn-progress-fill" style="width:0%"></div></div></div>
                    <div id="manifest-status-msg" style="margin-top:10px;font-size:14px;font-weight:500;color:${NOVA.textSecondary};"></div>
                </div>
            `;

            const appidInput   = body.querySelector('#manifest-appid');
            const modeSelect   = body.querySelector('#manifest-mode');
            const apiHint      = body.querySelector('#api-key-hint');
            const startBtn     = body.querySelector('#start-manifest-update');
            const progressDiv  = body.querySelector('#manifest-progress');
            const progressBar  = body.querySelector('#manifest-progress-bar');
            const statusMsgDiv = body.querySelector('#manifest-status-msg');

            const currentId = getCurrentAppId();
            if (currentId) appidInput.value = currentId;

            function updateHint() {
                const mode = modeSelect.value;
                if (mode === 'github+morrenus' || mode === 'github+manifesthub') {
                    const keyName = mode === 'github+morrenus' ? 'Morrenus' : 'ManifestHub';
                    const keyUrl  = mode === 'github+morrenus' ? 'https://manifest.morrenus.xyz/' : 'https://manifesthub1.filegear-sg.me/';
                    apiHint.className = 'pn-warn-box'; apiHint.style.display = 'block'; apiHint.innerHTML = '';
                    const hintText = document.createElement('div');
                    hintText.style.cssText = 'margin-bottom:12px;font-size:13px;';
                    hintText.innerHTML = `<i class="fa-solid fa-key" style="margin-right:8px;color:#fbbf24;"></i><strong>API key needed for this method.</strong> You can add it in Settings → API Keys.`;
                    const btnRow = document.createElement('div'); btnRow.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;';
                    const goSettings = document.createElement('a'); goSettings.href = '#'; goSettings.className = 'pn-btn';
                    goSettings.innerHTML = '<i class="fa-solid fa-gear"></i>&nbsp;Go to Settings';
                    goSettings.onclick = e => { e.preventDefault(); overlay.remove(); showSettingsManagerPopup(() => showManifestUpdaterModal(backFn)); };
                    const getKey = document.createElement('a'); getKey.href = '#'; getKey.className = 'pn-btn';
                    getKey.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i>&nbsp;Get a ${keyName} Key`;
                    getKey.onclick = e => { e.preventDefault(); openUrl(keyUrl); };
                    btnRow.appendChild(goSettings); btnRow.appendChild(getKey);
                    apiHint.appendChild(hintText); apiHint.appendChild(btnRow);
                } else { apiHint.style.display = 'none'; apiHint.className = ''; }
            }
            modeSelect.addEventListener('change', updateHint);
            updateHint();

            let pollInterval = null;
            startBtn.onclick = e => {
                e.preventDefault();
                const appid = appidInput.value.trim();
                if (!appid || !/^\d+$/.test(appid)) {
                    appidInput.style.borderColor = '#ff5050'; appidInput.focus();
                    ShowProjectNovaAlert('Invalid App ID', 'Please enter a valid numeric Steam App ID.', overlay);
                    return;
                }
                appidInput.style.borderColor = NOVA.border;
                const mode = modeSelect.value;
                fetchSettingsConfig(false).then(cfg => {
                    const morrenusKey    = cfg.values?.general?.morrenusApiKey || '';
                    const manifesthubKey = cfg.values?.general?.manifesthubApiKey || '';
                    if (mode === 'github+morrenus' && !morrenusKey) {
                        ShowProjectNovaAlert('Morrenus API Key Required', 'This method requires a Morrenus API key. Go to Settings → API Keys and add it first.', overlay);
                        return;
                    }
                    if (mode === 'github+manifesthub' && !manifesthubKey) {
                        ShowProjectNovaAlert('ManifestHub API Key Required', 'This method requires a ManifestHub API key. Go to Settings → API Keys and add it first.', overlay);
                        return;
                    }
                    startBtn.style.pointerEvents = 'none'; startBtn.style.opacity = '0.6';
                    startBtn.innerHTML = '<i class="fa-solid fa-spinner" style="animation:pnSpinner 0.7s linear infinite;"></i>&nbsp;Updating…';
                    progressDiv.style.display = 'block';
                    statusMsgDiv.textContent = 'Starting update, please wait…';

                    Millennium.callServerMethod('projectnova', 'run_manifest_updater_interactive', {
                        appid, mode, morrenusKey, manifesthubKey, hideWindow: true
                    }).then(res => {
                        let p;
                        try { p = typeof res === 'string' ? JSON.parse(res) : res; } catch(e) {
                            statusMsgDiv.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#f87171;margin-right:6px;"></i>Could not start the update. Please try again.';
                            resetStartBtn(); return;
                        }
                        if (!p || !p.success) {
                            statusMsgDiv.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#f87171;margin-right:6px;"></i>${p?.error ? friendlyError(p.error) : 'Could not start the update.'}`;
                            resetStartBtn(); return;
                        }
                        if (pollInterval) clearInterval(pollInterval);
                        pollInterval = setInterval(() => {
                            Millennium.callServerMethod('projectnova', 'get_manifest_updater_status', {})
                                .then(statusRes => {
                                    let st;
                                    try { st = typeof statusRes === 'string' ? JSON.parse(statusRes) : statusRes; } catch(e) { return; }
                                    if (!st?.success) return;
                                    if (st.status === 'running') {
                                        progressBar.style.width = '55%';
                                        statusMsgDiv.textContent = 'Update in progress… Please wait.';
                                        setTimeout(() => { if (progressBar.style.width === '55%') progressBar.style.width = '75%'; }, 1500);
                                    } else if (st.status === 'done') {
                                        clearInterval(pollInterval);
                                        progressBar.style.width = '100%'; progressBar.classList.add('done');
                                        statusMsgDiv.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#22c55e;margin-right:6px;"></i>Manifests updated! Your game should now be up to date.';
                                        startBtn.style.pointerEvents = ''; startBtn.style.opacity = '';
                                        startBtn.innerHTML = '<i class="fa-solid fa-check"></i>&nbsp;Done';
                                        showToast('Manifests updated for App ID ' + appid + '!', 'success');
                                    } else if (st.status === 'error') {
                                        clearInterval(pollInterval);
                                        progressBar.style.width = '0%';
                                        statusMsgDiv.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#f87171;margin-right:6px;"></i>${st.error ? friendlyError(st.error) : 'The update failed. Try a different download method or check your App ID.'}`;
                                        resetStartBtn();
                                    }
                                }).catch(() => {});
                        }, 1000);
                    }).catch(err => {
                        statusMsgDiv.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#f87171;margin-right:6px;"></i>${friendlyError(String(err))}`;
                        resetStartBtn();
                    });
                });
            };

            function resetStartBtn() { startBtn.style.pointerEvents = ''; startBtn.style.opacity = ''; startBtn.innerHTML = '<i class="fa-solid fa-play"></i>&nbsp;Start Update'; }
            const originalRemove = overlay.remove.bind(overlay);
            overlay.remove = function () { if (pollInterval) clearInterval(pollInterval); originalRemove(); };
        }, null, { backAction: backFn });
    }

    // ─── FAQ ─────────────────────────────────────────────────────────────────────

    function showFAQModal(backFn) {
        createModal('Frequently Asked Questions', (body) => {
            body.style.textAlign = 'left';
            const faqs = [
                { q: 'Is multiplayer functionality supported?', p: 'In most cases, additional files are required for multiplayer to function properly. You can only play with others who are using the SteamTools version of the game with the same fix applied.\n\nThese files can typically be found in the Game Fixer in the Project Nova menu, or on sites such as:', links: [{ text: 'Browse online-fix.me', url: 'https://online-fix.me' }] },
                { q: 'Are DLCs included with the game?', p: 'Most supported games include all available DLCs by default.', links: [] },
                { q: 'Why does my antivirus flag SteamTools as a potential threat?', p: 'SteamTools is closed-source, so its internal code cannot be fully audited. Some of its features may trigger antivirus warnings.\n\nIf you choose to continue, you may need to temporarily disable your antivirus. Only do so if you fully understand and accept the risks involved.', links: [] },
                { q: 'What should I do if the game is not working?', p: 'Try the Game Fixer to resolve common issues, or search online — most problems already have solutions available. You can also browse community fixes at:', links: [{ text: 'Find fixes at generator.ryuu.lol', url: 'https://generator.ryuu.lol/fixes' }] },
                { q: 'Why won\'t my game run if it uses Denuvo or other protections?', p: 'Compatibility is being actively improved. Future updates may include features to better handle protections like Denuvo.', links: [] },
                { q: 'Thanks for using Project Nova 💜', p: 'We appreciate your support! If you encounter any issues, use the Game Fixer or check the menu for more options.', links: [] }
            ];
            faqs.forEach(faq => {
                const item = document.createElement('div');
                item.style.cssText = `background:rgba(168,85,247,0.05);border:1px solid rgba(168,85,247,0.22);border-radius:16px;padding:20px;margin-bottom:14px;transition:border-color 0.25s;`;
                const h3 = document.createElement('h3');
                h3.style.cssText = `margin:0 0 10px;color:${NOVA.accentLight};font-size:15px;`;
                h3.textContent = faq.q;
                item.appendChild(h3);
                faq.p.split('\n\n').forEach(para => {
                    if (!para.trim()) return;
                    const p = document.createElement('p');
                    p.style.cssText = `color:${NOVA.textSecondary};margin:0 0 8px;font-size:13px;line-height:1.65;`;
                    p.textContent = para;
                    item.appendChild(p);
                });
                if (faq.links?.length) {
                    const linkRow = document.createElement('div'); linkRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';
                    faq.links.forEach(({ text, url }) => {
                        const btn = document.createElement('a'); btn.href = '#'; btn.className = 'pn-btn';
                        btn.style.cssText = 'font-size:12px;padding:7px 14px;';
                        btn.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i>&nbsp;${text}`;
                        btn.onclick = e => { e.preventDefault(); openUrl(url); };
                        linkRow.appendChild(btn);
                    });
                    item.appendChild(linkRow);
                }
                body.appendChild(item);
            });
        }, null, { backAction: backFn });
    }

    // ─── Loaded Apps Popup ───────────────────────────────────────────────────────

    function showLoadedAppsPopup(apps) {
        if (document.querySelector('.pn-overlay')) return;
        createModal('Games Added to Your Library', (body) => {
            body.style.textAlign = 'left';
            if (apps?.length) {
                const intro = document.createElement('div'); intro.className = 'pn-info-box';
                intro.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#22c55e;margin-right:8px;"></i>The following games have been added to your Steam library. Click a game to install it.`;
                body.appendChild(intro);
                apps.forEach(item => {
                    const a = document.createElement('div');
                    a.className = 'pn-game-item'; a.style.cursor = 'pointer';
                    const imgEl = makeGameThumb(item.appid, 80, 48, 6);
                    const nameSpan = document.createElement('span');
                    nameSpan.style.cssText = `flex:1;font-weight:600;color:${NOVA.text};`;
                    nameSpan.textContent = item.name || ('App ID: ' + item.appid);
                    const idSpan = document.createElement('span');
                    idSpan.style.cssText = `font-size:12px;color:${NOVA.textSecondary};`;
                    idSpan.textContent = 'App ID: ' + item.appid;

                    const bgLayer = document.createElement('div'); bgLayer.className = 'pn-game-item-bg';
                    const ovLayer = document.createElement('div'); ovLayer.className = 'pn-game-item-overlay';
                    const content = document.createElement('div'); content.className = 'pn-game-item-content';
                    content.style.gap = '12px';
                    content.appendChild(imgEl); content.appendChild(nameSpan); content.appendChild(idSpan);

                    a.appendChild(bgLayer); a.appendChild(ovLayer); a.appendChild(content);
                    a.onclick = () => { window.location.href = 'steam://install/' + item.appid; };
                    a.oncontextmenu = e => { e.preventDefault(); openUrl('https://steamdb.info/app/' + item.appid + '/'); };
                    body.appendChild(a);

                    getBestBackgroundUrl(item.appid).then(bgUrl => {
                        if (bgUrl) { bgLayer.style.backgroundImage = `url('${bgUrl}')`; bgLayer.classList.add('loaded'); }
                    });
                });
            } else {
                body.innerHTML = `<div style="text-align:center;padding:40px;">No games found.</div>`;
            }
        }, () => {
            Millennium.callServerMethod('projectnova', 'DismissLoadedApps', {});
            sessionStorage.setItem('ProjectNovaLoadedAppsShown', '1');
        });
    }

    // ─── Header Button ───────────────────────────────────────────────────────────

    function injectHeaderButton() {
        const selectors = [
            '._1wn1lBlAzl3HMRqS1llwie',
            '.header_installsteam_btn_container',
            '.global_header_links',
            '.responsive_page_menu_ctn',
            '#global_header .content'
        ];
        for (const sel of selectors) {
            const container = document.querySelector(sel);
            if (container && !container.querySelector('.projectnova-header-button')) {
                const btn = document.createElement('a');
                btn.href = '#';
                btn.className = 'projectnova-header-button';
                btn.title = 'Project Nova';
                btn.style.marginLeft = '8px';
                loadIconIntoElement(btn, 20);
                btn.onclick = (e) => { e.preventDefault(); showSettingsPopup(); };
                container.appendChild(btn);
                window.__PROJECTNOVA_HEADER_INSERTED__ = true;
                return true;
            }
        }
        return false;
    }

    // ─── Steam Page Buttons ──────────────────────────────────────────────────────

    function addProjectNovaButton() {
        const now = Date.now();
        if (now - lastButtonCheckTime < 300) return;
        lastButtonCheckTime = now;

        const currentUrl = window.location.href;
        if (window.__PROJECTNOVA_LAST_URL__ !== currentUrl) {
            window.__PROJECTNOVA_LAST_URL__     = currentUrl;
            window.__PROJECTNOVA_BUTTON_INSERTED__  = false;
            window.__PROJECTNOVA_RESTART_INSERTED__ = false;
            window.__PROJECTNOVA_HEADER_INSERTED__  = false;
            window.__PROJECTNOVA_REMOVE_INSERTED__  = false;
        }

        if (!injectHeaderButton()) {
            const obs = new MutationObserver(() => { if (injectHeaderButton()) obs.disconnect(); });
            obs.observe(document.body, { childList: true, subtree: true });
            let retryCount = 0;
            if (!window.__headerRetryInterval) {
                window.__headerRetryInterval = setInterval(() => {
                    if (injectHeaderButton()) {
                        clearInterval(window.__headerRetryInterval);
                        window.__headerRetryInterval = null;
                        obs.disconnect();
                    } else if (++retryCount > 10) {
                        clearInterval(window.__headerRetryInterval);
                        window.__headerRetryInterval = null;
                    }
                }, 2000);
            }
        }

        const isBigPicture = window.__PROJECTNOVA_IS_BIG_PICTURE__;
        let targetContainer;
        if (isBigPicture) {
            const queueBtn = document.querySelector('#queueBtnFollow');
            targetContainer = queueBtn ? queueBtn.parentElement : null;
        } else {
            targetContainer = document.querySelector('.steamdb-buttons') || document.querySelector('[data-steamdb-buttons]') || document.querySelector('.apphub_OtherSiteInfo');
        }
        if (!targetContainer) targetContainer = document.querySelector('.game_meta_actions') || document.querySelector('.header_installsteam_btn_container');
        if (!targetContainer) return;

        const referenceBtn = isBigPicture
            ? document.querySelector('#queueBtnFollow')
            : (targetContainer.querySelector('a') || targetContainer.querySelector('button'));
        const steamBtnClass = (referenceBtn && referenceBtn.className) ? referenceBtn.className : 'btnv6_blue_hoverfade btn_medium';

        // Restart Steam button
        if (window.location.pathname.includes('/app/') && !document.querySelector('.projectnova-restart-button') && !window.__PROJECTNOVA_RESTART_INSERTED__) {
            const restartBtn = document.createElement('a');
            restartBtn.className = steamBtnClass + ' projectnova-restart-button';
            restartBtn.href = '#'; restartBtn.style.marginLeft = '6px';
            restartBtn.innerHTML = `<span>Restart Steam</span>`;
            restartBtn.onclick = e => { e.preventDefault(); showProjectNovaConfirm('Restart Steam', 'Are you sure you want to restart Steam now?', () => Millennium.callServerMethod('projectnova', 'RestartSteam', {})); };
            if (referenceBtn?.parentElement) referenceBtn.after(restartBtn);
            else targetContainer.appendChild(restartBtn);
            window.__PROJECTNOVA_RESTART_INSERTED__ = true;
        }

        const appid = getCurrentAppId();
        if (appid && !window.__PROJECTNOVA_BUTTON_INSERTED__) {
            Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid })
                .then(res => {
                    const p = typeof res === 'string' ? JSON.parse(res) : res;
                    if (p?.exists) insertRemoveButton();
                    else           insertAddButton();
                })
                .catch(() => insertAddButton());
        }

        // Remove button uses the game info box confirmation modal
        function insertRemoveButton() {
            if (document.querySelector('.projectnova-remove-button') || document.querySelector('.projectnova-button')) return;
            const removeBtn = document.createElement('a');
            removeBtn.className = steamBtnClass + ' projectnova-remove-button';
            removeBtn.href = '#'; removeBtn.style.marginLeft = '6px';
            removeBtn.innerHTML = `<span>Remove from your library</span>`;
            removeBtn.onclick = e => {
                e.preventDefault();
                fetchSteamGameName(appid).then(name => {
                    showRemoveConfirmWithGameBox(appid, name, () => {
                        Millennium.callServerMethod('projectnova', 'DeleteProjectNovaForApp', { appid })
                            .then(() => {
                                window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
                                window.__PROJECTNOVA_REMOVE_INSERTED__ = false;
                                addProjectNovaButton();
                                showToast('Game removed from your library.', 'success');
                            })
                            .catch(() => ShowProjectNovaAlert('Error', 'Could not remove. Please try again.'));
                    });
                });
            };
            const restartBtn = targetContainer.querySelector('.projectnova-restart-button');
            if (restartBtn?.after) restartBtn.after(removeBtn);
            else if (referenceBtn?.after) referenceBtn.after(removeBtn);
            else targetContainer.appendChild(removeBtn);
            window.__PROJECTNOVA_BUTTON_INSERTED__ = true;
            window.__PROJECTNOVA_REMOVE_INSERTED__ = true;
        }

        function insertAddButton() {
            if (document.querySelector('.projectnova-button') || document.querySelector('.projectnova-remove-button')) return;
            const addBtn = document.createElement('a');
            addBtn.className = steamBtnClass + ' projectnova-button';
            addBtn.href = '#'; addBtn.style.marginLeft = '6px';
            addBtn.innerHTML = `<span>Add to your library</span>`;
            const restartBtn = targetContainer.querySelector('.projectnova-restart-button');
            if (restartBtn?.after) restartBtn.after(addBtn);
            else if (referenceBtn?.after) referenceBtn.after(addBtn);
            else targetContainer.appendChild(addBtn);
            window.__PROJECTNOVA_BUTTON_INSERTED__ = true;

            fetchGamesDatabase().then(db => {
                const gameData = db?.[String(appid)];
                let status = 'untested';
                if (gameData?.playable !== undefined) {
                    if (gameData.playable === 1) status = 'playable';
                    else if (gameData.playable === 0) status = 'unplayable';
                    else if (gameData.playable === 2) status = 'needs_fixes';
                }
                if (status !== 'untested' && !addBtn.querySelector('.projectnova-pills-container')) {
                    const pillContainer = document.createElement('div');
                    pillContainer.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);white-space:nowrap;';
                    const pill = document.createElement('span');
                    const pillColor = status === 'playable' ? '#22c55e' : (status === 'unplayable' ? '#f87171' : '#fbbf24');
                    pill.style.cssText = `display:inline-block;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:800;text-transform:uppercase;background:${pillColor};color:#000;`;
                    pill.textContent = status.replace('_', ' ');
                    pillContainer.appendChild(pill);
                    addBtn.style.position = 'relative';
                    addBtn.appendChild(pillContainer);
                }
            });
        }
    }

    let lastButtonCheckTime = 0;

    // ─── Initialisation ──────────────────────────────────────────────────────────

    function onFrontendReady() {
        ensureNovaTheme();
        ensureFontAwesome();

        if (window.location.hostname === 'store.steampowered.com' && localStorage.getItem('projectnova millennium disclaimer accepted') !== '1') {
            createModal('Important Notice', (body) => {
                body.style.textAlign = 'left';
                body.innerHTML = `
                    <div class="pn-warn-box"><strong><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>Please read this before continuing.</strong></div>
                    <div class="pn-info-box">
                        <p style="margin:0 0 10px;">Project Nova uses SteamTools, a closed-source application whose internal code cannot be fully audited. Some antivirus software may flag it. Be aware of potential privacy implications before continuing.</p>
                        <p style="margin:0 0 10px;">Despite this, the tool works as intended and has been used by over 100,000 users worldwide.</p>
                        <p style="margin:0;">You may need to temporarily disable your antivirus software. Proceed at your own discretion.</p>
                    </div>
                `;
                const btnRow = document.createElement('div');
                btnRow.style.cssText = 'display:flex;justify-content:center;margin-top:20px;';
                const continueBtn = document.createElement('a');
                continueBtn.href = '#'; continueBtn.className = 'pn-btn primary';
                continueBtn.innerHTML = '<i class="fa-solid fa-check"></i>&nbsp;I Understand, Continue';
                continueBtn.onclick = e => {
                    e.preventDefault();
                    localStorage.setItem('projectnova millennium disclaimer accepted', '1');
                    document.querySelector('.pn-overlay')?.remove();
                };
                btnRow.appendChild(continueBtn);
                body.appendChild(btnRow);
            }, null, { backAction: () => document.querySelector('.pn-overlay')?.remove() });
        }

        addProjectNovaButton();

        if (window.location.hostname === 'store.steampowered.com' && !sessionStorage.getItem('ProjectNovaLoadedAppsGate')) {
            sessionStorage.setItem('ProjectNovaLoadedAppsGate', '1');
            Millennium.callServerMethod('projectnova', 'ReadLoadedApps', {})
                .then(res => {
                    const p = typeof res === 'string' ? JSON.parse(res) : res;
                    const apps = p?.success && Array.isArray(p.apps) ? p.apps : [];
                    if (apps.length) showLoadedAppsPopup(apps);
                });
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onFrontendReady);
    else onFrontendReady();

    // Click handler for the "Add to your library" button on the Steam page
    document.addEventListener('click', evt => {
        const anchor = evt.target.closest('.projectnova-button');
        if (!anchor) return;
        evt.preventDefault(); evt.stopPropagation();
        const appid = getCurrentAppId();
        if (isNaN(appid) || runState.inProgress) return;

        const continueWithAdd = () => {
            if (!document.querySelector('.pn-overlay')) showDownloadPopupForAppId(appid);
            runState.inProgress = true; runState.appid = appid; runState.cancelRequested = false;
            Millennium.callServerMethod('projectnova', 'StartAddViaProjectNova', { appid });
        };

        fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`)
            .then(r => r.json())
            .then(data => {
                if (data?.[appid]?.success && data[appid].data?.type === 'dlc' && data[appid].data.fullgame) {
                    createModal('DLC Detected', (body) => {
                        body.style.textAlign = 'left';
                        body.innerHTML = `<p class="pn-info-box"><i class="fa-solid fa-info-circle" style="margin-right:8px;"></i>DLCs are added together with the base game. Please go to the base game page:<br><br><strong style="color:${NOVA.accentLight};font-size:15px;">${data[appid].data.fullgame.name}</strong></p>`;
                        const btnRow = document.createElement('div');
                        btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';
                        const gotoBtn = document.createElement('a');
                        gotoBtn.href = '#'; gotoBtn.className = 'pn-btn primary';
                        gotoBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i>&nbsp;Go to Base Game';
                        gotoBtn.onclick = e => { e.preventDefault(); window.location.href = 'https://store.steampowered.com/app/' + data[appid].data.fullgame.appid; };
                        const cancelBtn = document.createElement('a');
                        cancelBtn.href = '#'; cancelBtn.className = 'pn-btn'; cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Cancel';
                        cancelBtn.onclick = e => { e.preventDefault(); document.querySelector('.pn-overlay')?.remove(); };
                        btnRow.appendChild(cancelBtn); btnRow.appendChild(gotoBtn); body.appendChild(btnRow);
                    });
                    return;
                }
                fetchGamesDatabase().then(db => {
                    const gameData = db?.[String(appid)];
                    if (gameData?.playable === 0) {
                        createModal('Warning', (body) => {
                            body.style.textAlign = 'left';
                            body.innerHTML = `<p class="pn-warn-box"><i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>This game may not work correctly with Project Nova. You can still try adding it, but it might not run as expected.</p>`;
                            const btnRow = document.createElement('div');
                            btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';
                            const proceedBtn = document.createElement('a');
                            proceedBtn.href = '#'; proceedBtn.className = 'pn-btn primary';
                            proceedBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i>&nbsp;Proceed Anyway';
                            const cancelBtn = document.createElement('a');
                            cancelBtn.href = '#'; cancelBtn.className = 'pn-btn'; cancelBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>&nbsp;Cancel';
                            proceedBtn.onclick = e => { e.preventDefault(); document.querySelector('.pn-overlay')?.remove(); continueWithAdd(); };
                            cancelBtn.onclick  = e => { e.preventDefault(); document.querySelector('.pn-overlay')?.remove(); };
                            btnRow.appendChild(cancelBtn); btnRow.appendChild(proceedBtn); body.appendChild(btnRow);
                        });
                    } else continueWithAdd();
                });
            })
            .catch(() => continueWithAdd());
    });

    // ─── URL Change Detection ────────────────────────────────────────────────────

    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            window.__PROJECTNOVA_BUTTON_INSERTED__  = false;
            window.__PROJECTNOVA_RESTART_INSERTED__ = false;
            window.__PROJECTNOVA_HEADER_INSERTED__  = false;
            window.__PROJECTNOVA_REMOVE_INSERTED__  = false;
            addProjectNovaButton();
        }
    }, 1500);

    window.addEventListener('popstate', () => setTimeout(() => addProjectNovaButton(), 100));
    const originalPushState = history.pushState;
    history.pushState = function () { originalPushState.apply(history, arguments); setTimeout(() => addProjectNovaButton(), 100); };
    const domObserver = new MutationObserver(() => {
        if (document.querySelector('.steamdb-buttons, #queueBtnFollow, .game_meta_actions, .header_installsteam_btn_container'))
            addProjectNovaButton();
    });
    domObserver.observe(document.body, { childList: true, subtree: true });

})();
