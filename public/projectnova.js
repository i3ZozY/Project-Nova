// Project Nova – Final (Fixed Modal Size + ManifestHub API Key + New Icon)
(function () {
    'use strict';

    // ========================== Nova Theme Tokens (Mid‑Dark) ==========================
    const NOVA = {
        bgPrimary:           '#0a0a1a',
        bgSecondary:         '#12122a',
        bgTertiary:          'rgba(10, 10, 26, 0.92)',
        bgHover:             'rgba(30, 30, 55, 0.95)',
        bgContainer:         'rgba(20,20,40,0.75)',
        accent:              '#a855f7',
        accentLight:         '#c084fc',
        accentDark:          '#7e22ce',
        border:              'rgba(168, 85, 247, 0.4)',
        borderHover:         'rgba(192, 132, 252, 0.9)',
        text:                '#f5f3ff',
        textSecondary:       '#ddd6fe',
        gradient:            'linear-gradient(135deg, #a855f7 0%, #4c1d95 100%)',
        gradientLight:       'linear-gradient(135deg, #c084fc 0%, #a855f7 100%)',
        shadow:              'rgba(168, 85, 247, 0.5)',
        shadowHover:         'rgba(168, 85, 247, 0.8)',
    };

    // ========================== Big Picture Mode ==========================
    function isBigPictureMode() {
        const htmlClasses = document.documentElement.className;
        const userAgent = navigator.userAgent;
        let score = 0;
        if (htmlClasses.includes('BasicUI')) score += 3;
        if (htmlClasses.includes('DesktopUI')) score -= 3;
        if (userAgent.includes('Valve Steam Gamepad')) score += 2;
        if (userAgent.includes('Valve Steam Client')) score -= 2;
        if (htmlClasses.includes('touch')) score += 1;
        return score > 0;
    }
    window.__PROJECTNOVA_IS_BIG_PICTURE__ = isBigPictureMode();

    function backendLog(message) {
        try {
            if (typeof Millennium !== 'undefined' && typeof Millennium.callServerMethod === 'function')
                Millennium.callServerMethod('projectnova', 'Logger.log', { message: String(message) });
        } catch (err) { console.warn('[Project Nova]', err); }
    }
    backendLog('Project Nova script loaded');

    const runState = { inProgress: false, appid: null, cancelRequested: false };

    // ========================== Helpers ==========================
    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
        return (bytes / 1073741824).toFixed(2) + ' GB';
    }

    function fetchGamesDatabase() {
        if (typeof Millennium === 'undefined') return Promise.resolve({});
        return Millennium.callServerMethod('projectnova', 'GetGamesDatabase', { contentScriptQuery: '' })
            .then(res => { let p = (res && (res.result || res.value)) || res; if (typeof p === 'string') try { p = JSON.parse(p); } catch(e) {} return p || {}; })
            .catch(() => ({}));
    }
    function fetchFixes(appid) {
        if (typeof Millennium === 'undefined') return Promise.resolve(null);
        return Millennium.callServerMethod('projectnova', 'CheckForFixes', { appid, contentScriptQuery: '' })
            .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; return (p && p.success) ? p : null; })
            .catch(() => null);
    }
    const steamGameNameCache = {};
    function fetchSteamGameName(appid) {
        if (!appid) return Promise.resolve(null);
        if (steamGameNameCache[appid]) return Promise.resolve(steamGameNameCache[appid]);
        return fetch('https://store.steampowered.com/api/appdetails?appids=' + appid + '&filters=basic')
            .then(r => r.json())
            .then(d => { if (d?.[appid]?.success && d[appid].data?.name) { steamGameNameCache[appid] = d[appid].data.name; return d[appid].data.name; } return null; })
            .catch(() => null);
    }
    function fetchGameIconUrl(appid) {
        return `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/capsule_sm_120.jpg`;
    }
    function openUrl(url) {
        if (typeof Millennium !== 'undefined') Millennium.callServerMethod('projectnova', 'OpenExternalUrl', { url, contentScriptQuery: '' });
        else window.open(url, '_blank');
    }

    // ========================== Translation System ==========================
    const TRANSLATION_PLACEHOLDER = 'translation missing';
    function applyTranslationBundle(bundle) {
        if (!bundle || typeof bundle !== 'object') return;
        const stored = window.__ProjectNovaI18n || {};
        stored.language = bundle.language || stored.language || 'en';
        stored.strings = bundle.strings || stored.strings || {};
        stored.locales = bundle.locales || stored.locales || [];
        stored.ready = true;
        window.__ProjectNovaI18n = stored;
    }
    function ensureTranslationsLoaded(forceRefresh, preferredLanguage) {
        if (!forceRefresh && window.__ProjectNovaI18n?.ready) return Promise.resolve(window.__ProjectNovaI18n);
        if (typeof Millennium === 'undefined') {
            window.__ProjectNovaI18n = window.__ProjectNovaI18n || { language: 'en', locales: [], strings: {}, ready: false };
            return Promise.resolve(window.__ProjectNovaI18n);
        }
        const settingsVals = ((window.__ProjectNovaSettings || {}).values || {}).general || {};
        const useSteamLang = typeof settingsVals.useSteamLanguage === 'boolean' ? settingsVals.useSteamLanguage : true;
        let targetLang = preferredLanguage || '';
        if (!targetLang) {
            let steamLang = document.documentElement.lang || 'en';
            if (steamLang.toLowerCase() === 'pt-br') steamLang = 'pt-BR';
            if (steamLang.toLowerCase() === 'zh-cn') steamLang = 'zh-CN';
            targetLang = useSteamLang ? steamLang : (window.__ProjectNovaI18n?.language || 'en');
        }
        return Millennium.callServerMethod('projectnova', 'GetTranslations', { language: targetLang, contentScriptQuery: '' })
            .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; if (!p?.success || !p.strings) throw new Error(); applyTranslationBundle(p); updateButtonTranslations(); return window.__ProjectNovaI18n; })
            .catch(() => { window.__ProjectNovaI18n = window.__ProjectNovaI18n || { language: 'en', locales: [], strings: {}, ready: false }; return window.__ProjectNovaI18n; });
    }
    function t(key, fallback) {
        try {
            const s = window.__ProjectNovaI18n;
            if (s?.strings?.[key] && s.strings[key].trim().toLowerCase() !== TRANSLATION_PLACEHOLDER) return s.strings[key];
        } catch(_) {}
        return fallback !== undefined ? fallback : key;
    }
    function lt(text) { return t(text, text); }

    // ========================== Nova SVG Icon (new) ==========================
    const NOVA_SVG = `<svg fill="#e31be5" width="24" height="24" version="1.1" id="Layer_1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="-50.4 -50.4 604.80 604.80" xml:space="preserve" stroke="#e31be5"><g><g><path d="M495.947,111.21c-18.032-31.24-62.452-43.284-125.068-33.92c-6.476,0.976-10.94,7.008-9.968,13.488 c0.964,6.48,7.008,10.944,13.48,9.98c51.556-7.712,88.372,0.42,101.012,22.316c24.088,41.72-39.852,138.192-173.432,215.312 c-61.076,35.264-123.98,58.544-177.132,65.56c-48.868,6.448-83.876-1.936-96.048-23.016c-12.636-21.892-1.284-57.828,31.14-98.592 c4.076-5.128,3.228-12.588-1.9-16.668c-5.116-4.08-12.584-3.228-16.664,1.896C1.979,317.09-9.785,361.562,8.243,392.794 c14.02,24.272,44.172,37,86.408,37c10.392,0,21.508-0.776,33.292-2.336c56.16-7.412,122.18-31.752,185.888-68.532 C450.571,279.978,530.563,171.17,495.947,111.21z"></path></g></g><g><g><path d="M252.099,38.574c-117.684,0-213.432,95.744-213.432,213.428c0,69.496,33.408,131.32,84.984,170.32 c5.712-0.348,11.656-0.92,17.828-1.74c53.152-7.012,116.06-30.296,177.132-65.56c66.98-38.668,116.436-82.204,146.084-121.264 C455.403,124.59,363.631,38.574,252.099,38.574z"></path></g></g><g><g><path d="M330.471,375.566c-59.5,34.352-121.008,57.84-174.616,66.832c28.936,14.692,61.624,23.028,96.248,23.028 c111.5,0,203.248-85.964,212.588-195.088C431.775,306.83,385.767,343.642,330.471,375.566z"></path></g></g></svg>`;
    let _novaIconDataUrl = null;
    function loadIconIntoButton(btn, size) {
        if (_novaIconDataUrl) {
            const img = document.createElement('img');
            img.src = _novaIconDataUrl;
            img.style.width = size + 'px';
            img.style.height = size + 'px';
            btn.innerHTML = '';
            btn.appendChild(img);
            return;
        }
        if (typeof Millennium !== 'undefined') {
            Millennium.callServerMethod('projectnova', 'GetIconDataUrl', { contentScriptQuery: '' })
                .then(res => {
                    try {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (p?.success && p.dataUrl) {
                            _novaIconDataUrl = p.dataUrl;
                            const img = document.createElement('img');
                            img.src = _novaIconDataUrl;
                            img.style.width = size + 'px';
                            img.style.height = size + 'px';
                            btn.innerHTML = '';
                            btn.appendChild(img);
                            return;
                        }
                    } catch(_) {}
                    btn.innerHTML = NOVA_SVG.replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`);
                })
                .catch(() => { btn.innerHTML = NOVA_SVG.replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`); });
        } else {
            btn.innerHTML = NOVA_SVG.replace('width="24"', `width="${size}"`).replace('height="24"', `height="${size}"`);
        }
    }

    // ========================== Dynamic Modal Creator ==========================
    function createModal(titleText, contentCallback, onClose, opts) {
        opts = opts || {};
        const overlay = document.createElement('div');
        overlay.className = 'pn-overlay';
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) { overlay.remove(); if (onClose) onClose(); } });

        const modal = document.createElement('div');
        modal.className = 'pn-modal';
        if (opts.bgImage) {
            modal.style.backgroundImage = `linear-gradient(rgba(10,10,26,0.88), rgba(10,10,26,0.94)), url(${opts.bgImage})`;
            modal.style.backgroundSize = 'cover';
            modal.style.backgroundPosition = 'center top';
        }

        const header = document.createElement('div');
        header.className = 'pn-modal-header';

        // Back button for every modal except the main menu
        if (opts.backAction && !opts.isMainMenu) {
            const backBtn = document.createElement('button');
            backBtn.className = 'pn-back-btn';
            backBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
            backBtn.title = lt('Back');
            backBtn.onclick = () => { overlay.remove(); opts.backAction(); };
            header.appendChild(backBtn);
        }

        const titleSpan = document.createElement('h2');
        titleSpan.className = 'pn-modal-title';
        const iconSpan = document.createElement('span');
        iconSpan.className = 'pn-modal-title-icon';
        loadIconIntoButton(iconSpan, 24);
        titleSpan.appendChild(iconSpan);
        titleSpan.appendChild(document.createTextNode(' ' + titleText));
        header.appendChild(titleSpan);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'pn-modal-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => { overlay.remove(); if (onClose) onClose(); };
        header.appendChild(closeBtn);

        const body = document.createElement('div');
        body.className = 'pn-modal-body';
        // Bold, centered text for general content (cards and lists will override)
        body.style.fontWeight = '600';
        body.style.textAlign = 'center';

        modal.appendChild(header);
        modal.appendChild(body);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        contentCallback(body, overlay);
        return overlay;
    }

    // ========================== Remove via Project Nova (any App ID) ==========================
    function showRemoveByAppIdPopup(backFn) {
        createModal(lt('Remove via Project Nova'), (body, overlay) => {
            body.innerHTML = `
                <div class="pn-info-box">${lt('Enter the Steam App ID of the game you want to remove from Project Nova.')}</div>
                <div class="pn-settings-option">
                    <div class="pn-settings-option-label">${lt('Steam App ID')}</div>
                    <input type="text" id="remove-appid" class="pn-input" placeholder="e.g. 730" style="width:100%;" inputmode="numeric" pattern="\\d*">
                </div>
                <button id="confirm-remove" class="pn-btn-accent" style="width:100%; margin-top:10px;">${lt('Remove')}</button>
            `;
            const input = body.querySelector('#remove-appid');
            const removeBtn = body.querySelector('#confirm-remove');

            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
            });

            removeBtn.onclick = () => {
                const appid = parseInt(input.value.trim(), 10);
                if (isNaN(appid)) {
                    ShowProjectNovaAlert(lt('Error'), lt('Please enter a valid numeric App ID.'), overlay);
                    return;
                }
                Millennium.callServerMethod('projectnova', 'HasProjectNovaForApp', { appid, contentScriptQuery: '' })
                    .then(res => {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (p?.success && p.exists) {
                            Millennium.callServerMethod('projectnova', 'DeleteProjectNovaForApp', { appid, contentScriptQuery: '' })
                                .then(() => {
                                    window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
                                    addProjectNovaButton();
                                    ShowProjectNovaAlert(lt('Success'), lt('Project Nova removed for this app.'), overlay);
                                    overlay.remove();
                                    if (backFn) backFn();
                                })
                                .catch(() => ShowProjectNovaAlert(lt('Error'), lt('Failed to remove Project Nova.'), overlay));
                        } else {
                            ShowProjectNovaAlert(lt('Not Added'), lt('This game has not been added via Project Nova yet.'), overlay);
                        }
                    })
                    .catch(() => ShowProjectNovaAlert(lt('Error'), lt('Could not verify game status.'), overlay));
            };
        }, null, { backAction: backFn });
    }

    // ========================== Integrated Manifest Updater ==========================
    function showManifestUpdaterModal(backFn) {
        let morrenusKeyFromSettings = '';
        let manifesthubKeyFromSettings = '';
        fetchSettingsConfig(false).then(cfg => {
            morrenusKeyFromSettings = cfg.values?.general?.morrenusApiKey || '';
            manifesthubKeyFromSettings = cfg.values?.general?.manifesthubApiKey || '';
        }).catch(() => {});

        createModal(lt('Manifest Updater'), (body, overlay) => {
            body.innerHTML = `
                <div class="pn-info-box">${lt('Update Steam depot manifests to update the game and fix issues like "No Internet Connection" errors.')}</div>
                <div class="pn-settings-option">
                    <div class="pn-settings-option-label">${lt('Steam App ID')}</div>
                    <input type="text" id="manifest-appid" class="pn-input" placeholder="e.g. 730" style="width:100%;" inputmode="numeric" pattern="\\d*">
                </div>
                <div class="pn-settings-option">
                    <div class="pn-settings-option-label">${lt('Download Mode')}</div>
                    <select id="manifest-mode" class="pn-select">
                        <option value="github">GitHub Mirror (No API key)</option>
                        <option value="github+morrenus">GitHub + Morrenus (API key required)</option>
                        <option value="github+manifesthub">GitHub + ManifestHub (API key required)</option>
                    </select>
                </div>
                <div id="api-key-hint" class="pn-info-box" style="display:none; margin-top:10px;">
                    ${lt('API key needed. You can add it in')} <a href="#" class="pn-link" id="settings-link">${lt('Settings → General')}</a>. 
                    ${lt('Get a key from:')} <a href="#" class="pn-link" id="morrenus-link">manifest.morrenus.xyz</a> ${lt('or')} <a href="#" class="pn-link" id="manifesthub-link">manifesthub1.filegear-sg.me</a>.
                </div>
                <button id="start-manifest-update" class="pn-btn-accent" style="width:100%; margin-top:10px;">${lt('Start Update')}</button>
                <div id="manifest-progress" style="margin-top:20px; display:none;">
                    <div class="pn-progress-track"><div id="manifest-progress-bar" class="pn-progress-fill" style="width:0%"></div></div>
                    <pre id="manifest-output" style="background:rgba(0,0,0,0.5); padding:10px; border-radius:8px; overflow:auto; max-height:300px; font-size:12px; margin-top:10px; text-align:left;"></pre>
                </div>
            `;

            const appidInput = body.querySelector('#manifest-appid');
            const modeSelect = body.querySelector('#manifest-mode');
            const apiHint = body.querySelector('#api-key-hint');
            const startBtn = body.querySelector('#start-manifest-update');
            const progressDiv = body.querySelector('#manifest-progress');
            const outputPre = body.querySelector('#manifest-output');
            const progressBar = body.querySelector('#manifest-progress-bar');

            appidInput.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
            });

            function updateHint() {
                const mode = modeSelect.value;
                if (mode === 'github+morrenus' || mode === 'github+manifesthub') {
                    apiHint.style.display = 'block';
                } else {
                    apiHint.style.display = 'none';
                }
            }
            modeSelect.addEventListener('change', updateHint);
            updateHint();

            body.querySelector('#settings-link')?.addEventListener('click', (e) => {
                e.preventDefault();
                overlay.remove();
                showSettingsManagerPopup(() => showManifestUpdaterModal(backFn));
            });
            body.querySelector('#morrenus-link')?.addEventListener('click', (e) => {
                e.preventDefault();
                openUrl('https://manifest.morrenus.xyz/');
            });
            body.querySelector('#manifesthub-link')?.addEventListener('click', (e) => {
                e.preventDefault();
                openUrl('https://manifesthub1.filegear-sg.me/');
            });

            let pollInterval = null;
            startBtn.onclick = () => {
                const appid = appidInput.value.trim();
                if (!appid || !/^\d+$/.test(appid)) {
                    ShowProjectNovaAlert(lt('Error'), lt('Please enter a valid numeric App ID.'), overlay);
                    return;
                }
                const mode = modeSelect.value;
                let morrenusKey = '';
                let manifesthubKey = '';
                fetchSettingsConfig(false).then(cfg => {
                    morrenusKey = cfg.values?.general?.morrenusApiKey || '';
                    manifesthubKey = cfg.values?.general?.manifesthubApiKey || '';
                    if ((mode === 'github+morrenus' && !morrenusKey) || (mode === 'github+manifesthub' && !manifesthubKey)) {
                        ShowProjectNovaAlert(lt('API Key Required'), lt('Please add the required API key in Settings → General first.'), overlay);
                        return;
                    }
                    startBtn.disabled = true;
                    startBtn.textContent = lt('Updating...');
                    progressDiv.style.display = 'block';
                    outputPre.textContent = '';

                    Millennium.callServerMethod('projectnova', 'run_manifest_updater_interactive', {
                        appid: appid,
                        mode: mode,
                        morrenusKey: morrenusKey,
                        manifesthubKey: manifesthubKey
                    }).then(res => {
                        let p;
                        try {
                            p = typeof res === 'string' ? JSON.parse(res) : res;
                        } catch(e) {
                            outputPre.textContent = 'Error parsing response: ' + e.message;
                            startBtn.disabled = false;
                            startBtn.textContent = lt('Start Update');
                            return;
                        }
                        if (!p || !p.success) {
                            outputPre.textContent = 'Error: ' + (p?.error || 'Unknown error');
                            startBtn.disabled = false;
                            startBtn.textContent = lt('Start Update');
                            return;
                        }
                        if (pollInterval) clearInterval(pollInterval);
                        pollInterval = setInterval(() => {
                            Millennium.callServerMethod('projectnova', 'get_manifest_updater_status', {})
                                .then(statusRes => {
                                    let st;
                                    try {
                                        st = typeof statusRes === 'string' ? JSON.parse(statusRes) : statusRes;
                                    } catch(e) {
                                        outputPre.textContent += '\nError parsing status response';
                                        return;
                                    }
                                    if (st && st.success) {
                                        outputPre.textContent = st.output || 'No output yet...';
                                        if (st.status === 'running') {
                                            progressBar.style.width = '50%';
                                            setTimeout(() => { progressBar.style.width = '75%'; }, 500);
                                        } else if (st.status === 'done') {
                                            clearInterval(pollInterval);
                                            progressBar.style.width = '100%';
                                            startBtn.disabled = false;
                                            startBtn.textContent = lt('Done');
                                            ShowProjectNovaAlert(lt('Success'), lt('Manifests updated successfully.'), overlay);
                                        } else if (st.status === 'error') {
                                            clearInterval(pollInterval);
                                            progressBar.style.width = '0%';
                                            startBtn.disabled = false;
                                            startBtn.textContent = lt('Start Update');
                                            ShowProjectNovaAlert(lt('Error'), st.error || 'Update failed', overlay);
                                        }
                                    } else {
                                        outputPre.textContent += '\nInvalid status response';
                                    }
                                }).catch(err => {
                                    outputPre.textContent += '\nPolling error: ' + err;
                                });
                        }, 1000);
                    }).catch(err => {
                        outputPre.textContent = 'Failed to start updater: ' + err;
                        startBtn.disabled = false;
                        startBtn.textContent = lt('Start Update');
                    });
                });
            };

            const originalRemove = overlay.remove.bind(overlay);
            overlay.remove = function() {
                if (pollInterval) clearInterval(pollInterval);
                originalRemove();
            };
        }, null, { backAction: backFn });
    }

    // ========================== Add Game by App ID ==========================
    function showAddByAppIdPopup(backFn) {
        createModal(t('menu.addByAppId', 'Add a Game via Project Nova'), (body, overlay) => {
            body.innerHTML = '';
            const infoBox = document.createElement('div');
            infoBox.className = 'pn-info-box';
            infoBox.textContent = lt('Enter the Steam App ID of the game you want to add via Project Nova. You can get the App ID from steamdb.info');
            body.appendChild(infoBox);

            const label = document.createElement('div');
            label.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:8px;color:' + NOVA.textSecondary + ';';
            label.textContent = lt('Steam App ID');
            body.appendChild(label);

            const row = document.createElement('div');
            row.className = 'pn-appid-row';
            const input = document.createElement('input');
            input.className = 'pn-input';
            input.type = 'text';
            input.inputMode = 'numeric';
            input.pattern = '\\d*';
            input.placeholder = 'e.g. 10';
            input.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
            });
            const lookupBtn = document.createElement('button');
            lookupBtn.className = 'pn-btn-accent';
            lookupBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>&nbsp;' + lt('Look Up');
            row.appendChild(input);
            row.appendChild(lookupBtn);
            body.appendChild(row);

            const gamePreview = document.createElement('div');
            gamePreview.style.cssText = 'margin-top:18px;display:none;';
            body.appendChild(gamePreview);
            const actionArea = document.createElement('div');
            actionArea.style.cssText = 'margin-top:16px;display:none;';
            body.appendChild(actionArea);

            let resolvedAppid = NaN;
            lookupBtn.onclick = () => {
                const val = parseInt(input.value.trim(), 10);
                if (isNaN(val) || val < 1) { input.style.borderColor = '#ff5050'; return; }
                input.style.borderColor = NOVA.border;
                resolvedAppid = val;
                lookupBtn.disabled = true;
                lookupBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>&nbsp;' + lt('Looking up...');
                gamePreview.style.display = 'none';
                actionArea.style.display = 'none';
                fetchSteamGameName(val).then(name => {
                    lookupBtn.disabled = false;
                    lookupBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i>&nbsp;' + lt('Look Up');
                    if (name) {
                        gamePreview.style.display = 'block';
                        gamePreview.innerHTML = `<div style="display:flex;align-items:center;gap:14px;padding:14px 18px;background:rgba(168,85,247,0.1);border:1px solid ${NOVA.border};border-radius:14px;">
                            <img src="${fetchGameIconUrl(val)}" style="width:60px;height:45px;border-radius:8px;object-fit:cover;" onerror="this.style.display='none'">
                            <div><div style="font-weight:700;font-size:15px;">${name}</div><div style="font-size:12px;color:${NOVA.textSecondary};">App ID: ${val}</div></div>
                        </div>`;
                        actionArea.style.display = 'block';
                        actionArea.innerHTML = '';
                        const addBtn = document.createElement('button');
                        addBtn.className = 'pn-btn-accent';
                        addBtn.style.cssText += 'width:100%;';
                        addBtn.innerHTML = '<i class="fa-solid fa-rocket"></i>&nbsp;' + lt('Add via Project Nova');
                        addBtn.onclick = () => {
                            if (runState.inProgress) return;
                            overlay.remove();
                            fetchGamesDatabase().then(db => {
                                const gameData = db?.[String(val)];
                                const doAdd = () => {
                                    showDownloadPopupForAppId(val);
                                    runState.inProgress = true;
                                    runState.appid = val;
                                    runState.cancelRequested = false;
                                    Millennium.callServerMethod('projectnova', 'StartAddViaProjectNova', { appid: val, contentScriptQuery: '' });
                                };
                                if (gameData?.playable === 0) {
                                    createModal(t('common.warning', 'Warning'), (wBody, wOverlay) => {
                                        wBody.innerHTML = `<p class="pn-info-box">${lt('This game may not work. Support won\'t be given in our Discord.')}</p>`;
                                        const btnRow = document.createElement('div');
                                        btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;margin-top:12px;';
                                        const proceedBtn = document.createElement('button');
                                        proceedBtn.className = 'pn-btn-accent';
                                        proceedBtn.textContent = lt('Proceed');
                                        const cancelBtn = document.createElement('button');
                                        cancelBtn.className = 'pn-btn-ghost';
                                        cancelBtn.textContent = lt('Cancel');
                                        proceedBtn.onclick = () => { wOverlay.remove(); doAdd(); };
                                        cancelBtn.onclick = () => wOverlay.remove();
                                        btnRow.appendChild(cancelBtn);
                                        btnRow.appendChild(proceedBtn);
                                        wBody.appendChild(btnRow);
                                    }, null, { backAction: () => showAddByAppIdPopup(backFn) });
                                } else doAdd();
                            });
                        };
                        actionArea.appendChild(addBtn);
                    } else {
                        gamePreview.style.display = 'block';
                        gamePreview.innerHTML = `<div class="pn-warn-box"><i class="fa-solid fa-triangle-exclamation"></i>&nbsp; ${lt('No game found for App ID')} <strong>${val}</strong>.</div>`;
                    }
                });
            };
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') lookupBtn.click(); });
            setTimeout(() => input.focus(), 50);
        }, null, { backAction: backFn });
    }

    function showDownloadPopupForAppId(appid) {
        createModal(t('common.appName', 'Project Nova'), (body, overlay) => {
            const apiList = document.createElement('div');
            apiList.style.cssText = 'margin-bottom:16px;max-height:180px;overflow-y:auto;';
            apiList.innerHTML = '<div>' + lt('Loading APIs...') + '</div>';
            body.appendChild(apiList);

            const statusRow = document.createElement('div');
            statusRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';
            const statusMsg = document.createElement('div');
            statusMsg.style.cssText = 'font-size:14px;font-weight:500;color:' + NOVA.textSecondary + ';';
            statusMsg.textContent = lt('Checking availability…');
            const sizeMsg = document.createElement('div');
            sizeMsg.style.cssText = 'font-size:11px;color:#a0a0c0;margin-left:auto;';
            statusRow.appendChild(statusMsg);
            statusRow.appendChild(sizeMsg);
            body.appendChild(statusRow);

            const progressWrap = document.createElement('div');
            progressWrap.className = 'pn-progress-track';
            progressWrap.style.display = 'none';
            const progressBar = document.createElement('div');
            progressBar.className = 'pn-progress-fill';
            progressBar.style.width = '0%';
            progressWrap.appendChild(progressBar);
            body.appendChild(progressWrap);

            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:10px;margin-top:20px;';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'pn-btn-ghost';
            cancelBtn.textContent = lt('Cancel');
            cancelBtn.style.display = 'none';
            cancelBtn.onclick = () => {
                runState.cancelRequested = true;
                if (!isNaN(appid) && typeof Millennium !== 'undefined') {
                    Millennium.callServerMethod('projectnova', 'CancelAddViaProjectNova', { appid, contentScriptQuery: '' });
                }
                clearInterval(pollInterval);
                overlay.remove();
                runState.inProgress = false;
            };
            const hideBtn = document.createElement('button');
            hideBtn.className = 'pn-btn-ghost';
            hideBtn.textContent = lt('Hide');
            hideBtn.onclick = () => overlay.remove();
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(hideBtn);
            body.appendChild(btnRow);

            Millennium.callServerMethod('projectnova', 'GetApiList', { contentScriptQuery: '' })
                .then(res => {
                    const p = typeof res === 'string' ? JSON.parse(res) : res;
                    if (p?.success && p.apis) {
                        apiList.innerHTML = '';
                        p.apis.forEach(api => {
                            const item = document.createElement('div');
                            item.style.cssText = 'display:flex;justify-content:space-between;padding:8px 4px;border-bottom:1px solid rgba(255,255,255,0.06);font-size:13px;';
                            item.innerHTML = `<span>${api.name}</span><span class="api-status" style="color:${NOVA.textSecondary};">${lt('Waiting…')}</span>`;
                            apiList.appendChild(item);
                        });
                    }
                });

            let lastCheckedApi = null;
            const pollInterval = setInterval(() => {
                if (runState.cancelRequested) { clearInterval(pollInterval); return; }
                Millennium.callServerMethod('projectnova', 'GetAddViaProjectNovaStatus', { appid, contentScriptQuery: '' })
                    .then(res => {
                        if (runState.cancelRequested) { clearInterval(pollInterval); return; }
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        const st = p?.state || {};
                        if (st.status === 'checking' && st.currentApi && st.currentApi !== lastCheckedApi) {
                            lastCheckedApi = st.currentApi;
                            const items = apiList.querySelectorAll('div');
                            items.forEach(item => {
                                if (item.children[0]?.textContent === st.currentApi)
                                    item.querySelector('.api-status').innerHTML = `${lt('Checking…')} <i class="fa-solid fa-spinner fa-spin"></i>`;
                            });
                        }
                        if (st.status === 'downloading') {
                            progressWrap.style.display = 'block';
                            cancelBtn.style.display = 'inline-block';
                            const total = st.totalBytes || 0;
                            const read = st.bytesRead || 0;
                            const pct = total > 0 ? Math.floor((read / total) * 100) : 0;
                            progressBar.style.width = pct + '%';
                            statusMsg.textContent = lt('Downloading: {percent}%').replace('{percent}', pct);
                            if (total > 0) sizeMsg.textContent = `${formatBytes(read)} / ${formatBytes(total)}`;
                        }
                        if (st.status === 'done') {
                            clearInterval(pollInterval);
                            statusMsg.innerHTML = '<i class="fa-solid fa-check-circle" style="color:#5cb85c;"></i>&nbsp;' + lt('Game added!');
                            cancelBtn.style.display = 'none';
                            hideBtn.textContent = lt('Close');
                            runState.inProgress = false;
                            setTimeout(() => overlay.remove(), 2000);
                        }
                        if (st.status === 'failed') {
                            clearInterval(pollInterval);
                            statusMsg.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#ff5050;"></i>&nbsp;' + lt('Failed: {error}').replace('{error}', st.error || lt('Unknown error'));
                            cancelBtn.style.display = 'none';
                            hideBtn.textContent = lt('Close');
                            runState.inProgress = false;
                        }
                    });
            }, 500);
        }, null, { backAction: () => showSettingsPopup() });
    }

    // ========================== Main Menu ==========================
    function showSettingsPopup() {
        if (document.querySelector('.pn-overlay')) return;
        ensureTranslationsLoaded(false).then(() => {
            ensureNovaTheme();
            ensureFontAwesome();
            createModal(t('menu.title', 'Menu'), (body, overlay) => {
                body.style.textAlign = 'left';
                const searchWrap = document.createElement('div');
                searchWrap.className = 'pn-search-wrap';
                const searchIcon = document.createElement('i');
                searchIcon.className = 'fa-solid fa-magnifying-glass pn-search-icon';
                const searchInput = document.createElement('input');
                searchInput.className = 'pn-search';
                searchInput.placeholder = lt('Search menu…');
                searchInput.type = 'text';
                searchWrap.appendChild(searchIcon);
                searchWrap.appendChild(searchInput);
                body.appendChild(searchWrap);

                let currentAppid = NaN;
                try {
                    const match = window.location.href.match(/https:\/\/store\.steampowered\.com\/app\/(\d+)/) || window.location.href.match(/https:\/\/steamcommunity\.com\/app\/(\d+)/);
                    if (match) currentAppid = parseInt(match[1], 10);
                } catch(_) {}
                const onAppPage = !isNaN(currentAppid);

                function createCard(icon, label, desc, onClick, hidden) {
                    const card = document.createElement('div');
                    card.className = 'pn-card' + (hidden ? ' hidden' : '');
                    card.dataset.label = label.toLowerCase();
                    card.dataset.desc = desc.toLowerCase();
                    card.innerHTML = `
                        <div class="pn-card-icon"><i class="fa-solid ${icon}"></i></div>
                        <div class="pn-card-text">
                            <div class="pn-card-label">${label}</div>
                            <div class="pn-card-desc">${desc}</div>
                        </div>
                        <div class="pn-card-arrow"><i class="fa-solid fa-chevron-right"></i></div>
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

                // Single Fixes Menu button (works anywhere)
                body.appendChild(createSection(lt('Game')));
                const fixesCard = createCard('fa-wrench', t('menu.fixesMenu', 'Fixes Menu'), t('menu.fixesMenuDesc', 'Apply or manage fixes for a game'), () => {
                    if (onAppPage && !isNaN(currentAppid)) {
                        Millennium.callServerMethod('projectnova', 'GetGameInstallPath', { appid: currentAppid, contentScriptQuery: '' })
                            .then(pathRes => {
                                let isGameInstalled = false;
                                const pathPayload = typeof pathRes === 'string' ? JSON.parse(pathRes) : pathRes;
                                if (pathPayload?.success && pathPayload.installPath) {
                                    isGameInstalled = true;
                                    window.__PROJECTNOVA_GAME_INSTALL_PATH__ = pathPayload.installPath;
                                }
                                window.__PROJECTNOVA_GAME_IS_INSTALLED__ = isGameInstalled;
                                showFixesLoadingPopupAndCheck(currentAppid, () => showSettingsPopup());
                            })
                            .catch(() => ShowProjectNovaAlert('Project Nova', t('menu.error.getPath', 'Error getting game path'), null));
                    } else {
                        createModal(lt('Enter App ID'), (innerBody, innerOverlay) => {
                            innerBody.innerHTML = `
                                <div class="pn-info-box">${lt('Enter the Steam App ID of the game you want to check fixes for. You can get the App ID from steamdb.info')}</div>
                                <input type="text" id="fixes-appid-input" class="pn-input" placeholder="e.g. 730" style="width:100%; margin-bottom:10px;" inputmode="numeric" pattern="\\d*">
                                <button id="check-fixes-btn" class="pn-btn-accent" style="width:100%;">${lt('Check Fixes')}</button>
                            `;
                            const input = innerBody.querySelector('#fixes-appid-input');
                            const checkBtn = innerBody.querySelector('#check-fixes-btn');
                            input.addEventListener('keydown', (e) => {
                                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
                            });
                            checkBtn.onclick = () => {
                                const appid = parseInt(input.value.trim(), 10);
                                if (isNaN(appid)) {
                                    ShowProjectNovaAlert(lt('Error'), lt('Please enter a valid numeric App ID.'), innerOverlay);
                                    return;
                                }
                                innerOverlay.remove();
                                Millennium.callServerMethod('projectnova', 'GetGameInstallPath', { appid, contentScriptQuery: '' })
                                    .then(pathRes => {
                                        let isGameInstalled = false;
                                        const pathPayload = typeof pathRes === 'string' ? JSON.parse(pathRes) : pathRes;
                                        if (pathPayload?.success && pathPayload.installPath) {
                                            isGameInstalled = true;
                                            window.__PROJECTNOVA_GAME_INSTALL_PATH__ = pathPayload.installPath;
                                        }
                                        window.__PROJECTNOVA_GAME_IS_INSTALLED__ = isGameInstalled;
                                        showFixesLoadingPopupAndCheck(appid, () => showSettingsPopup());
                                    })
                                    .catch(() => ShowProjectNovaAlert('Project Nova', t('menu.error.getPath', 'Error getting game path'), null));
                            };
                        }, null, { backAction: () => showSettingsPopup() });
                    }
                });
                body.appendChild(fixesCard);

                // Remove via Project Nova (works for any App ID)
                const removeAnyCard = createCard('fa-trash-can', lt('Remove via Project Nova'), lt('Remove Project Nova files for a game'), () => {
                    overlay.remove();
                    showRemoveByAppIdPopup(() => showSettingsPopup());
                });
                body.appendChild(removeAnyCard);

                // Tools
                body.appendChild(createSection(lt('Tools')));
                body.appendChild(createCard('fa-hashtag', t('menu.addByAppId', 'Add a Game via Project Nova'), t('menu.addByAppIdDesc', 'Add any game using its Steam App ID'), () => showAddByAppIdPopup(() => showSettingsPopup())));
                body.appendChild(createCard('fa-list', t('Installed Games', 'Installed Games'), t('Installed Games Desc', 'View games added via Project Nova'), () => showInstalledGamesPopup(() => showSettingsPopup())));
                body.appendChild(createCard('fa-server', t('menu.fetchFreeApis', 'Fetch APIs'), t('menu.fetchFreeApisDesc', 'Update and refresh the API list'), () => {
                    Millennium.callServerMethod('projectnova', 'FetchFreeApisNow', { contentScriptQuery: '' })
                        .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; ShowProjectNovaAlert('Project Nova', p?.success ? t('Loaded free APIs: {count}').replace('{count}', p.count || '?') : t('Failed to load free APIs.'), null); });
                }));
                body.appendChild(createCard('fa-download', lt('Manifest Updater'), lt('Update Steam depot manifests'), () => showManifestUpdaterModal(() => showSettingsPopup())));

                // Settings & Info
                body.appendChild(createSection(lt('Settings')));
                body.appendChild(createCard('fa-gear', t('menu.settings', 'Settings'), t('menu.settingsDesc', 'Configure Project Nova options'), () => showSettingsManagerPopup(() => showSettingsPopup())));
                body.appendChild(createSection(lt('Info')));
                body.appendChild(createCard('fa-circle-question', t('FAQ', 'FAQ'), t('FAQ Desc', 'Frequently Asked Questions'), () => showFAQModal(() => showSettingsPopup())));

                // System
                body.appendChild(createSection(lt('System')));
                const restartCard = createCard('fa-power-off', t('Restart Steam', 'Restart Steam'), t('Restart Steam Desc', 'Restart Steam to apply changes'), () => {
                    showProjectNovaConfirm('Project Nova', t('Restart Steam now?'), () => Millennium.callServerMethod('projectnova', 'RestartSteam', { contentScriptQuery: '' }), () => {});
                });
                body.appendChild(restartCard);

                searchInput.addEventListener('input', () => {
                    const q = searchInput.value.trim().toLowerCase();
                    const sections = body.querySelectorAll('.pn-section-label');
                    sections.forEach(sec => {
                        let el = sec.nextSibling;
                        let hasVisible = false;
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
            }, null, { isMainMenu: true, backAction: null });
        });
    }

    // ========================== Installed Games Popup ==========================
    function showInstalledGamesPopup(backFn) {
        ensureTranslationsLoaded(false).then(() => {
            createModal(t('Installed Games', 'Games via Project Nova'), (body, overlay) => {
                body.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;"></i><br><br>${lt('Loading...')}</div>`;
                Millennium.callServerMethod('projectnova', 'GetInstalledLuaScripts', { contentScriptQuery: '' })
                    .then(res => {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (!p?.success || !p.scripts?.length) {
                            body.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fa-solid fa-inbox" style="font-size:32px;opacity:0.4;"></i><br><br>${lt('No games added yet.')}</div>`;
                            return;
                        }
                        body.innerHTML = '';
                        body.style.textAlign = 'left';
                        const searchWrap = document.createElement('div');
                        searchWrap.className = 'pn-search-wrap';
                        const searchIcon = document.createElement('i');
                        searchIcon.className = 'fa-solid fa-magnifying-glass pn-search-icon';
                        const searchInput = document.createElement('input');
                        searchInput.className = 'pn-search';
                        searchInput.placeholder = lt('Search games…');
                        searchInput.type = 'text';
                        searchWrap.appendChild(searchIcon);
                        searchWrap.appendChild(searchInput);
                        body.appendChild(searchWrap);

                        const list = document.createElement('div');
                        const gameItems = [];
                        p.scripts.forEach(script => {
                            const item = document.createElement('div');
                            item.className = 'pn-game-item';
                            item.dataset.name = (script.gameName || '').toLowerCase();
                            const iconUrl = fetchGameIconUrl(script.appid);
                            const disabledBadge = script.isDisabled ? `<span style="background:rgba(255,80,80,0.15);color:#ff5050;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;margin-left:8px;">DISABLED</span>` : '';
                            const info = document.createElement('div');
                            info.style.display = 'flex';
                            info.style.alignItems = 'center';
                            info.style.gap = '12px';
                            info.innerHTML = `
                                <img src="${iconUrl}" style="width:40px;height:30px;border-radius:6px;object-fit:cover;" onerror="this.style.display='none'">
                                <div>
                                    <div class="pn-game-item-name">${script.gameName || lt('Unknown Game')}</div>
                                    <div class="pn-game-item-appid">App ID: ${script.appid} ${disabledBadge}</div>
                                </div>
                            `;
                            const removeBtn = document.createElement('button');
                            removeBtn.className = 'pn-btn-ghost';
                            removeBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>&nbsp;' + lt('Remove');
                            removeBtn.style.fontSize = '12px';
                            removeBtn.onclick = () => {
                                showProjectNovaConfirm('Project Nova', t('settings.installedLua.deleteConfirm', 'Remove via Project Nova for this game?'), () => {
                                    Millennium.callServerMethod('projectnova', 'DeleteProjectNovaForApp', { appid: script.appid, contentScriptQuery: '' })
                                        .then(() => { ShowProjectNovaAlert('Project Nova', t('menu.remove.success', 'Project Nova removed for this app.'), null); showInstalledGamesPopup(backFn); })
                                        .catch(() => ShowProjectNovaAlert('Project Nova', t('menu.remove.failure', 'Failed to remove Project Nova.'), null));
                                }, () => {});
                            };
                            item.appendChild(info);
                            item.appendChild(removeBtn);
                            list.appendChild(item);
                            gameItems.push(item);
                        });
                        body.appendChild(list);

                        searchInput.addEventListener('input', () => {
                            const q = searchInput.value.trim().toLowerCase();
                            gameItems.forEach(item => {
                                item.style.display = (!q || item.dataset.name.includes(q)) ? '' : 'none';
                            });
                        });
                        setTimeout(() => searchInput.focus(), 60);
                    })
                    .catch(() => { body.innerHTML = `<div style="text-align:center;color:#ff5050;padding:40px;">${lt('Failed to load installed games.')}</div>`; });
            }, null, { backAction: backFn });
        });
    }

    // ========================== FAQ Modal (full version) ==========================
    function showFAQModal(backFn) {
        createModal(t('FAQ', 'Frequently Asked Questions'), (body) => {
            body.style.textAlign = 'left';
            const faqs = [
                {
                    q: lt('Is multiplayer functionality supported?'),
                    p: [
                        lt('In most cases, additional files are required for multiplayer to function properly. You can only play with others who are using the SteamTools version of the game with the same fix applied.'),
                        lt('These files can typically be found in the Fixes Menu in the Project Nova menu, or on sites such as:'),
                    ],
                    links: [{ text: 'online-fix.me', url: 'https://online-fix.me' }]
                },
                {
                    q: lt('Are DLCs included with the game?'),
                    p: [lt('Most supported games include all available DLCs by default.')]
                },
                {
                    q: lt('Why does my antivirus flag SteamTools as a potential threat?'),
                    p: [
                        lt('SteamTools is a closed-source application, meaning its internal code cannot be fully verified. Some of its features may trigger antivirus warnings. Additionally, due to its origin, there may be potential privacy risks, including the possibility of spyware.'),
                        lt('If you choose to proceed, you may need to temporarily disable your antivirus software. Only do this if you fully understand and accept the risks.')
                    ]
                },
                {
                    q: lt('What should I do if the game is not working?'),
                    p: [lt('You can use Fixes Menu to fix common issues, Or you can try searching for your issue online, as most problems already have available solutions. You can also check for fixes at:')],
                    links: [{ text: 'generator.ryuu.lol/fixes', url: 'https://generator.ryuu.lol/fixes' }]
                },
                {
                    q: lt('Why won\'t my game run if it uses Denuvo or other protections?'),
                    p: [lt('Compatibility is being actively improved. Future updates may include features to better handle protections like Denuvo.')]
                }
            ];
            faqs.forEach(faq => {
                const item = document.createElement('div');
                item.className = 'pn-faq-item';
                const h3 = document.createElement('h3');
                h3.textContent = faq.q;
                item.appendChild(h3);
                faq.p.forEach(text => {
                    const p = document.createElement('p');
                    p.textContent = text;
                    item.appendChild(p);
                });
                if (faq.links?.length) {
                    faq.links.forEach(({ text, url }) => {
                        const p = document.createElement('p');
                        const a = document.createElement('a');
                        a.className = 'pn-link';
                        a.textContent = text;
                        a.href = '#';
                        a.onclick = (e) => { e.preventDefault(); openUrl(url); };
                        p.appendChild(a);
                        item.appendChild(p);
                    });
                }
                body.appendChild(item);
            });
            const thanks = document.createElement('div');
            thanks.style.cssText = 'text-align:center;margin-top:24px;padding:16px;font-size:14px;color:' + NOVA.textSecondary + ';';
            thanks.innerHTML = lt('Thank you for using Project Nova') + ' ❤️';
            body.appendChild(thanks);
        }, null, { backAction: backFn });
    }

    // ========================== Settings Manager (with ManifestHub API Key) ==========================
    function showSettingsManagerPopup(backFn) {
        ensureTranslationsLoaded(false).then(() => {
            createModal(t('settings.title', 'Settings'), (body, overlay) => {
                body.innerHTML = `<div style="text-align:center;padding:40px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;"></i></div>`;
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
                            if (!Object.keys(changes).length) return;
                            Millennium.callServerMethod('projectnova', 'ApplySettingsChanges', { changesJson: JSON.stringify(changes), contentScriptQuery: '' })
                                .then(res => {
                                    const p = typeof res === 'string' ? JSON.parse(res) : res;
                                    if (p?.success) {
                                        for (const gk of Object.keys(changes)) {
                                            if (!config.values[gk]) config.values[gk] = {};
                                            Object.assign(config.values[gk], changes[gk]);
                                        }
                                        if (changes.general?.language) {
                                            ensureTranslationsLoaded(true, changes.general.language).then(() => {
                                                updateButtonTranslations();
                                                overlay.remove();
                                                showSettingsManagerPopup(backFn);
                                            });
                                        }
                                    }
                                });
                        }, 500);
                    }

                    for (const group of schema) {
                        if (!group.options?.length) continue;
                        if (!values[group.key]) values[group.key] = {};
                        const groupDiv = document.createElement('div');
                        groupDiv.className = 'pn-settings-group';
                        const groupTitle = document.createElement('h3');
                        groupTitle.className = 'pn-settings-group-title';
                        groupTitle.textContent = t(`settings.${group.key}`, group.label || group.key);
                        groupDiv.appendChild(groupTitle);

                        for (const opt of group.options) {
                            // Skip hidden options (useSteamLanguage, language, theme)
                            if (opt.key === 'useSteamLanguage' || opt.key === 'language' || opt.key === 'theme') {
                                continue;
                            }
                            const optDiv = document.createElement('div');
                            optDiv.className = 'pn-settings-option';
                            optDiv.dataset.optKey = opt.key;
                            const label = document.createElement('div');
                            label.className = 'pn-settings-option-label';
                            label.textContent = t(`settings.${group.key}.${opt.key}.label`, opt.label);
                            const desc = document.createElement('div');
                            desc.className = 'pn-settings-option-desc';
                            desc.textContent = t(`settings.${group.key}.${opt.key}.description`, opt.description || '');
                            optDiv.appendChild(label);
                            optDiv.appendChild(desc);

                            const currentVal = (values[group.key][opt.key] !== undefined) ? values[group.key][opt.key] : opt.default;
                            let control;
                            if (opt.type === 'toggle') {
                                const toggleWrap = document.createElement('div');
                                toggleWrap.style.cssText = 'display:flex;gap:8px;';
                                const yesBtn = document.createElement('button');
                                yesBtn.className = 'pn-toggle-btn';
                                yesBtn.textContent = opt.metadata?.yesLabel || 'Yes';
                                const noBtn = document.createElement('button');
                                noBtn.className = 'pn-toggle-btn';
                                noBtn.textContent = opt.metadata?.noLabel || 'No';
                                const update = () => {
                                    const val = (values[group.key][opt.key] !== undefined) ? values[group.key][opt.key] : opt.default;
                                    yesBtn.classList.toggle('active', val === true);
                                    noBtn.classList.toggle('active', val === false);
                                };
                                yesBtn.onclick = () => { scheduleSave(group.key, opt.key, true); update(); };
                                noBtn.onclick = () => { scheduleSave(group.key, opt.key, false); update(); };
                                toggleWrap.appendChild(yesBtn);
                                toggleWrap.appendChild(noBtn);
                                control = toggleWrap;
                                update();
                            } else if (opt.type === 'select') {
                                const select = document.createElement('select');
                                select.className = 'pn-select';
                                for (const choice of (opt.choices || [])) {
                                    const option = document.createElement('option');
                                    option.value = choice.value;
                                    option.textContent = choice.label;
                                    select.appendChild(option);
                                }
                                select.value = currentVal;
                                select.onchange = () => scheduleSave(group.key, opt.key, select.value);
                                control = select;
                            } else if (opt.type === 'text') {
                                const input = document.createElement('input');
                                input.className = 'pn-input';
                                input.type = 'text';
                                input.placeholder = opt.metadata?.placeholder || '';
                                input.value = currentVal || '';
                                input.oninput = () => scheduleSave(group.key, opt.key, input.value);
                                control = input;
                            } else {
                                control = document.createElement('div');
                                control.textContent = 'Unsupported';
                            }
                            optDiv.appendChild(control);
                            groupDiv.appendChild(optDiv);
                        }

                        // Add custom ManifestHub API Key option if this is the general group
                        if (group.key === 'general') {
                            const mhDiv = document.createElement('div');
                            mhDiv.className = 'pn-settings-option';
                            const mhLabel = document.createElement('div');
                            mhLabel.className = 'pn-settings-option-label';
                            mhLabel.textContent = lt('ManifestHub API Key');
                            const mhDesc = document.createElement('div');
                            mhDesc.className = 'pn-settings-option-desc';
                            mhDesc.innerHTML = lt('API key for ManifestHub. Get one from') + ' <a href="#" class="pn-link" id="manifesthub-get-link">manifesthub1.filegear-sg.me</a>';
                            const mhInput = document.createElement('input');
                            mhInput.className = 'pn-input';
                            mhInput.type = 'text';
                            mhInput.placeholder = 'Enter your ManifestHub API key';
                            mhInput.value = values.general?.manifesthubApiKey || '';
                            mhInput.oninput = () => scheduleSave('general', 'manifesthubApiKey', mhInput.value);
                            mhDiv.appendChild(mhLabel);
                            mhDiv.appendChild(mhDesc);
                            mhDiv.appendChild(mhInput);
                            groupDiv.appendChild(mhDiv);

                            // Make the link clickable
                            mhDiv.querySelector('#manifesthub-get-link')?.addEventListener('click', (e) => {
                                e.preventDefault();
                                openUrl('https://manifesthub1.filegear-sg.me/');
                            });
                        }

                        body.appendChild(groupDiv);
                    }
                    if (!schema.length) body.innerHTML = `<div class="pn-info-box">${lt('No settings available.')}</div>`;
                }).catch(err => { body.innerHTML = `<div style="color:#ff5050;padding:20px;">${lt('Error loading settings:')} ${err.message}</div>`; });
            }, null, { backAction: backFn });
        });
    }

    // ========================== Fixes Popup ==========================
    function showFixesResultsPopup(data, isGameInstalled, backFn) {
        ensureTranslationsLoaded(false).then(() => {
            const bgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${data.appid}/page_bg_generated_v6b.jpg`;
            createModal(t('Project Nova · Fixes Menu', 'Fixes Menu'), (body, overlay) => {
                body.style.textAlign = 'left';
                const gameName = data.gameName || lt('Unknown Game');
                const gameHeader = document.createElement('div');
                gameHeader.style.cssText = 'display:flex;align-items:center;gap:14px;margin-bottom:20px;padding:14px 18px;background:rgba(255,255,255,0.04);border-radius:14px;border:1px solid ' + NOVA.border + ';';
                const gameIcon = document.createElement('img');
                gameIcon.style.cssText = 'width:52px;height:52px;border-radius:12px;object-fit:cover;';
                gameIcon.onerror = () => gameIcon.style.display = 'none';
                gameIcon.src = fetchGameIconUrl(data.appid);
                const titleInfo = document.createElement('div');
                titleInfo.innerHTML = `<div style="font-weight:700;font-size:16px;margin-bottom:2px;">${gameName}</div><div style="font-size:12px;color:${NOVA.textSecondary};">App ID: ${data.appid || '?'}</div>`;
                gameHeader.appendChild(gameIcon);
                gameHeader.appendChild(titleInfo);
                body.appendChild(gameHeader);

                if (!isGameInstalled) {
                    const warn = document.createElement('div');
                    warn.className = 'pn-warn-box';
                    warn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i>&nbsp;' + t('menu.error.notInstalled', 'Game is not installed — some actions may be unavailable.');
                    body.appendChild(warn);
                }

                const columns = document.createElement('div');
                columns.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:16px;';

                function makeFixButton(label, text, icon, isAvailable, onClick) {
                    const wrapper = document.createElement('div');
                    const lbl = document.createElement('div');
                    lbl.style.cssText = 'font-size:11px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:' + NOVA.accent + ';margin-bottom:8px;opacity:0.8;';
                    lbl.textContent = label;
                    const btn = document.createElement('button');
                    btn.className = 'pn-fix-btn';
                    if (!isAvailable) btn.disabled = true;
                    btn.innerHTML = `<i class="fa-solid ${icon}"></i><span>${text}</span>`;
                    if (isAvailable) btn.onclick = onClick;
                    wrapper.appendChild(lbl);
                    wrapper.appendChild(btn);
                    return wrapper;
                }

                const leftCol = document.createElement('div');
                const rightCol = document.createElement('div');

                const genericStatus = data.genericFix.status;
                leftCol.appendChild(makeFixButton(lt('Generic Fix'), genericStatus === 200 ? lt('Apply Generic Fix') : lt('No generic fix'), genericStatus === 200 ? 'fa-check-circle' : 'fa-circle-xmark', genericStatus === 200 && isGameInstalled, () => {
                    if (genericStatus === 200 && isGameInstalled) applyFix(data.appid, `https://files.luatools.work/GameBypasses/${data.appid}.zip`, lt('Generic Fix'), data.gameName, overlay, backFn);
                }));

                const onlineStatus = data.onlineFix.status;
                leftCol.appendChild(makeFixButton(lt('Online Fix'), onlineStatus === 200 ? lt('Apply Online Fix') : lt('No online-fix'), onlineStatus === 200 ? 'fa-check-circle' : 'fa-circle-xmark', onlineStatus === 200 && isGameInstalled, () => {
                    if (onlineStatus === 200 && isGameInstalled) applyFix(data.appid, data.onlineFix.url || `https://files.luatools.work/OnlineFix1/${data.appid}.zip`, lt('Online Fix'), data.gameName, overlay, backFn);
                }));

                rightCol.appendChild(makeFixButton(lt('All-In-One Fixes'), lt('Online Fix (Unsteam)'), 'fa-globe', isGameInstalled, () => {
                    if (isGameInstalled) applyFix(data.appid, 'https://github.com/madoiscool/lt_api_links/releases/download/unsteam/Win64.zip', lt('Online Fix (Unsteam)'), data.gameName, overlay, backFn);
                }));

                rightCol.appendChild(makeFixButton(lt('Manage Game'), lt('Un-Fix (verify game)'), 'fa-rotate', isGameInstalled, () => {
                    if (isGameInstalled) {
                        overlay.remove();
                        showProjectNovaConfirm('Project Nova', lt('Are you sure you want to un-fix? This will remove fix files and verify game files.'), () => startUnfix(data.appid, backFn), () => showFixesResultsPopup(data, isGameInstalled, backFn));
                    }
                }));

                columns.appendChild(leftCol);
                columns.appendChild(rightCol);
                body.appendChild(columns);

                const gameFolderBtn = document.createElement('button');
                gameFolderBtn.className = 'pn-btn-ghost';
                gameFolderBtn.style.cssText += 'width:100%;margin-top:16px;padding:12px;';
                gameFolderBtn.innerHTML = '<i class="fa-solid fa-folder-open"></i>&nbsp;' + lt('Open Game Folder');
                gameFolderBtn.onclick = () => { if (window.__PROJECTNOVA_GAME_INSTALL_PATH__) Millennium.callServerMethod('projectnova', 'OpenGameFolder', { path: window.__PROJECTNOVA_GAME_INSTALL_PATH__, contentScriptQuery: '' }); };
                body.appendChild(gameFolderBtn);

                function startUnfix(appid, back) {
                    Millennium.callServerMethod('projectnova', 'UnFixGame', { appid, installPath: window.__PROJECTNOVA_GAME_INSTALL_PATH__, contentScriptQuery: '' })
                        .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; if (p?.success) showUnfixProgress(appid, back); else ShowProjectNovaAlert('Project Nova', p?.error || lt('Failed to start un-fix'), null); })
                        .catch(() => ShowProjectNovaAlert('Project Nova', lt('Error starting un-fix'), null));
                }
            }, null, { backAction: backFn, bgImage: bgUrl });
        });
    }

    function showFixesLoadingPopupAndCheck(appid, backFn) {
        createModal(lt('Checking fixes…'), (body, overlay) => {
            body.innerHTML = `<div style="text-align:center;padding:20px;"><i class="fa-solid fa-spinner fa-spin" style="font-size:28px;margin-bottom:16px;display:block;"></i>${lt('Checking availability…')}</div>`;
            fetchFixes(appid).then(payload => {
                if (payload?.success) { overlay.remove(); showFixesResultsPopup(payload, window.__PROJECTNOVA_GAME_IS_INSTALLED__ === true, backFn); }
                else { overlay.remove(); ShowProjectNovaAlert('Project Nova', payload?.error || lt('Failed to check for fixes.'), null); }
            }).catch(() => { overlay.remove(); ShowProjectNovaAlert('Project Nova', lt('Error checking for fixes'), null); });
        }, null, { backAction: backFn });
    }

    function applyFix(appid, downloadUrl, fixType, gameName, resultsOverlay, backFn) {
        if (resultsOverlay) resultsOverlay.remove();
        if (!window.__PROJECTNOVA_GAME_INSTALL_PATH__) { ShowProjectNovaAlert('Project Nova', lt('Game install path not found'), null); return; }
        Millennium.callServerMethod('projectnova', 'ApplyGameFix', { appid, downloadUrl, installPath: window.__PROJECTNOVA_GAME_INSTALL_PATH__, fixType, gameName, contentScriptQuery: '' })
            .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; if (p?.success) showFixDownloadProgress(appid, fixType, backFn); else ShowProjectNovaAlert('Project Nova', p?.error || lt('Failed to start fix download'), null); })
            .catch(() => ShowProjectNovaAlert('Project Nova', lt('Error applying fix'), null));
    }

    function showFixDownloadProgress(appid, fixType, backFn) {
        const bgUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/page_bg_generated_v6b.jpg`;
        createModal(lt('Applying {fix}').replace('{fix}', fixType), (body) => {
            const statusMsg = document.createElement('div');
            statusMsg.style.cssText = 'font-size:14px;font-weight:500;margin-bottom:12px;';
            statusMsg.textContent = lt('Downloading...');
            body.appendChild(statusMsg);
            const progressWrap = document.createElement('div');
            progressWrap.className = 'pn-progress-track';
            const progressBar = document.createElement('div');
            progressBar.className = 'pn-progress-fill';
            progressBar.style.width = '0%';
            progressWrap.appendChild(progressBar);
            body.appendChild(progressWrap);
            const interval = setInterval(() => {
                Millennium.callServerMethod('projectnova', 'GetApplyFixStatus', { appid, contentScriptQuery: '' })
                    .then(res => {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (!p?.success) return;
                        const state = p.state || {};
                        if (state.status === 'downloading') {
                            const pct = state.totalBytes > 0 ? Math.floor((state.bytesRead / state.totalBytes) * 100) : 0;
                            progressBar.style.width = pct + '%';
                            statusMsg.textContent = lt('Downloading: {percent}%').replace('{percent}', pct);
                        } else if (state.status === 'done') {
                            progressBar.style.width = '100%';
                            statusMsg.innerHTML = '<i class="fa-solid fa-check-circle" style="color:#5cb85c;"></i>&nbsp;' + lt('{fix} applied successfully!').replace('{fix}', fixType);
                            clearInterval(interval);
                        } else if (state.status === 'failed') {
                            statusMsg.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#ff5050;"></i>&nbsp;' + lt('Failed: {error}').replace('{error}', state.error || lt('Unknown error'));
                            clearInterval(interval);
                        }
                    });
            }, 500);
        }, null, { bgImage: bgUrl });
    }

    function showUnfixProgress(appid, backFn) {
        createModal(lt('Un-Fixing game'), (body) => {
            const msg = document.createElement('div');
            msg.style.cssText = 'font-size:14px;font-weight:500;';
            msg.textContent = lt('Removing fix files...');
            body.appendChild(msg);
            const progressWrap = document.createElement('div');
            progressWrap.className = 'pn-progress-track';
            const progressBar = document.createElement('div');
            progressBar.className = 'pn-progress-fill';
            progressBar.style.width = '0%';
            progressWrap.appendChild(progressBar);
            body.appendChild(progressWrap);
            const interval = setInterval(() => {
                Millennium.callServerMethod('projectnova', 'GetUnfixStatus', { appid, contentScriptQuery: '' })
                    .then(res => {
                        const p = typeof res === 'string' ? JSON.parse(res) : res;
                        if (!p?.success) return;
                        const state = p.state || {};
                        if (state.status === 'done') {
                            progressBar.style.width = '100%';
                            msg.textContent = lt('Removed {count} files. Running Steam verification...').replace('{count}', state.filesRemoved || 0);
                            setTimeout(() => { window.location.href = 'steam://validate/' + appid; }, 1000);
                            clearInterval(interval);
                        } else if (state.status === 'failed') {
                            msg.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#ff5050;"></i>&nbsp;' + lt('Failed: {error}').replace('{error}', state.error || lt('Unknown error'));
                            clearInterval(interval);
                        }
                    });
            }, 500);
        }, null, { backAction: backFn });
    }

    // ========================== Alert & Confirm ==========================
    function ShowProjectNovaAlert(title, message, parentOverlay = null) {
        createModal(title, (body) => {
            body.innerHTML = `<p style="color:${NOVA.textSecondary};line-height:1.6;">${message}</p>`;
        }, () => {
            if (parentOverlay) parentOverlay.remove();
        }, { backAction: () => { if (parentOverlay) parentOverlay.remove(); } });
    }
    function showProjectNovaConfirm(title, message, onConfirm, onCancel) {
        createModal(title, (body, overlay) => {
            const p = document.createElement('p');
            p.style.cssText = 'color:' + NOVA.textSecondary + ';line-height:1.6;margin-bottom:24px;';
            p.textContent = message;
            body.appendChild(p);
            const btnRow = document.createElement('div');
            btnRow.style.cssText = 'display:flex;gap:10px;justify-content:center;';
            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'pn-btn-ghost';
            cancelBtn.textContent = lt('Cancel');
            cancelBtn.onclick = () => { overlay.remove(); if (onCancel) onCancel(); };
            const okBtn = document.createElement('button');
            okBtn.className = 'pn-btn-accent';
            okBtn.textContent = lt('Confirm');
            okBtn.onclick = () => { overlay.remove(); if (onConfirm) onConfirm(); };
            btnRow.appendChild(cancelBtn);
            btnRow.appendChild(okBtn);
            body.appendChild(btnRow);
        }, null, { backAction: () => overlay.remove() });
    }

    // ========================== Loaded Apps Popup ==========================
    function showLoadedAppsPopup(apps) {
        if (document.querySelector('.pn-overlay')) return;
        createModal(lt('Project Nova · Added Games'), (body) => {
            if (apps?.length) {
                const list = document.createElement('div');
                apps.forEach(item => {
                    const a = document.createElement('a');
                    a.href = 'steam://install/' + item.appid;
                    a.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:14px;background:rgba(255,255,255,0.04);text-decoration:none;color:' + NOVA.text + ';transition:background 0.2s;margin-bottom:8px;border:1px solid ' + NOVA.border + ';';
                    a.innerHTML = `<i class="fa-brands fa-steam" style="color:${NOVA.accentLight};font-size:18px;"></i><span style="font-weight:500;">${item.name || item.appid}</span><span style="margin-left:auto;font-size:12px;color:${NOVA.textSecondary};">App ID: ${item.appid}</span>`;
                    a.onmouseover = () => a.style.background = 'rgba(168,85,247,0.14)';
                    a.onmouseout = () => a.style.background = 'rgba(255,255,255,0.04)';
                    a.onclick = e => { e.preventDefault(); window.location.href = a.href; };
                    a.oncontextmenu = e => { e.preventDefault(); openUrl('https://steamdb.info/app/' + item.appid + '/'); };
                    list.appendChild(a);
                });
                body.appendChild(list);
                const info = document.createElement('div');
                info.style.cssText = 'font-size:12px;color:' + NOVA.textSecondary + ';margin-top:16px;text-align:center;opacity:0.7;';
                info.textContent = lt('Left click to install · Right click for SteamDB');
                body.appendChild(info);
            } else {
                body.innerHTML = `<div style="text-align:center;padding:40px;">${lt('No games found.')}</div>`;
            }
        }, () => { Millennium.callServerMethod('projectnova', 'DismissLoadedApps', { contentScriptQuery: '' }); sessionStorage.setItem('ProjectNovaLoadedAppsShown', '1'); });
    }

    // ========================== Button Injection ==========================
    let lastButtonCheckTime = 0;
    const BUTTON_CHECK_THROTTLE = 300;

    function addProjectNovaButton() {
        const now = Date.now();
        if (now - lastButtonCheckTime < BUTTON_CHECK_THROTTLE) return;
        lastButtonCheckTime = now;
        const currentUrl = window.location.href;
        if (window.__PROJECTNOVA_LAST_URL__ !== currentUrl) {
            window.__PROJECTNOVA_LAST_URL__ = currentUrl;
            window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
            window.__PROJECTNOVA_RESTART_INSERTED__ = false;
            window.__PROJECTNOVA_HEADER_INSERTED__ = false;
            ensureTranslationsLoaded(false).then(() => updateButtonTranslations());
        }

        // Header icon button (top-right)
        const headerSelectors = ['._1wn1lBlAzl3HMRqS1llwie', '.header_installsteam_btn_container', '.global_header_links', '.responsive_page_menu_ctn'];
        let headerContainer = null;
        for (const sel of headerSelectors) { headerContainer = document.querySelector(sel); if (headerContainer) break; }
        if (headerContainer && !document.querySelector('.projectnova-header-button') && !window.__PROJECTNOVA_HEADER_INSERTED__) {
            const headerBtn = document.createElement('a');
            headerBtn.href = '#';
            headerBtn.className = 'projectnova-header-button';
            headerBtn.title = 'Project Nova';
            loadIconIntoButton(headerBtn, 20);
            headerBtn.onclick = (e) => { e.preventDefault(); showSettingsPopup(); };
            headerContainer.appendChild(headerBtn);
            window.__PROJECTNOVA_HEADER_INSERTED__ = true;
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

        const referenceBtn = isBigPicture ? document.querySelector('#queueBtnFollow') : (targetContainer.querySelector('a') || targetContainer.querySelector('button'));
        const steamBtnClass = referenceBtn && referenceBtn.className ? referenceBtn.className : 'btnv6_blue_hoverfade btn_medium';

        // Restart Steam button
        if (window.location.pathname.includes('/app/') && !document.querySelector('.projectnova-restart-button') && !window.__PROJECTNOVA_RESTART_INSERTED__) {
            const restartBtn = document.createElement('a');
            restartBtn.className = steamBtnClass + ' projectnova-restart-button';
            restartBtn.href = '#';
            restartBtn.style.marginLeft = '6px';
            restartBtn.innerHTML = `<span>${lt('Restart Steam')}</span>`;
            restartBtn.onclick = (e) => { e.preventDefault(); showProjectNovaConfirm('Project Nova', lt('Restart Steam now?'), () => Millennium.callServerMethod('projectnova', 'RestartSteam', { contentScriptQuery: '' }), () => {}); };
            if (referenceBtn?.parentElement) referenceBtn.after(restartBtn);
            else targetContainer.appendChild(restartBtn);
            window.__PROJECTNOVA_RESTART_INSERTED__ = true;
        }

        // Add via Project Nova button
        if (window.location.pathname.includes('/app/') && !document.querySelector('.projectnova-button') && !window.__PROJECTNOVA_BUTTON_INSERTED__) {
            const addBtn = document.createElement('a');
            addBtn.className = steamBtnClass + ' projectnova-button';
            addBtn.href = '#';
            addBtn.style.marginLeft = '6px';
            addBtn.innerHTML = `<span>${lt('Add via Project Nova')}</span>`;
            addBtn.onclick = (e) => { e.preventDefault(); backendLog('Add button clicked'); };
            const restartBtn = targetContainer.querySelector('.projectnova-restart-button');
            if (restartBtn?.after) restartBtn.after(addBtn);
            else if (referenceBtn?.after) referenceBtn.after(addBtn);
            else targetContainer.appendChild(addBtn);
            window.__PROJECTNOVA_BUTTON_INSERTED__ = true;

            try {
                const match = window.location.href.match(/https:\/\/store\.steampowered\.com\/app\/(\d+)/);
                const appid = match ? parseInt(match[1], 10) : NaN;
                if (!isNaN(appid) && !addBtn.querySelector('.projectnova-pills-container')) {
                    fetchGamesDatabase().then(db => {
                        const gameData = db?.[String(appid)];
                        let status = 'untested';
                        if (gameData?.playable !== undefined) {
                            if (gameData.playable === 1) status = 'playable';
                            else if (gameData.playable === 0) status = 'unplayable';
                            else if (gameData.playable === 2) status = 'needs_fixes';
                        }
                        if (status !== 'untested') {
                            const pillContainer = document.createElement('div');
                            pillContainer.className = 'projectnova-pills-container';
                            pillContainer.style.cssText = 'position:absolute;top:-18px;left:50%;transform:translateX(-50%);white-space:nowrap;';
                            const pill = document.createElement('span');
                            pill.className = 'pn-pill';
                            const colors = { playable: '#5cb85c', unplayable: '#ff5050', needs_fixes: '#ffc107' };
                            pill.style.cssText = `background:${colors[status] || '#999'};color:#000;`;
                            pill.textContent = t(`gameStatus.${status}`, status.replace('_', ' '));
                            pillContainer.appendChild(pill);
                            addBtn.style.position = 'relative';
                            addBtn.appendChild(pillContainer);
                        }
                    });
                }
            } catch(_) {}
        }
    }

    function updateButtonTranslations() {
        const restartBtn = document.querySelector('.projectnova-restart-button');
        if (restartBtn) restartBtn.innerHTML = `<span>${lt('Restart Steam')}</span>`;
        const addBtn = document.querySelector('.projectnova-button');
        if (addBtn) { const pill = addBtn.querySelector('.projectnova-pills-container'); addBtn.innerHTML = `<span>${lt('Add via Project Nova')}</span>`; if (pill) addBtn.appendChild(pill); }
        const headerBtn = document.querySelector('.projectnova-header-button');
        if (headerBtn) headerBtn.title = lt('Project Nova');
    }

    function fetchSettingsConfig(forceRefresh) {
        if (!forceRefresh && window.__ProjectNovaSettings?.schema) return Promise.resolve(window.__ProjectNovaSettings);
        if (typeof Millennium === 'undefined') return Promise.reject(new Error('Backend unavailable'));
        return Millennium.callServerMethod('projectnova', 'GetSettingsConfig', { contentScriptQuery: '' })
            .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; if (!p?.success) throw new Error(p?.error || 'Failed'); const cfg = { schemaVersion: p.schemaVersion || 0, schema: Array.isArray(p.schema) ? p.schema : [], values: p.values || {}, language: p.language || 'en', locales: p.locales || [], translations: p.translations || {} }; applyTranslationBundle({ language: cfg.language, locales: cfg.locales, strings: cfg.translations }); window.__ProjectNovaSettings = cfg; return cfg; });
    }

    // ========================== Theme & Fonts (Fixed Large Modal Size) ==========================
    function ensureNovaTheme() {
        const existing = document.getElementById('projectnova-inline-theme');
        if (existing) existing.remove();
        const style = document.createElement('style');
        style.id = 'projectnova-inline-theme';
        style.textContent = `
            :root {
                --pn-bg-primary: ${NOVA.bgPrimary};
                --pn-bg-secondary: ${NOVA.bgSecondary};
                --pn-accent: ${NOVA.accent};
                --pn-accent-light: ${NOVA.accentLight};
                --pn-border: ${NOVA.border};
                --pn-text: ${NOVA.text};
                --pn-text-2: ${NOVA.textSecondary};
                --pn-shadow: ${NOVA.shadow};
            }
            .pn-overlay {
                position: fixed; inset: 0; z-index: 100000;
                display: flex; align-items: center; justify-content: center;
                background: rgba(0,0,0,0.85);
                backdrop-filter: blur(12px);
                animation: fadeIn 0.2s ease;
            }
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .pn-modal {
                background: linear-gradient(160deg, ${NOVA.bgSecondary} 0%, ${NOVA.bgPrimary} 100%);
                color: ${NOVA.text};
                border-radius: 24px;
                width: 900px;
                max-width: 95vw;
                max-height: 88vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
                border: 1px solid ${NOVA.border};
                box-shadow: 0 32px 64px -12px rgba(0,0,0,0.7), 0 0 0 1px ${NOVA.border}, inset 0 1px 0 rgba(255,255,255,0.1);
                animation: slideUp 0.2s ease;
            }
            .pn-modal-header {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px 56px;
                border-bottom: 1px solid ${NOVA.border};
                flex-shrink: 0;
            }
            .pn-modal-title {
                margin: 0;
                font-size: 1.4rem;
                font-weight: 800;
                letter-spacing: 0.02em;
                background: ${NOVA.gradientLight};
                -webkit-background-clip: text;
                background-clip: text;
                color: transparent;
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .pn-modal-title-icon {
                width: 28px;
                height: 28px;
                display: inline-block;
            }
            .pn-modal-close, .pn-back-btn {
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                background: rgba(255,255,255,0.08);
                border: 1px solid ${NOVA.border};
                color: ${NOVA.textSecondary};
                width: 36px; height: 36px;
                border-radius: 50%;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
            }
            .pn-modal-close { right: 18px; font-size: 22px; }
            .pn-back-btn { left: 18px; font-size: 18px; }
            .pn-modal-close:hover, .pn-back-btn:hover {
                background: rgba(168,85,247,0.3);
                border-color: ${NOVA.accentLight};
                color: #fff;
                transform: translateY(-50%) scale(1.05);
            }
            .pn-modal-body {
                flex: 1;
                overflow-y: auto;
                padding: 24px 28px;
                scrollbar-width: thin;
                scrollbar-color: ${NOVA.accent} transparent;
                font-size: 14px;
                font-weight: 600;
                text-align: center;
            }
            .pn-modal-body::-webkit-scrollbar { width: 6px; }
            .pn-modal-body::-webkit-scrollbar-track { background: transparent; }
            .pn-modal-body::-webkit-scrollbar-thumb { background: ${NOVA.accent}; border-radius: 99px; }
            .pn-search-wrap { position: relative; margin-bottom: 20px; }
            .pn-search {
                width: 100%;
                padding: 12px 16px 12px 42px;
                background: rgba(255,255,255,0.08);
                border: 1px solid ${NOVA.border};
                border-radius: 14px;
                color: ${NOVA.text};
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s;
            }
            .pn-search:focus { border-color: ${NOVA.accentLight}; background: rgba(168,85,247,0.12); outline: none; }
            .pn-search-icon {
                position: absolute;
                left: 14px;
                top: 50%;
                transform: translateY(-50%);
                color: ${NOVA.textSecondary};
                font-size: 14px;
            }
            .pn-section-label {
                font-size: 11px;
                font-weight: 800;
                letter-spacing: 0.12em;
                text-transform: uppercase;
                color: ${NOVA.accentLight};
                opacity: 0.9;
                margin: 24px 0 10px;
                text-align: left;
            }
            .pn-card {
                display: flex;
                align-items: center;
                gap: 18px;
                padding: 16px 20px;
                background: rgba(255,255,255,0.05);
                border: 1px solid ${NOVA.border};
                border-radius: 16px;
                cursor: pointer;
                transition: all 0.2s;
                margin-bottom: 10px;
                text-align: left;
            }
            .pn-card:hover {
                background: rgba(168,85,247,0.2);
                border-color: ${NOVA.accentLight};
                transform: translateX(5px);
            }
            .pn-card-icon {
                width: 44px; height: 44px;
                border-radius: 12px;
                background: rgba(168,85,247,0.2);
                border: 1px solid ${NOVA.border};
                display: flex; align-items: center; justify-content: center;
                font-size: 18px;
                color: ${NOVA.accentLight};
            }
            .pn-card-text { flex: 1; }
            .pn-card-label { font-weight: 700; font-size: 15px; color: ${NOVA.text}; margin-bottom: 4px; }
            .pn-card-desc { font-size: 12px; color: ${NOVA.textSecondary}; opacity: 0.85; }
            .pn-card-arrow { color: rgba(255,255,255,0.3); font-size: 14px; }
            .pn-btn-accent {
                padding: 12px 24px;
                background: ${NOVA.gradient};
                border: none;
                border-radius: 12px;
                color: #fff;
                font-weight: 700;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
            }
            .pn-btn-accent:hover { opacity: 0.9; transform: translateY(-2px); box-shadow: 0 6px 14px ${NOVA.shadow}; }
            .pn-btn-ghost {
                padding: 12px 24px;
                background: transparent;
                border: 1px solid ${NOVA.border};
                border-radius: 12px;
                color: ${NOVA.textSecondary};
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .pn-btn-ghost:hover { border-color: ${NOVA.accentLight}; color: #fff; background: rgba(168,85,247,0.15); }
            .pn-toggle-btn {
                padding: 8px 20px;
                border: 1px solid ${NOVA.border};
                border-radius: 10px;
                background: transparent;
                color: ${NOVA.textSecondary};
                cursor: pointer;
                font-size: 14px;
                font-weight: 600;
                transition: all 0.15s;
            }
            .pn-toggle-btn.active {
                background: ${NOVA.accentLight};
                border-color: ${NOVA.accentLight};
                color: #0a0a1f;
            }
            .pn-fix-btn {
                width: 100%;
                padding: 16px;
                border-radius: 16px;
                border: 1px solid ${NOVA.border};
                background: rgba(255,255,255,0.05);
                color: ${NOVA.text};
                cursor: pointer;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 12px;
                font-weight: 600;
                font-size: 14px;
                margin-bottom: 16px;
            }
            .pn-fix-btn:hover:not(:disabled) {
                background: rgba(168,85,247,0.25);
                border-color: ${NOVA.accentLight};
                transform: translateY(-2px);
                box-shadow: 0 8px 20px -4px ${NOVA.shadow};
            }
            .pn-fix-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            .pn-input, .pn-select {
                width: 100%;
                padding: 12px 16px;
                background: rgba(255,255,255,0.08);
                border: 1px solid ${NOVA.border};
                border-radius: 12px;
                color: ${NOVA.text};
                font-size: 14px;
                font-weight: 500;
                transition: border 0.2s;
            }
            .pn-input:focus, .pn-select:focus { border-color: ${NOVA.accentLight}; outline: none; background: rgba(168,85,247,0.1); }
            .pn-info-box {
                background: rgba(168,85,247,0.12);
                border-left: 4px solid ${NOVA.accent};
                padding: 14px 18px;
                border-radius: 0 12px 12px 0;
                font-size: 14px;
                color: ${NOVA.textSecondary};
                margin-bottom: 18px;
                line-height: 1.5;
                text-align: left;
            }
            .pn-warn-box {
                background: rgba(255,193,7,0.12);
                border-left: 4px solid #ffc107;
                padding: 14px 18px;
                border-radius: 0 12px 12px 0;
                font-size: 14px;
                color: #ffd966;
                margin-bottom: 18px;
                text-align: left;
            }
            .pn-faq-item {
                background: rgba(255,255,255,0.05);
                border: 1px solid ${NOVA.border};
                border-radius: 16px;
                padding: 20px 24px;
                margin-bottom: 14px;
                text-align: left;
            }
            .pn-faq-item h3 { margin: 0 0 10px; font-size: 16px; font-weight: 800; color: ${NOVA.accentLight}; }
            .pn-faq-item p { margin: 0 0 10px; font-size: 14px; color: ${NOVA.textSecondary}; line-height: 1.6; }
            .pn-link { color: ${NOVA.accentLight}; text-decoration: none; cursor: pointer; border-bottom: 1px solid transparent; transition: border 0.15s; }
            .pn-link:hover { border-bottom-color: ${NOVA.accentLight}; }
            .pn-progress-track {
                background: rgba(255,255,255,0.12);
                border-radius: 99px;
                height: 10px;
                overflow: hidden;
                margin-top: 16px;
            }
            .pn-progress-fill {
                height: 100%;
                background: ${NOVA.gradientLight};
                border-radius: 99px;
                transition: width 0.3s;
            }
            .pn-pill {
                display: inline-block;
                padding: 3px 10px;
                border-radius: 99px;
                font-size: 10px;
                font-weight: 800;
                text-transform: uppercase;
            }
            .projectnova-header-button {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                width: 36px !important;
                height: 36px !important;
                border-radius: 12px !important;
                background: rgba(168,85,247,0.25) !important;
                border: 1px solid ${NOVA.border} !important;
                cursor: pointer !important;
                margin-left: 8px !important;
                transition: all 0.2s !important;
            }
            .projectnova-header-button:hover {
                background: rgba(168,85,247,0.45) !important;
                border-color: ${NOVA.accentLight} !important;
                box-shadow: 0 0 14px ${NOVA.shadow} !important;
            }
            .pn-settings-group {
                background: rgba(255,255,255,0.05);
                border: 1px solid ${NOVA.border};
                border-radius: 20px;
                padding: 22px;
                margin-bottom: 22px;
                text-align: left;
            }
            .pn-settings-group-title {
                margin: 0 0 18px;
                font-size: 16px;
                font-weight: 800;
                border-left: 3px solid ${NOVA.accentLight};
                padding-left: 14px;
                color: ${NOVA.text};
            }
            .pn-settings-option { margin-bottom: 20px; }
            .pn-settings-option-label { font-weight: 700; font-size: 14px; margin-bottom: 4px; color: ${NOVA.text}; }
            .pn-settings-option-desc { font-size: 12px; color: ${NOVA.textSecondary}; margin-bottom: 10px; opacity: 0.8; }
            .pn-game-item {
                background: rgba(255,255,255,0.05);
                border: 1px solid ${NOVA.border};
                border-radius: 16px;
                padding: 16px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 12px;
                text-align: left;
            }
            .pn-game-item-name { font-weight: 700; font-size: 15px; }
            .pn-game-item-appid { font-size: 12px; color: ${NOVA.textSecondary}; margin-top: 3px; }
            .pn-appid-row { display: flex; gap: 12px; }
            .pn-appid-row .pn-input { flex: 1; }
        `;
        document.head.appendChild(style);
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

    // ========================== Initialisation ==========================
    function onFrontendReady() {
        ensureTranslationsLoaded(false).then(() => {
            ensureNovaTheme();
            ensureFontAwesome();
            if (window.location.hostname === 'store.steampowered.com' && localStorage.getItem('projectnova millennium disclaimer accepted') !== '1') {
                createModal(t('disclaimer.title', 'Project Nova – Important Notice'), (body) => {
                    body.innerHTML = `
                        <div class="pn-warn-box"><strong>${lt('Please read before continuing.')}</strong></div>
                        <div class="pn-info-box">
                            <p>${lt('Project Nova uses SteamTools, a closed-source application. Its code cannot be fully verified. It originates from China and may pose privacy risks, including spyware. Some features may trigger antivirus warnings.')}</p>
                            <p>${lt('Despite this, the tool functions as intended and is used by over 100,000 users.')}</p>
                            <p>${lt('You may need to temporarily disable your antivirus. Use at your own risk.')}</p>
                        </div>
                    `;
                    const btnRow = document.createElement('div');
                    btnRow.style.cssText = 'display:flex;justify-content:center;margin-top:20px;';
                    const continueBtn = document.createElement('button');
                    continueBtn.className = 'pn-btn-accent';
                    continueBtn.innerHTML = '<i class="fa-solid fa-check"></i>&nbsp;' + lt('I Understand, Continue');
                    continueBtn.onclick = () => { localStorage.setItem('projectnova millennium disclaimer accepted', '1'); document.querySelector('.pn-overlay')?.remove(); };
                    btnRow.appendChild(continueBtn);
                    body.appendChild(btnRow);
                }, null, { backAction: () => document.querySelector('.pn-overlay')?.remove() });
            }
            addProjectNovaButton();
            if (window.location.hostname === 'store.steampowered.com' && !sessionStorage.getItem('ProjectNovaLoadedAppsGate')) {
                sessionStorage.setItem('ProjectNovaLoadedAppsGate', '1');
                Millennium.callServerMethod('projectnova', 'ReadLoadedApps', { contentScriptQuery: '' })
                    .then(res => { const p = typeof res === 'string' ? JSON.parse(res) : res; const apps = p?.success && Array.isArray(p.apps) ? p.apps : []; if (apps.length) showLoadedAppsPopup(apps); });
            }
        });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onFrontendReady);
    else onFrontendReady();

    document.addEventListener('click', (evt) => {
        const anchor = evt.target.closest('.projectnova-button');
        if (!anchor) return;
        evt.preventDefault(); evt.stopPropagation();
        const match = window.location.href.match(/https:\/\/store\.steampowered\.com\/app\/(\d+)/);
        const appid = match ? parseInt(match[1], 10) : NaN;
        if (isNaN(appid) || runState.inProgress) return;
        const continueWithAdd = () => {
            if (!document.querySelector('.pn-overlay')) showDownloadPopupForAppId(appid);
            runState.inProgress = true;
            runState.appid = appid;
            runState.cancelRequested = false;
            Millennium.callServerMethod('projectnova', 'StartAddViaProjectNova', { appid, contentScriptQuery: '' });
        };
        fetch('https://store.steampowered.com/api/appdetails?appids=' + appid + '&filters=basic')
            .then(r => r.json())
            .then(data => {
                if (data?.[appid]?.success && data[appid].data?.type === 'dlc' && data[appid].data.fullgame) {
                    createModal(lt('DLC Detected'), (body) => {
                        body.innerHTML = `<p>${lt('DLCs are added together with the base game. Go to the base game page:')}<br><br><strong style="color:${NOVA.accentLight};">${data[appid].data.fullgame.name}</strong></p>`;
                        const btnRow = document.createElement('div');
                        btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:20px;';
                        const gotoBtn = document.createElement('button');
                        gotoBtn.className = 'pn-btn-accent';
                        gotoBtn.textContent = lt('Go to Base Game');
                        gotoBtn.onclick = () => window.location.href = 'https://store.steampowered.com/app/' + data[appid].data.fullgame.appid;
                        const cancelBtn = document.createElement('button');
                        cancelBtn.className = 'pn-btn-ghost';
                        cancelBtn.textContent = lt('Cancel');
                        cancelBtn.onclick = () => document.querySelector('.pn-overlay')?.remove();
                        btnRow.appendChild(cancelBtn);
                        btnRow.appendChild(gotoBtn);
                        body.appendChild(btnRow);
                    }, null, { backAction: () => document.querySelector('.pn-overlay')?.remove() });
                    return;
                }
                fetchGamesDatabase().then(db => {
                    const gameData = db?.[String(appid)];
                    if (gameData?.playable === 0) {
                        createModal(t('common.warning', 'Warning'), (body) => {
                            body.innerHTML = `<p class="pn-warn-box">${lt('This game may not work. Support won\'t be given in our Discord.')}</p>`;
                            const btnRow = document.createElement('div');
                            btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;margin-top:16px;';
                            const proceedBtn = document.createElement('button');
                            proceedBtn.className = 'pn-btn-accent';
                            proceedBtn.textContent = lt('Proceed');
                            const cancelBtn = document.createElement('button');
                            cancelBtn.className = 'pn-btn-ghost';
                            cancelBtn.textContent = lt('Cancel');
                            proceedBtn.onclick = () => { document.querySelector('.pn-overlay')?.remove(); continueWithAdd(); };
                            cancelBtn.onclick = () => document.querySelector('.pn-overlay')?.remove();
                            btnRow.appendChild(cancelBtn);
                            btnRow.appendChild(proceedBtn);
                            body.appendChild(btnRow);
                        }, null, { backAction: () => document.querySelector('.pn-overlay')?.remove() });
                    } else continueWithAdd();
                });
            })
            .catch(() => continueWithAdd());
    });

    let lastUrl = window.location.href;
    setInterval(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            window.__PROJECTNOVA_BUTTON_INSERTED__ = false;
            window.__PROJECTNOVA_RESTART_INSERTED__ = false;
            window.__PROJECTNOVA_HEADER_INSERTED__ = false;
            ensureTranslationsLoaded(false).then(() => addProjectNovaButton());
        }
    }, 1500);
    window.addEventListener('popstate', () => setTimeout(() => addProjectNovaButton(), 100));
    const originalPushState = history.pushState;
    history.pushState = function() { originalPushState.apply(history, arguments); setTimeout(() => addProjectNovaButton(), 100); };
    const observer = new MutationObserver(() => {
        if (document.querySelector('.steamdb-buttons, #queueBtnFollow, .game_meta_actions, .header_installsteam_btn_container'))
            addProjectNovaButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();