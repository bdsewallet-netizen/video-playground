// Storage keys
        const STORAGE_VIDEOS = 'videoPlayground_videos';
        const STORAGE_ADS = 'videoPlayground_ads';
        const STORAGE_GLOBAL_ADS = 'videoPlayground_globalAds';
        // Server storage (api.php). When present, ads + videos are saved on the server so every visitor sees them.
        const SERVER = { on: false, data: null, pin: '', timer: null };
        const STORAGE_ADS_EDITED = 'videoPlayground_adsLocalEdited';   // set only when the admin edits ads in this browser
        const STORAGE_PIN = 'videoPlayground_pin';
        const STORAGE_SETTINGS = 'videoPlayground_settings';

        // Sample videos fallback dataset generator
        function generateMockVideoDataset() {
            const categories = ["Technology", "Featured", "Action", "Comedy", "Documentary", "Music", "Sports"];
            const titles = [
                "Cyberpunk Future City Cinematic", "Deep Sea Underwater Expedition", "High Speed Formula Racing 2026",
                "Lo-Fi Beats Relaxing Coding Session", "Wildlife VR Safari 4K Documentary", "AI Revolution Web Development",
                "Space Exploration Mars Rover", "Top Stand-Up Comedy Highlights", "Extreme Mountain Biking Highlights",
                "Modern Architecture & Design Wonders"
            ];

            const sampleVideoUrls = [
                "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
                "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
                "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
                "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4",
                "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4",
                "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"
            ];

            const dataset = [];
            for (let i = 1; i <= 200; i++) {
                const cat = categories[i % categories.length];
                const titleBase = titles[i % titles.length];
                const hue = (i * 37) % 360;
                const title = `${titleBase} #${i}`;
                const thumbnail = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'><rect width='640' height='360' fill='hsl(${hue}, 45%, 15%)'/><circle cx='320' cy='180' r='75' fill='hsl(${hue}, 65%, 25%)' opacity='0.7'/><path d='M300 150 L350 180 L300 210 Z' fill='%236366F1'/><text x='320' y='315' font-family='Arial' font-size='20' font-weight='bold' fill='%23FFFFFF' text-anchor='middle'>${encodeURIComponent(title.substring(0, 24))}</text></svg>`;

                dataset.push({
                    id: i,
                    title: title,
                    description: `Experience stunning visual narrative and rich high definition playback in ${title}.`,
                    category: cat,
                    duration: `0${(i % 8) + 2}:${(i * 13) % 60 < 10 ? '0' : ''}${(i * 13) % 60}`,
                    views: Math.floor(1500 + (i * 842)),
                    date: `2026-0${(i % 9) + 1}-15`,
                    thumbnail: thumbnail,
                    videoUrl: sampleVideoUrls[i % sampleVideoUrls.length],
                    status: 'published',
                    featured: i <= 5,
                    sliderPosition: i <= 5 ? i : null,
                    tags: [cat.toLowerCase(), 'hd', 'trending']
                });
            }
            return dataset;
        }

        function generateMockAdSlots() {
            return [];   // no demo ads: only the slots the admin adds
        }

        // Allowed ad types. Older saves used other names; map them, drop empty demo slots.
        const AD_TYPES = ['socialbar', 'popunder', 'native', 'banner_728x90', 'banner_320x50', 'banner_468x60'];
        function normalizeAdSlots(list) {
            const legacy = { banner: 'banner_728x90', incontent: 'native' };
            const out = (Array.isArray(list) ? list : []).map(x => ({ ...x, type: legacy[x.type] || x.type }))
                .filter(x => AD_TYPES.includes(x.type) && x.code && String(x.code).trim());
            out.forEach(x => { if (!x.position || x.position === 'none' || x.position === 'popup') x.position = x.type === 'socialbar' ? 'bottom' : 'top'; });
            return out;
        }

        // Global State Variables
        let videoData = [];
        let adSlots = [];
        let adminPin = '1234';
        let globalAdsEnabled = true;
        let isAdminAuthenticated = false;

        let filteredVideos = [];
        let featuredVideos = [];
        let currentView = 'client'; // 'client' or 'admin'
        let currentHeroIndex = 0;
        let heroAutoplayTimer = null;
        let currentPage = 1;
        const pageSize = 24;
        let activeCategory = 'All';
        let searchQuery = '';
        let currentSort = 'latest';
        let activeModalVideoId = null;

        let pendingDeleteAction = null;
        let selectedUploadSourceMode = 'file';
        let currentSelectedFileBlob = null;
        let currentFileSaved = null;   // promise: file written to IndexedDB

        // ---------- Shared helpers ----------
        function escapeHtml(value) {
            return String(value == null ? '' : value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        // "3:5" -> "03:05", "1:2:3" -> "01:02:03" (anything else is kept as typed)
        function normalizeDuration(raw) {
            const s = String(raw || '').trim();
            const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
            if (!m) return s;
            const p = (n) => String(n).padStart(2, '0');
            return m[3] !== undefined ? `${p(m[1])}:${p(m[2])}:${p(m[3])}` : `${p(m[1])}:${p(m[2])}`;
        }

        // Generated thumbnail used when a video has no (or a broken) thumbnail URL
        function placeholderThumb(title) {
            let hue = 0;
            for (const ch of String(title || '')) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
            const label = encodeURIComponent(String(title || 'Video').substring(0, 24));
            return `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'><rect width='640' height='360' fill='hsl(${hue}, 45%, 15%)'/><circle cx='320' cy='180' r='75' fill='hsl(${hue}, 65%, 25%)' opacity='0.7'/><path d='M300 150 L350 180 L300 210 Z' fill='%236366F1'/><text x='320' y='315' font-family='Arial' font-size='20' font-weight='bold' fill='%23FFFFFF' text-anchor='middle'>${label}</text></svg>`;
        }

        function getThumb(v) {
            return (v.thumbnail && String(v.thumbnail).trim()) ? v.thumbnail : placeholderThumb(v.title);
        }

        // True when a video has no real thumbnail image (empty or the generated SVG placeholder)
        function isPlaceholderThumb(v) {
            const t = v && v.thumbnail ? String(v.thumbnail).trim() : '';
            return !t || t.startsWith('data:image/svg+xml');
        }

        // Source used to show a real frame of the video (seeks to 1s so it is not a black first frame)
        function frameSrc(v) {
            const u = String(v.videoUrl || '');
            if (!u) return '';
            return (u.startsWith('blob:') || u.includes('#')) ? u : u + '#t=1';
        }

        // ===== Smooth playback: background videos must never fight the real player =====
        // Hero / card / hover previews only PLAY light videos. A 4K (or 2K) clip decodes far too much data
        // for a muted background preview and makes the main player stutter, so those show a still frame.
        // Raise this number if you want 2K previews to play too.
        const PREVIEW_MAX_PIXELS = 1920 * 1088;
        function isHeavyForPreview(el) { return (el.videoWidth || 0) * (el.videoHeight || 0) > PREVIEW_MAX_PIXELS; }

        function isVideoModalOpen() {
            const m = document.getElementById('videoModal');
            return !!m && !m.classList.contains('hidden');
        }

        // stop a <video> completely: no playback, no downloading, decoder released
        function disposeVideoEl(v) {
            try { v.pause(); } catch (_) {}
            v.removeAttribute('src');
            v.load();
        }

        // Card frame videos are loaded only while their card is near the screen, and released when it scrolls
        // away. Without this every card keeps its own 4K decoder open (24 at once), which stutters or errors out.
        let cardFrameObserver = null;
        function loadCardFrame(v) {
            const s = v.dataset.src;
            if (!s) return;
            v.src = s;
            v.removeAttribute('data-src');
        }
        function unloadCardFrame(v) {
            const s = v.getAttribute('src');
            if (!s) return;
            v.dataset.src = s;
            disposeVideoEl(v);
            v.dataset.ready = '';
            v.style.opacity = '0';
        }
        function observeCardFrames() {
            const frames = document.querySelectorAll('video.card-frame');
            if (cardFrameObserver) cardFrameObserver.disconnect();
            if (!frames.length) return;
            if (!('IntersectionObserver' in window)) { frames.forEach(loadCardFrame); return; }
            if (!cardFrameObserver) {
                cardFrameObserver = new IntersectionObserver(function (entries) {
                    entries.forEach(function (e) {
                        if (e.isIntersecting) { if (!isVideoModalOpen()) loadCardFrame(e.target); }
                        else unloadCardFrame(e.target);
                    });
                }, { rootMargin: '250px' });
            }
            // observing again reports each card's current state, so visible ones load straight away
            frames.forEach(function (f) { cardFrameObserver.observe(f); });
        }

        // When the watch player opens: free everything else so the player gets all the CPU/GPU/bandwidth
        function releaseBackgroundVideos() {
            clearInterval(heroAutoplayTimer);
            document.querySelectorAll('video.hero-frame').forEach(function (v) { disposeVideoEl(v); v.remove(); });
            document.querySelectorAll('video.card-frame').forEach(unloadCardFrame);
        }

        // When the watch player closes: bring the homepage back (card frames reload lazily)
        function restoreBackgroundVideos() {
            observeCardFrames();
            if (featuredVideos && featuredVideos.length) renderHeroSlide();   // re-creates the hero preview
            startHeroAutoplay();
        }

        // hover preview on cards: play muted while hovering, rewind on leave
        window.cardPreviewPlay = function(card) {
            const vid = card.querySelector('video.card-frame');
            if (!vid || vid.dataset.ready !== '1' || isHeavyForPreview(vid) || isVideoModalOpen()) return;
            const p = vid.play(); if (p && p.catch) p.catch(function () {});
        };
        window.cardPreviewStop = function(card) {
            const vid = card.querySelector('video.card-frame');
            if (!vid) return;
            vid.pause();
            try { vid.currentTime = 1; } catch (_) {}
        };

        // <img onerror="thumbFallback(this)"> -> swap broken images for the generated one
        window.thumbFallback = function(img) {
            img.onerror = null;
            img.src = placeholderThumb(img.alt);
        };

        // ===== IndexedDB: keeps uploaded local files so they survive a page refresh =====
        const FileStore = {
            _db: null,
            open() {
                return new Promise((resolve, reject) => {
                    if (this._db) return resolve(this._db);
                    if (!window.indexedDB) return reject(new Error('IndexedDB not available'));
                    const req = indexedDB.open('videoPlayground_files', 1);
                    req.onupgradeneeded = () => req.result.createObjectStore('files');
                    req.onsuccess = () => { this._db = req.result; resolve(req.result); };
                    req.onerror = () => reject(req.error);
                });
            },
            async put(key, blob) {
                const db = await this.open();
                return new Promise((resolve, reject) => {
                    const tx = db.transaction('files', 'readwrite');
                    tx.objectStore('files').put(blob, key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                });
            },
            async get(key) {
                const db = await this.open();
                return new Promise((resolve, reject) => {
                    const req = db.transaction('files', 'readonly').objectStore('files').get(key);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => reject(req.error);
                });
            },
            async remove(key) {
                const db = await this.open();
                return new Promise((resolve) => {
                    const tx = db.transaction('files', 'readwrite');
                    tx.objectStore('files').delete(key);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => resolve();
                });
            }
        };

        // blob: URL (this session only) -> IndexedDB key (permanent). Saved videos store 'idb:<key>' instead of the dead blob URL.
        const blobKeyByUrl = {};

        // Make a local file playable now AND after refresh. Returns { url, saved } where saved is a promise.
        function registerLocalFile(file) {
            const key = 'f_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
            const url = URL.createObjectURL(file);
            blobKeyByUrl[url] = key;
            const saved = FileStore.put(key, file).then(() => true).catch(() => {
                delete blobKeyByUrl[url];   // could not persist: it will only play in this session
                return false;
            });
            return { url, saved };
        }

        function serializeVideos(list) {
            return list.map(v => (blobKeyByUrl[v.videoUrl] ? { ...v, videoUrl: 'idb:' + blobKeyByUrl[v.videoUrl] } : v));
        }

        // after load: turn every 'idb:<key>' back into a fresh playable blob: URL
        async function resolveStoredFiles() {
            for (const v of videoData) {
                if (typeof v.videoUrl === 'string' && v.videoUrl.startsWith('idb:')) {
                    const key = v.videoUrl.slice(4);
                    try {
                        const blob = await FileStore.get(key);
                        if (blob) {
                            const url = URL.createObjectURL(blob);
                            blobKeyByUrl[url] = key;
                            v.videoUrl = url;
                        }
                    } catch (e) { /* leave idb: ref; the player shows its error state */ }
                }
            }
        }

        const VideoService = {
            getAll() { return videoData; },
            getById(id) { return videoData.find(v => v.id === parseInt(id)); },
            save(list) {
                videoData = list;
                try {
                    localStorage.setItem(STORAGE_VIDEOS, JSON.stringify(serializeVideos(videoData)));
                } catch(e) {
                    if (typeof showToast === 'function') showToast('Could not save changes: browser storage is full or blocked.', { error: true });
                }
                queueServerSync();
            },
            add(item) {
                item.id = Date.now();
                videoData.unshift(item);
                this.save(videoData);
                return item;
            },
            update(id, updatedFields) {
                const idx = videoData.findIndex(v => v.id === parseInt(id));
                if (idx !== -1) {
                    videoData[idx] = { ...videoData[idx], ...updatedFields };
                    this.save(videoData);
                    return videoData[idx];
                }
                return null;
            },
            delete(id) {
                const gone = this.getById(id);
                videoData = videoData.filter(v => v.id !== parseInt(id));
                this.save(videoData);
                // free the stored file if no other video still uses it
                if (gone && blobKeyByUrl[gone.videoUrl] && !videoData.some(v => v.videoUrl === gone.videoUrl)) {
                    FileStore.remove(blobKeyByUrl[gone.videoUrl]).catch(() => {});
                    delete blobKeyByUrl[gone.videoUrl];
                }
            },
            duplicate(id) {
                const original = this.getById(id);
                if (original) {
                    const copy = {
                        ...original,
                        id: Date.now(),
                        title: `${original.title} (Copy)`,
                        status: 'draft',
                        featured: false,
                        sliderPosition: null
                    };
                    videoData.unshift(copy);
                    this.save(videoData);
                    return copy;
                }
                return null;
            }
        };

        const AdService = {
            getAll() { return adSlots; },
            save(list) {
                adSlots = list;
                try { localStorage.setItem(STORAGE_ADS, JSON.stringify(adSlots)); } catch(e){}
                queueServerSync();
            },
            add(slot) {
                slot.id = Date.now();
                adSlots.push(slot);
                this.save(adSlots);
                return slot;
            },
            update(id, fields) {
                const idx = adSlots.findIndex(a => a.id === parseInt(id));
                if (idx !== -1) {
                    adSlots[idx] = { ...adSlots[idx], ...fields };
                    this.save(adSlots);
                    return adSlots[idx];
                }
                return null;
            },
            delete(id) {
                adSlots = adSlots.filter(a => a.id !== parseInt(id));
                this.save(adSlots);
            }
        };

        // ===== Server storage layer =====
        async function serverLoad() {
            try {
                const ctl = new AbortController();
                const t = setTimeout(() => ctl.abort(), 7000);
                const r = await fetch('api.php?action=get&t=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
                clearTimeout(t);
                if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return;
                const j = await r.json();
                if (j && j.server === true) { SERVER.on = true; SERVER.data = j.empty ? null : j; }
            } catch (e) { /* no PHP here (static hosting / file://): keep browser-only mode */ }
        }

        function isLocalOnlyVideo(v) {
            const u = String(v.videoUrl || '');
            return u.startsWith('blob:') || u.startsWith('idb:') || !!blobKeyByUrl[u];
        }

        function applyServerData() {
            if (!SERVER.on || !SERVER.data) return;
            const d = SERVER.data;
            if (Array.isArray(d.videos)) {
                const localOnly = videoData.filter(isLocalOnlyVideo);        // files that live only in this admin's browser
                const ids = new Set(d.videos.map(v => v.id));
                videoData = d.videos.concat(localOnly.filter(v => !ids.has(v.id)));
            }
            if (Array.isArray(d.ads)) adSlots = normalizeAdSlots(d.ads);
            if (typeof d.globalAdsEnabled === 'boolean') globalAdsEnabled = d.globalAdsEnabled;
        }

        function setSyncBadge(state, msg) {
            const b = document.getElementById('serverSyncBadge');
            if (!b) return;
            const S = {
                off:    ['bg-amber-500/15 text-amber-300 border-amber-500/30', 'fa-solid fa-triangle-exclamation', 'Server not connected: changes stay in this browser only'],
                ready:  ['bg-sky-500/15 text-sky-300 border-sky-500/30', 'fa-solid fa-cloud', 'Server connected: every change is saved automatically'],
                saving: ['bg-sky-500/15 text-sky-300 border-sky-500/30', 'fa-solid fa-spinner fa-spin', 'Saving to server...'],
                ok:     ['bg-emerald-500/15 text-emerald-300 border-emerald-500/30', 'fa-solid fa-circle-check', 'Saved on server: live for all visitors'],
                error:  ['bg-red-500/15 text-red-300 border-red-500/30', 'fa-solid fa-circle-exclamation', msg || 'Server save failed']
            }[state];
            b.className = 'mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ' + S[0];
            b.innerHTML = '<i class="' + S[1] + '"></i> <span></span>';
            b.lastElementChild.textContent = S[2];
        }

        function refreshSyncBadge() {
            if (!SERVER.on) { setSyncBadge('off'); return; }
            setSyncBadge(SERVER.pin ? 'ready' : 'error', 'Server found, but you are not logged in to it. Lock and log in again.');
        }

        function stripForServer(v) {
            const c = { ...v };
            if (String(c.thumbnail || '').startsWith('data:')) c.thumbnail = '';   // generated picture is rebuilt from the title
            return c;
        }

        function queueServerSync() {
            if (!SERVER.on || !SERVER.pin) return;
            clearTimeout(SERVER.timer);
            setSyncBadge('saving');
            SERVER.timer = setTimeout(() => window.serverPush(false), 700);
        }

        window.serverPush = async function (manual) {
            if (!SERVER.on) { showToast('No server found. Upload api.php, share.php and og-image.php to your hosting.', { error: true }); return; }
            if (!SERVER.pin) { showToast('Log in to the Admin Portal first.', { error: true }); return; }
            setSyncBadge('saving');
            try {
                const r = await fetch('api.php?action=save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': SERVER.pin },
                    body: JSON.stringify({
                        ads: adSlots,
                        globalAdsEnabled: globalAdsEnabled,
                        videos: videoData.filter(v => !isLocalOnlyVideo(v)).map(stripForServer)
                    })
                });
                const j = await r.json().catch(() => ({}));
                if (r.ok && j.ok) {
                    SERVER.data = SERVER.data || { pushed: true };
                    setSyncBadge('ok');
                    if (manual) showToast('Saved on the server.');
                } else {
                    setSyncBadge('error', r.status === 401 ? 'Server rejected the PIN (check ADMIN_PIN in api.php)' : (j.error || 'Server error'));
                }
            } catch (e) { setSyncBadge('error', 'Cannot reach the server'); }
        };

        async function serverUploadThumb(id, dataUrl) {
            try {
                const r = await fetch('api.php?action=thumb', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Admin-Pin': SERVER.pin },
                    body: JSON.stringify({ id: String(id), image: dataUrl })
                });
                const j = await r.json();
                return j && j.ok ? j.url : null;
            } catch (e) { return null; }
        }

        // Initialize Local Storage or Defaults
        function initData() {
            try {
                const savedPin = localStorage.getItem(STORAGE_PIN);
                if (savedPin) adminPin = savedPin;

                const savedVideos = localStorage.getItem(STORAGE_VIDEOS);
                if (savedVideos) {
                    videoData = JSON.parse(savedVideos);
                } else {
                    videoData = generateMockVideoDataset();
                    VideoService.save(videoData);
                }

                const savedGlobalAds = localStorage.getItem(STORAGE_GLOBAL_ADS);
                if (savedGlobalAds !== null) globalAdsEnabled = savedGlobalAds === '1';

                // Site-wide ads come from js/ads-config.js (what real visitors get).
                // Only the admin's own browser prefers its local edits (after editing, before exporting).
                const cfg = window.SITE_AD_CONFIG;
                const hasSiteCfg = cfg && Array.isArray(cfg.slots) && cfg.slots.length > 0;
                const localEdited = localStorage.getItem(STORAGE_ADS_EDITED) === '1';
                const savedAds = localStorage.getItem(STORAGE_ADS);

                if (hasSiteCfg && !localEdited) {
                    adSlots = JSON.parse(JSON.stringify(cfg.slots));
                    globalAdsEnabled = cfg.globalAdsEnabled !== false;
                } else if (savedAds) {
                    adSlots = JSON.parse(savedAds);
                } else {
                    adSlots = generateMockAdSlots();
                    AdService.save(adSlots);
                }
                const before = adSlots.length;
                adSlots = normalizeAdSlots(adSlots);
                if (adSlots.length !== before && !(hasSiteCfg && !localEdited)) AdService.save(adSlots);
            } catch(e) {
                videoData = generateMockVideoDataset();
                adSlots = generateMockAdSlots();
            }
        }

        window.switchView = function(viewName) {
            if (viewName === 'admin') {
                if (!isAdminAuthenticated) {
                    openAdminPinModal();
                    return;
                }
            }

            const clientView = document.getElementById('clientView');
            const adminView = document.getElementById('adminView');

            if (viewName === 'admin') {
                clientView.classList.add('hidden');
                adminView.classList.remove('hidden');
                currentView = 'admin';
                renderAdminDashboard();
                renderAdminTable();
                renderAdminAdsTable();
            } else {
                adminView.classList.add('hidden');
                clientView.classList.remove('hidden');
                currentView = 'client';
                applyFiltersAndSort();
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        window.openAdminPinModal = function() {
            document.getElementById('adminPinModal').classList.remove('hidden');
            document.getElementById('adminPinInput').value = '';
            document.getElementById('adminPinInput').focus();
        };

        window.closeAdminPinModal = function() {
            document.getElementById('adminPinModal').classList.add('hidden');
        };

        window.handlePinSubmit = async function(e) {
            e.preventDefault();
            const inputPin = document.getElementById('adminPinInput').value.trim();
            let ok = false;
            if (SERVER.on) {
                try {
                    const r = await fetch('api.php?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: inputPin }) });
                    if (r.ok) { ok = true; SERVER.pin = inputPin; }
                    else if (r.status === 403) {                                    // api.php still has the default PIN
                        const j = await r.json().catch(() => ({}));
                        showToast(j.error || 'Set ADMIN_PIN in api.php first.', { error: true });
                        return;
                    }
                    else if (r.status !== 401) ok = (inputPin === adminPin);       // server problem: fall back to the local PIN
                } catch (err) { ok = (inputPin === adminPin); }
            } else {
                ok = (inputPin === adminPin);
            }
            if (ok) {
                isAdminAuthenticated = true;
                closeAdminPinModal();
                showToast('Admin authenticated successfully!');
                switchView('admin');
                refreshSyncBadge();
                if (SERVER.on && SERVER.pin && !SERVER.data) window.serverPush(false);   // first time: publish what is in this browser
            } else {
                showToast('Incorrect PIN! Access Denied.');
                document.getElementById('adminPinInput').value = '';
            }
        };

        window.lockAdmin = function() {
            isAdminAuthenticated = false;
            SERVER.pin = '';
            switchView('client');
            showToast('Admin session locked.');
        };

        window.handlePinChange = function(e) {
            e.preventDefault();
            if (SERVER.on) { showToast('The PIN is stored on your server: edit ADMIN_PIN at the top of api.php.', { error: true }); return; }
            const cur = document.getElementById('currentPinInput').value.trim();
            const newP = document.getElementById('newPinInput').value.trim();

            if (cur !== adminPin) {
                showToast('Current PIN is incorrect!');
                return;
            }
            if (!newP || newP.length < 4) {
                showToast('New PIN must be at least 4 digits!');
                return;
            }

            adminPin = newP;
            localStorage.setItem(STORAGE_PIN, adminPin);
            showToast('Admin PIN updated successfully!');
            document.getElementById('currentPinInput').value = '';
            document.getElementById('newPinInput').value = '';
        };

        function setupHeroSlider() {
            // Find videos marked as featured and sorted by sliderPosition
            featuredVideos = videoData.filter(v => v.featured && v.status === 'published');
            featuredVideos.sort((a, b) => (a.sliderPosition || 99) - (b.sliderPosition || 99));

            if (featuredVideos.length === 0) {
                featuredVideos = videoData.filter(v => v.status === 'published').slice(0, 5);
            } else if (featuredVideos.length > 5) {
                featuredVideos = featuredVideos.slice(0, 5);
            }

            renderHeroSlide();
            renderHeroDots();
            startHeroAutoplay();
        }

        function renderHeroSlide() {
            const container = document.getElementById('heroSliderContainer');
            if (!container || featuredVideos.length === 0) return;

            const video = featuredVideos[currentHeroIndex % featuredVideos.length];
            // the old slide's video must be stopped, not just detached (a detached video keeps downloading/decoding)
            container.querySelectorAll('video.hero-frame').forEach(disposeVideoEl);
            container.innerHTML = `
                <div class="hero-bg absolute inset-0 bg-cover bg-center transition-all duration-700 transform scale-105"></div>
                <div class="hero-blue-light absolute inset-0"></div>
                <div class="absolute inset-0 bg-gradient-to-t from-dark-base via-dark-base/40 to-transparent"></div>
                <div class="absolute inset-0 bg-gradient-to-r from-dark-base via-dark-base/20 to-transparent"></div>
                <div class="absolute bottom-0 left-0 right-0 p-6 sm:p-10 lg:p-14 z-10 space-y-3 max-w-2xl">
                    <div class="flex items-center space-x-2 text-xs font-semibold">
                        <span class="bg-brand-primary text-white py-0.5 px-3 rounded-full uppercase tracking-wider">${escapeHtml(video.category)}</span>
                        <span class="text-gray-300"><i class="fa-solid fa-clock text-brand-accent mr-1"></i>${escapeHtml(video.duration)}</span>
                    </div>
                    <h1 class="text-2xl sm:text-4xl font-black text-white tracking-wide leading-tight drop-shadow-md">${escapeHtml(video.title)}</h1>
                    <p class="text-xs sm:text-sm text-gray-300 line-clamp-2 leading-relaxed">${escapeHtml(video.description)}</p>
                    <div class="pt-2 flex items-center space-x-3">
                        <button onclick="openVideoModal(${video.id})" class="bg-gradient-to-r from-brand-primary to-brand-hover hover:from-brand-hover hover:to-indigo-700 text-white font-semibold text-xs sm:text-sm py-2.5 px-6 rounded-xl shadow-lg flex items-center gap-2 transition group">
                            <i class="fa-solid fa-play text-xs group-hover:scale-125 transition-transform"></i>
                            <span>Watch Now</span>
                        </button>
                    </div>
                </div>
            `;
            const heroBg = container.querySelector('.hero-bg');
            if (heroBg) heroBg.style.backgroundImage = 'url("' + String(getThumb(video)).replace(/"/g, '%22') + '")';

            // real video preview behind the gradients (muted, looping); falls back to the thumbnail on error
            if (heroBg && isPlaceholderThumb(video) && frameSrc(video) && !isVideoModalOpen()) {
                const hv = document.createElement('video');
                hv.className = 'hero-frame absolute inset-0 w-full h-full object-cover pointer-events-none';
                hv.muted = true; hv.loop = true; hv.playsInline = true; hv.preload = 'metadata';   // not 'auto': do not pull the whole file
                hv.style.opacity = '0'; hv.style.transition = 'opacity .7s';
                hv.addEventListener('loadeddata', function () {
                    hv.style.opacity = '1';
                    
                   if (isVideoModalOpen()) return;  // 4K / 2K: show the still frame only
                    const p = hv.play(); if (p && p.catch) p.catch(function () {});
                });
                hv.addEventListener('error', function () { hv.remove(); });
                hv.src = frameSrc(video);
                heroBg.insertAdjacentElement('afterend', hv);
            }
            renderHeroDots();
        }

        function renderHeroDots() {
            const dotsContainer = document.getElementById('heroDots');
            if (!dotsContainer) return;
            dotsContainer.innerHTML = featuredVideos.map((_, i) => `
                <button onclick="goToHeroSlide(${i})" class="w-3 h-3 rounded-full transition-all duration-300 ${i === currentHeroIndex ? 'bg-brand-primary w-8' : 'bg-white/40 hover:bg-white'}"></button>
            `).join('');
        }

        window.goToHeroSlide = function(index) {
            currentHeroIndex = index;
            renderHeroSlide();
            resetHeroAutoplay();
        };

        window.prevHeroSlide = function() {
            currentHeroIndex = (currentHeroIndex - 1 + featuredVideos.length) % featuredVideos.length;
            renderHeroSlide();
            resetHeroAutoplay();
        };

        window.nextHeroSlide = function() {
            currentHeroIndex = (currentHeroIndex + 1) % featuredVideos.length;
            renderHeroSlide();
            resetHeroAutoplay();
        };

        function startHeroAutoplay() {
            clearInterval(heroAutoplayTimer);
            if (isVideoModalOpen()) return;   // never re-render the hero behind a playing video
            heroAutoplayTimer = setInterval(() => {
                if (isVideoModalOpen()) return;
                nextHeroSlide();
            }, 6000);
        }

        function resetHeroAutoplay() {
            startHeroAutoplay();
        }

        function setupCategoriesUI() {
            const categories = ["All", "Latest", "Popular", "Featured", "Action", "Comedy", "Documentary", "Music", "Sports", "Technology"];
            const container = document.getElementById('categoryPillsContainer');
            if (!container) return;

            container.innerHTML = categories.map(cat => `
                <button onclick="filterByCategory('${cat}')" class="category-pill-btn px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition ${cat === activeCategory ? 'bg-brand-primary text-white shadow-lg' : 'bg-dark-card text-gray-300 hover:bg-dark-hover'}">
                    ${cat}
                </button>
            `).join('');
        }

        window.filterByCategory = function(cat) {
            activeCategory = cat;
            currentPage = 1;
            setupCategoriesUI();
            applyFiltersAndSort();
        };

        window.sortVideos = function(criteria) {
            currentSort = criteria;
            document.getElementById('sortDropdown').value = criteria;
            currentPage = 1;
            applyFiltersAndSort();
        };

        window.handleSortChange = function(val) {
            currentSort = val;
            currentPage = 1;
            applyFiltersAndSort();
        };

        window.handleSearchInput = function(e) {
            searchQuery = e.target.value.toLowerCase().trim();
            const clearBtn = document.getElementById('clearSearchBtn');
            if (searchQuery) clearBtn.classList.remove('hidden'); else clearBtn.classList.add('hidden');
            currentPage = 1;
            applyFiltersAndSort();
        };

        window.clearSearch = function() {
            searchQuery = '';
            document.getElementById('searchInput').value = '';
            document.getElementById('mobileSearchInput').value = '';
            document.getElementById('clearSearchBtn').classList.add('hidden');
            currentPage = 1;
            applyFiltersAndSort();
        };

        function applyFiltersAndSort() {
            let result = videoData.filter(v => v.status === 'published');

            if (activeCategory !== 'All') {
                result = result.filter(v => v.category.toLowerCase() === activeCategory.toLowerCase());
            }

            if (searchQuery) {
                result = result.filter(v => 
                    v.title.toLowerCase().includes(searchQuery) ||
                    v.description.toLowerCase().includes(searchQuery) ||
                    v.category.toLowerCase().includes(searchQuery) ||
                    (v.tags && v.tags.some(t => t.toLowerCase().includes(searchQuery)))
                );
            }

            if (currentSort === 'latest') {
                result.sort((a, b) => new Date(b.date) - new Date(a.date));
            } else if (currentSort === 'popular') {
                result.sort((a, b) => b.views - a.views);
            } else if (currentSort === 'az') {
                result.sort((a, b) => a.title.localeCompare(b.title));
            } else if (currentSort === 'duration') {
                result.sort((a, b) => b.duration.localeCompare(a.duration));
            }

            filteredVideos = result;
            renderVideoGrid();
            setupHeroSlider();
        }

        function renderVideoGrid() {
            const grid = document.getElementById('videoGrid');
            if (!grid) return;

            const visibleCount = currentPage * pageSize;
            const displayedSlice = filteredVideos.slice(0, visibleCount);

            document.getElementById('displayedCountText').textContent = displayedSlice.length;
            document.getElementById('totalMatchCountText').textContent = filteredVideos.length;

            const badge = document.getElementById('activeCategoryBadge');
            if (activeCategory !== 'All' || searchQuery) badge.classList.remove('hidden');
            else badge.classList.add('hidden');

            if (displayedSlice.length === 0) {
                grid.innerHTML = `
                    <div class="col-span-full py-16 text-center space-y-3 bg-dark-surface rounded-2xl border border-dark-border">
                        <i class="fa-solid fa-film text-4xl text-gray-500"></i>
                        <h3 class="text-base font-bold text-white">No videos matched your criteria</h3>
                        <p class="text-xs text-gray-400">Try adjusting your search query or selecting another category.</p>
                        <button onclick="filterByCategory('All'); clearSearch();" class="bg-brand-primary text-white text-xs px-4 py-2 rounded-xl">Clear Filters</button>
                    </div>
                `;
                document.getElementById('loadMoreBtn').classList.add('hidden');
                return;
            }

            const contentAdPositions = new Set(getActiveAdSlots().map(adPlacementOf).filter(p => /^content_\d+$/.test(p)));
            grid.innerHTML = displayedSlice.map((v, index) => {
                let cardHtml = `
                    <div id="video-card-${v.id}" onclick="openVideoModal(${v.id})" onmouseenter="cardPreviewPlay(this)" onmouseleave="cardPreviewStop(this)" class="glass-card rounded-2xl overflow-hidden border border-dark-border hover:border-brand-primary/50 transition-all duration-300 hover:-translate-y-1.5 cursor-pointer group flex flex-col justify-between">
                        <div>
                            <div class="relative aspect-video overflow-hidden bg-dark-card">
                                <img src="${escapeHtml(getThumb(v))}" alt="${escapeHtml(v.title)}" onerror="thumbFallback(this)" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
                                ${isPlaceholderThumb(v) && frameSrc(v) ? `<video class="card-frame absolute inset-0 w-full h-full object-cover pointer-events-none" data-src="${escapeHtml(frameSrc(v))}" muted loop playsinline preload="metadata" style="opacity:0;transition:opacity .4s" onloadeddata="this.dataset.ready='1';this.style.opacity=1" onerror="this.remove()"></video>` : ''}
                                <div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                    <div class="w-12 h-12 rounded-full bg-brand-primary text-white flex items-center justify-center shadow-lg transform group-hover:scale-110 transition-transform">
                                        <i class="fa-solid fa-play ml-0.5"></i>
                                    </div>
                                </div>
                                <span class="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-semibold px-2 py-0.5 rounded backdrop-blur-sm">${escapeHtml(v.duration)}</span>
                                <span class="absolute top-2 left-2 bg-brand-primary/90 text-white text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">${escapeHtml(v.category)}</span>
                                ${v.allowDownload !== false ? `<button type="button" onclick="event.stopPropagation(); downloadVideoById(${v.id})" title="Download video" class="absolute top-2 right-2 z-10 w-8 h-8 rounded-full bg-black/60 hover:bg-emerald-600 text-white flex items-center justify-center backdrop-blur-sm transition"><i id="dl-icon-${v.id}" class="fa-solid fa-download text-xs"></i></button>` : ''}
                            </div>
                            <div class="p-4 space-y-1.5">
                                <h3 class="text-sm font-bold text-white group-hover:text-brand-primary transition-colors line-clamp-2">${escapeHtml(v.title)}</h3>
                                <p class="text-xs text-gray-400 line-clamp-2">${escapeHtml(v.description)}</p>
                            </div>
                        </div>
                        <div class="px-4 pb-4 pt-1 flex items-center justify-between text-[11px] text-gray-400 border-t border-dark-border/40 mt-2">
                            <span><i class="fa-solid fa-eye text-brand-accent mr-1"></i>${Number(v.views || 0).toLocaleString()} views</span>
                            <span>${escapeHtml(v.date)}</span>
                        </div>
                    </div>
                `;

                // real ad slots placed "after Nth video"
                const adPos = 'content_' + (index + 1);
                if (contentAdPositions.has(adPos)) {
                    cardHtml += `
                        <div class="ad-incontent col-span-full my-4 text-center" data-ad-wrap="${adPos}">
                            <div class="text-[10px] uppercase tracking-widest text-gray-500 mb-1">Advertisement</div>
                            <div class="flex flex-col items-center gap-3 overflow-hidden" data-ad-host="${adPos}"></div>
                        </div>
                    `;
                }

                return cardHtml;
            }).join('');
            mountContentAds();
            observeCardFrames();

            const loadMoreBtn = document.getElementById('loadMoreBtn');
            const noMoreMsg = document.getElementById('noMoreVideosMsg');

            if (visibleCount < filteredVideos.length) {
                loadMoreBtn.classList.remove('hidden');
                noMoreMsg.classList.add('hidden');
            } else {
                loadMoreBtn.classList.add('hidden');
                if (filteredVideos.length > 0) noMoreMsg.classList.remove('hidden');
            }
        }

        window.loadMoreVideos = function() {
            currentPage++;
            renderVideoGrid();
        };

        window.openVideoModal = function(id) {
            const video = VideoService.getById(id);
            if (!video) return;

            activeModalVideoId = video.id;
            video.views += 1;
            VideoService.update(video.id, { views: video.views });

            document.getElementById('modalVideoTitle').textContent = video.title;
            document.getElementById('modalVideoDate').textContent = `Uploaded ${video.date}`;
            document.getElementById('modalVideoDescription').textContent = video.description;
            document.getElementById('modalCategoryBadge').textContent = video.category;
            document.getElementById('modalViewsText').textContent = `${video.views.toLocaleString()} views`;

            releaseBackgroundVideos();   // hero + card previews stop, so the player has the device to itself

            const player = document.getElementById('mainVideoPlayer');
            const source = document.getElementById('videoSource');
            source.src = video.videoUrl;
            if (isPlaceholderThumb(video)) player.removeAttribute('poster'); else player.setAttribute('poster', getThumb(video));
            player.load();
            player.play().catch(() => {});
            startPlayerGate();

            const allowed = canDownloadVideo(video);
            document.getElementById('modalDownloadBtn').classList.toggle('hidden', !allowed);
            document.getElementById('modalDownloadBtn').disabled = !!downloadsInFlight[video.id];
            document.getElementById('modalDownloadProgress').classList.add('hidden');
            document.getElementById('modalDownloadsText').textContent = (allowed && video.downloads) ? `\u00b7 ${Number(video.downloads).toLocaleString()} downloads` : '';
            if (allowed) player.removeAttribute('controlsList'); else player.setAttribute('controlsList', 'nodownload');

            document.getElementById('videoModal').classList.remove('hidden');
        };

        window.closeVideoModal = function() {
            const player = document.getElementById('mainVideoPlayer');
            player.pause();
            // let go of the file: stops buffering and frees the decoder (matters for big / 4K videos)
            document.getElementById('videoSource').removeAttribute('src');
            player.removeAttribute('src');
            player.load();
            resetPlayerGate();
            try { if (location.search.includes('v=')) history.replaceState(null, '', location.pathname); } catch (e) {}
            document.getElementById('videoModal').classList.add('hidden');
            restoreBackgroundVideos();
        };

        window.playPrevModalVideo = function() {
            const idx = filteredVideos.findIndex(v => v.id === activeModalVideoId);
            if (idx > 0) openVideoModal(filteredVideos[idx - 1].id);
        };

        window.playNextModalVideo = function() {
            const idx = filteredVideos.findIndex(v => v.id === activeModalVideoId);
            if (idx >= 0 && idx < filteredVideos.length - 1) openVideoModal(filteredVideos[idx + 1].id);
        };

        // ===== Share panel =====
        function appBaseUrl() { const u = new URL(location.href); u.search = ''; u.hash = ''; return u; }

        // With the PHP files uploaded the link goes through share.php, which gives social apps this video's own preview card.
        function getShareUrl(v) {
            const base = appBaseUrl();
            return SERVER.on ? new URL('share.php', base).href + '?v=' + v.id : base.href + '?v=' + v.id;
        }

        function shareImageUrl(v) {
            const t = isPlaceholderThumb(v) ? '' : String(v.thumbnail || '');
            if (t) { try { const u = new URL(t, location.href); if (/^https?:$/.test(u.protocol)) return u.href; } catch (e) {} }
            return SERVER.on ? new URL('og-image.php', appBaseUrl()).href + '?v=' + v.id : '';
        }

        let shareVideoId = null;
        const SHARE_PLATFORMS = [
            { name: 'Facebook',  icon: 'fa-brands fa-facebook-f',   bg: '#1877F2', link: (u, t) => 'https://www.facebook.com/sharer/sharer.php?u=' + u },
            { name: 'WhatsApp',  icon: 'fa-brands fa-whatsapp',     bg: '#25D366', link: (u, t) => 'https://wa.me/?text=' + t + '%20' + u },
            { name: 'Telegram',  icon: 'fa-brands fa-telegram',     bg: '#229ED9', link: (u, t) => 'https://t.me/share/url?url=' + u + '&text=' + t },
            { name: 'X',         icon: 'fa-brands fa-x-twitter',    bg: '#111111', link: (u, t) => 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t },
            { name: 'LinkedIn',  icon: 'fa-brands fa-linkedin-in',  bg: '#0A66C2', link: (u, t) => 'https://www.linkedin.com/sharing/share-offsite/?url=' + u },
            { name: 'Reddit',    icon: 'fa-brands fa-reddit-alien', bg: '#FF4500', link: (u, t) => 'https://www.reddit.com/submit?url=' + u + '&title=' + t },
            { name: 'Pinterest', icon: 'fa-brands fa-pinterest-p',  bg: '#E60023', needsImage: true, link: (u, t, m) => 'https://www.pinterest.com/pin/create/button/?url=' + u + '&media=' + m + '&description=' + t },
            { name: 'Email',     icon: 'fa-solid fa-envelope',      bg: '#6B7280', same: true, link: (u, t) => 'mailto:?subject=' + t + '&body=' + t + '%0A%0A' + u }
        ];

        window.openSharePanel = function (id) {
            const v = VideoService.getById(id != null ? id : activeModalVideoId);
            if (!v) return;
            shareVideoId = v.id;
            const url = getShareUrl(v);
            const img = shareImageUrl(v);
            const eu = encodeURIComponent(url), et = encodeURIComponent(v.title), em = encodeURIComponent(img);

            // preview of THIS video: its thumbnail, or a real frame of the video itself; click to play
            const pImg = document.getElementById('sharePreviewImg'), pVid = document.getElementById('sharePreviewVideo');
            pVid.pause(); pVid.removeAttribute('src'); pVid.load(); pVid.style.opacity = '0';
            pImg.alt = v.title; pImg.onerror = function () { thumbFallback(pImg); }; pImg.src = getThumb(v);
            document.getElementById('sharePreviewPlay').classList.remove('hidden');
            document.getElementById('sharePreviewDuration').textContent = v.duration || '';
            document.getElementById('sharePreviewTitle').textContent = v.title;
            document.getElementById('sharePreviewMeta').textContent = [v.category, v.date].filter(Boolean).join(' · ');
            if (isPlaceholderThumb(v) && frameSrc(v)) {
                pVid.onloadeddata = function () { pVid.style.opacity = '1'; };
                pVid.onerror = function () { pVid.style.opacity = '0'; };
                pVid.preload = 'metadata';
                pVid.src = frameSrc(v);
            }

            const note = document.getElementById('shareNote');
            let msg = '', cls = '';
            if (isLocalOnlyVideo(v)) {
                msg = 'This video file is stored only in this browser, so other people cannot open the link. Host the file and use its URL to share it.';
                cls = 'bg-amber-500/10 text-amber-300 border-amber-500/30';
            } else if (!SERVER.on) {
                msg = 'The link opens this video on your site. For a preview card (thumbnail + title) in WhatsApp, Facebook, Telegram and others, upload api.php, share.php and og-image.php to your hosting.';
                cls = 'bg-sky-500/10 text-sky-300 border-sky-500/30';
            }
            note.className = 'text-[11px] leading-relaxed rounded-lg border px-3 py-2 ' + (msg ? cls : 'hidden');
            note.textContent = msg;

            document.getElementById('shareLinkInput').value = url;

            const box = document.getElementById('shareIcons');
            box.innerHTML = '';
            const tile = (el, icon, bg, label) => {
                el.className = 'flex flex-col items-center gap-1.5 group cursor-pointer';
                el.innerHTML = '<span class="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg shadow transition group-hover:scale-110" style="background:' + bg + ';border:1px solid rgba(255,255,255,.12)"><i class="' + icon + '"></i></span><span class="text-[10px] text-gray-300 font-medium"></span>';
                el.lastElementChild.textContent = label;
                box.appendChild(el);
            };
            SHARE_PLATFORMS.forEach(p => {
                if (p.needsImage && !img) return;
                const a = document.createElement('a');
                a.href = p.link(eu, et, em);
                if (!p.same) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
                a.title = 'Share on ' + p.name;
                tile(a, p.icon, p.bg, p.name);
            });
            if (navigator.share) {
                const b = document.createElement('button'); b.type = 'button';
                b.onclick = function () { navigator.share({ title: v.title, text: v.title, url: url }).catch(() => {}); };
                tile(b, 'fa-solid fa-ellipsis', '#374151', 'More');
            }
            const c = document.createElement('button'); c.type = 'button';
            c.onclick = copyShareLink;
            tile(c, 'fa-solid fa-link', '#6366F1', 'Copy link');

            document.getElementById('shareModal').classList.remove('hidden');
        };

        window.closeSharePanel = function () {
            const pVid = document.getElementById('sharePreviewVideo');
            disposeVideoEl(pVid);
            document.getElementById('shareModal').classList.add('hidden');
        };

        window.toggleSharePreview = function () {
            const v = VideoService.getById(shareVideoId);
            const pVid = document.getElementById('sharePreviewVideo');
            if (!v) return;
            if (!pVid.getAttribute('src')) { pVid.preload = 'auto'; pVid.src = String(v.videoUrl || ''); }
            pVid.onloadeddata = null;
            pVid.style.opacity = '1';
            pVid.muted = false;
            pVid.loop = false;
            pVid.controls = true;
            document.getElementById('sharePreviewPlay').classList.add('hidden');
            const p = pVid.play(); if (p && p.catch) p.catch(() => { pVid.muted = true; pVid.play().catch(() => {}); });
        };

        window.copyShareLink = async function () {
            const text = document.getElementById('shareLinkInput').value;
            try { await navigator.clipboard.writeText(text); }
            catch (e) {
                const i = document.getElementById('shareLinkInput'); i.select();
                try { document.execCommand('copy'); } catch (e2) {}
            }
            showToast('Share link copied!');
        };

        // keep the old name working
        window.shareCurrentVideo = function () { openSharePanel(); };

        window.switchUploadTab = function(mode) {
            selectedUploadSourceMode = mode;
            const tabFile = document.getElementById('tabSourceFile');
            const tabUrl = document.getElementById('tabSourceUrl');
            const fileContainer = document.getElementById('fileUploadContainer');
            const urlContainer = document.getElementById('urlUploadContainer');

            if (mode === 'file') {
                tabFile.className = "py-2 px-3 rounded-lg font-semibold bg-brand-primary text-white transition";
                tabUrl.className = "py-2 px-3 rounded-lg font-semibold text-gray-400 hover:text-white transition";
                fileContainer.classList.remove('hidden');
                urlContainer.classList.add('hidden');
            } else {
                tabUrl.className = "py-2 px-3 rounded-lg font-semibold bg-brand-primary text-white transition";
                tabFile.className = "py-2 px-3 rounded-lg font-semibold text-gray-400 hover:text-white transition";
                urlContainer.classList.remove('hidden');
                fileContainer.classList.add('hidden');
            }
        };

        window.handleFileSelect = function(e) {
            const file = e.target.files && e.target.files[0];
            if (file) {
                const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
                document.getElementById('videoFileLabel').textContent = `Selected: ${file.name} (${sizeMB} MB)`;

                const reg = registerLocalFile(file);   // not revoked: a saved video may still use the previous URL
                currentSelectedFileBlob = reg.url;
                currentFileSaved = reg.saved;

                const tempVideo = document.createElement('video');
                tempVideo.preload = 'metadata';
                tempVideo.src = currentSelectedFileBlob;
                tempVideo.onerror = function() { disposeVideoEl(tempVideo); };
                tempVideo.onloadedmetadata = function() {
                    if (tempVideo.duration && !isNaN(tempVideo.duration)) {
                        const mins = Math.floor(tempVideo.duration / 60);
                        const secs = Math.floor(tempVideo.duration % 60);
                        document.getElementById('uploadDuration').value = `${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
                    }
                    tempVideo.onloadedmetadata = null; tempVideo.onerror = null;
                    disposeVideoEl(tempVideo);   // a 4K file must not stay open in a hidden player
                };
            }
        };

        // Videos currently in the homepage slideshow, in slide order (same rule as setupHeroSlider)
        function getSlideshowList(excludeId) {
            return videoData
                .filter(v => v.featured && v.status === 'published' && v.id !== excludeId)
                .sort((a, b) => (a.sliderPosition || 99) - (b.sliderPosition || 99))
                .slice(0, 5);
        }

        window.refreshUploadSlidePositions = function() {
            const list = getSlideshowList();
            const sel = document.getElementById('uploadSliderPosition');
            if (!sel) return;
            let html = '';
            for (let n = 1; n <= 5; n++) {
                const cur = list[n - 1];
                const label = cur ? `Slide ${n} \u2014 now: ${cur.title}` : `Slide ${n} \u2014 empty`;
                html += `<option value="${n}">${escapeHtml(label.length > 70 ? label.slice(0, 67) + '...' : label)}</option>`;
            }
            sel.innerHTML = html;
            // default: first empty slide, otherwise slide 1
            sel.value = String(Math.min(list.length + 1, 5));
        };

        window.toggleUploadSlideshow = function() {
            const on = document.getElementById('uploadFeatured').checked;
            document.getElementById('uploadSlidePosWrap').classList.toggle('hidden', !on);
            if (on) refreshUploadSlidePositions();
        };

        // Put a video into the slideshow at `pos`; later slides move down one place, a 6th slide drops out.
        function placeInSlideshow(id, pos) {
            const item = videoData.find(v => v.id === id);
            if (!item) return 0;
            const ordered = getSlideshowList(id);
            ordered.splice(Math.min(Math.max(pos, 1) - 1, ordered.length), 0, item);
            ordered.forEach((v, i) => {
                if (i < 5) { v.featured = true; v.sliderPosition = i + 1; }
                else { v.featured = false; v.sliderPosition = null; }
            });
            VideoService.save(videoData);
            return ordered.indexOf(item) + 1;
        }

        window.openUploadModal = function() {
            document.getElementById('uploadModal').classList.remove('hidden');
            document.getElementById('uploadFeatured').checked = false;
            document.getElementById('uploadSlidePosWrap').classList.add('hidden');
        };

        window.closeUploadModal = function() {
            document.getElementById('uploadModal').classList.add('hidden');
            document.getElementById('uploadForm').reset();
            document.getElementById('uploadProgressContainer').classList.add('hidden');
            document.getElementById('uploadProgressBar').style.width = '0%';
            document.getElementById('videoFileLabel').textContent = "Click or drag video file here to attach";
            document.getElementById('uploadSlidePosWrap').classList.add('hidden');
            currentSelectedFileBlob = null;   // do not reuse the previous file for the next upload
            currentFileSaved = null;
            switchUploadTab('file');
        };

        window.handleUploadSubmit = async function(e) {
            e.preventDefault();

            const title = document.getElementById('uploadTitle').value.trim();
            const category = document.getElementById('uploadCategory').value;
            const duration = document.getElementById('uploadDuration').value.trim() || '03:30';
            const description = document.getElementById('uploadDescription').value.trim() || 'User uploaded video content.';
            const customThumb = document.getElementById('uploadThumbnailUrl').value.trim();
            const urlInput = document.getElementById('uploadVideoUrl').value.trim();

            let finalVideoUrl = '';
            if (selectedUploadSourceMode === 'file') {
                if (!currentSelectedFileBlob) { showToast('Please choose a video file first.', { error: true }); return; }
                finalVideoUrl = currentSelectedFileBlob;
            } else {
                if (!urlInput) { showToast('Please paste a video URL first.', { error: true }); return; }
                finalVideoUrl = urlInput;
            }
            const wantSlideshow = document.getElementById('uploadFeatured').checked;
            const slidePos = parseInt(document.getElementById('uploadSliderPosition').value, 10) || 1;

            const progressContainer = document.getElementById('uploadProgressContainer');
            const progressBar = document.getElementById('uploadProgressBar');
            const percentText = document.getElementById('uploadPercentText');
            const submitBtn = document.getElementById('submitUploadBtn');

            progressContainer.classList.remove('hidden');
            submitBtn.disabled = true;

            for (let p = 0; p <= 100; p += 25) {
                progressBar.style.width = `${p}%`;
                percentText.textContent = `${p}%`;
                await new Promise(r => setTimeout(r, 60));
            }

            let thumbnail = customThumb;
            if (!thumbnail) {
                const hue = Math.floor(Math.random() * 360);
                thumbnail = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'><rect width='640' height='360' fill='hsl(${hue}, 40%, 15%)'/><path d='M300 150 L350 180 L300 210 Z' fill='%236366F1'/><text x='320' y='320' font-family='Arial' font-size='22' font-weight='bold' fill='%23FFFFFF' text-anchor='middle'>${encodeURIComponent(title.substring(0, 22))}</text></svg>`;
            }

            // make sure the file is stored for after a refresh before we save the record
            let fileSaved = true;
            if (selectedUploadSourceMode === 'file' && currentFileSaved) fileSaved = await currentFileSaved;

            const newVideo = VideoService.add({
                title,
                category,
                duration,
                description,
                thumbnail,
                videoUrl: finalVideoUrl,
                views: 1,
                date: new Date().toISOString().split('T')[0],
                status: 'published',
                featured: false,
                sliderPosition: null,
                tags: [category.toLowerCase()],
                allowDownload: document.getElementById('uploadAllowDownload').checked,
                downloads: 0
            });

            let slideNo = 0;
            if (wantSlideshow) slideNo = placeInSlideshow(newVideo.id, slidePos);

            submitBtn.disabled = false;
            closeUploadModal();
            applyFiltersAndSort();
            if (selectedUploadSourceMode === 'file' && !fileSaved) {
                showToast('Published, but this file could not be stored. It will stop playing after a refresh.', { error: true });
            } else {
                showToast(slideNo ? `Video published and added to the slideshow as slide ${slideNo}!` : 'Video published successfully!');
            }
            setTimeout(() => { openVideoModal(newVideo.id); }, 300);
        };

        window.switchAdminTab = function(tabName) {
            document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.add('hidden'));
            document.querySelectorAll('.admin-tab-btn').forEach(el => el.className = 'admin-tab-btn py-2 px-4 rounded-xl font-semibold text-xs transition text-gray-400 hover:text-white hover:bg-dark-card');

            if (tabName === 'dashboard') {
                document.getElementById('adminTabDashboard').classList.remove('hidden');
                document.getElementById('tabBtnDashboard').className = 'admin-tab-btn py-2 px-4 rounded-xl font-semibold text-xs transition bg-brand-primary text-white';
                renderAdminDashboard();
            } else if (tabName === 'videos') {
                document.getElementById('adminTabVideos').classList.remove('hidden');
                document.getElementById('tabBtnVideos').className = 'admin-tab-btn py-2 px-4 rounded-xl font-semibold text-xs transition bg-brand-primary text-white';
                renderAdminTable();
            } else if (tabName === 'ads') {
                document.getElementById('adminTabAds').classList.remove('hidden');
                document.getElementById('tabBtnAds').className = 'admin-tab-btn py-2 px-4 rounded-xl font-semibold text-xs transition bg-brand-primary text-white';
                renderAdminAdsTable();
            } else if (tabName === 'settings') {
                document.getElementById('adminTabSettings').classList.remove('hidden');
                document.getElementById('tabBtnSettings').className = 'admin-tab-btn py-2 px-4 rounded-xl font-semibold text-xs transition bg-brand-primary text-white';
            }
        };

        function renderAdminDashboard() {
            document.getElementById('statTotalVideos').textContent = videoData.length;
            document.getElementById('statPublishedVideos').textContent = videoData.filter(v => v.status === 'published').length;
            document.getElementById('statDraftVideos').textContent = videoData.filter(v => v.status !== 'published').length;

            const totalViews = videoData.reduce((acc, curr) => acc + (curr.views || 0), 0);
            document.getElementById('statTotalViews').textContent = totalViews > 1000000 ? `${(totalViews/1000000).toFixed(1)}M` : `${(totalViews/1000).toFixed(1)}K`;

            document.getElementById('statTotalAds').textContent = adSlots.length;
            document.getElementById('statActiveAds').textContent = adSlots.filter(a => a.enabled).length;
            document.getElementById('globalAdsToggle').checked = globalAdsEnabled;
        }

        function videoHostLabel(v) {
            const u = String(v.videoUrl || '');
            if (!u) return 'no video';
            if (isLocalOnlyVideo(v)) return 'local file';
            try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'own hosting'; }
        }

        // hover a thumbnail in Video Management: play a muted live preview of that exact video (loaded only on hover)
        window.adminThumbPlay = function (box, id) {
            const v = VideoService.getById(id);
            if (!v || !frameSrc(v)) return;
            let vid = box.querySelector('video');
            if (!vid) {
                vid = document.createElement('video');
                vid.muted = true; vid.loop = true; vid.playsInline = true; vid.preload = 'auto';
                vid.className = 'absolute inset-0 w-full h-full object-cover pointer-events-none';
                vid.style.cssText = 'opacity:0;transition:opacity .3s';
                vid.addEventListener('loadeddata', function () { vid.style.opacity = '1'; if (vid.dataset.hover === '1' && !isHeavyForPreview(vid)) vid.play().catch(() => {}); });
                vid.addEventListener('error', function () { vid.remove(); });
                vid.src = frameSrc(v);
                box.insertBefore(vid, box.querySelector('span'));
            }
            vid.dataset.hover = '1';
            if (vid.readyState >= 2 && !isHeavyForPreview(vid)) vid.play().catch(() => {});
        };
        window.adminThumbStop = function (box) {
            const vid = box.querySelector('video');
            if (!vid) return;
            vid.dataset.hover = '0';
            disposeVideoEl(vid);   // do not keep a big file loaded for every row that was hovered
            vid.remove();
        };

        // Edit modal: take the thumbnail from a frame of the video itself
        window.captureEditThumbnail = function () {
            const url = document.getElementById('editVideoUrl').value.trim();
            const id = document.getElementById('editVideoId').value;
            if (!url || url.startsWith('idb:')) { showToast('Add a video first, then capture.', { error: true }); return; }
            const btn = document.getElementById('editCaptureThumbBtn');
            const label = '<i class="fa-solid fa-camera"></i> Capture from video';
            btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Capturing...';
            let finished = false;
            const end = (msg, isErr) => { finished = true; clearTimeout(timer); btn.disabled = false; btn.innerHTML = label; try { disposeVideoEl(vid); } catch (_) {} if (msg) showToast(msg, { error: !!isErr }); };
            const corsMsg = 'Cannot take a snapshot from this video (its host does not allow it). Paste a thumbnail image URL instead.';
            const vid = document.createElement('video');
            vid.muted = true; vid.playsInline = true; vid.preload = 'auto';
            if (!url.startsWith('blob:')) vid.crossOrigin = 'anonymous';
            const timer = setTimeout(() => { if (!finished) end('Capture timed out. Try again or paste a thumbnail URL.', true); }, 20000);
            vid.addEventListener('error', () => { if (!finished) end(corsMsg, true); });
            vid.addEventListener('loadedmetadata', () => {
                try { vid.currentTime = Math.max(0.1, Math.min(1, (vid.duration || 2) / 2)); } catch (e) {}
            });
            vid.addEventListener('seeked', async () => {
                if (finished) return;
                try {
                    const w = 640, h = Math.max(1, Math.round(w * (vid.videoHeight || 360) / (vid.videoWidth || 640)));
                    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
                    cv.getContext('2d').drawImage(vid, 0, 0, w, h);
                    let result = cv.toDataURL('image/jpeg', 0.82);          // throws if the host blocks it
                    if (SERVER.on && SERVER.pin) {
                        const saved = await serverUploadThumb(id, result);
                        if (!saved) { end('The server could not save the image (check that thumbs/ is writable).', true); return; }
                        result = saved;
                    }
                    const input = document.getElementById('editThumbnailUrl');
                    input.value = result;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    end('Thumbnail captured from the video. Press Save Changes.');
                } catch (e) { end(corsMsg, true); }
            }, { once: true });
            vid.src = url;
        };

        window.renderAdminTable = function() {
            const tbody = document.getElementById('adminTableBody');
            if (!tbody) return;

            const search = (document.getElementById('adminTableSearch').value || '').toLowerCase().trim();
            const statusFilter = document.getElementById('adminStatusFilter').value;

            let list = videoData;
            if (statusFilter !== 'all') {
                list = list.filter(v => v.status === statusFilter);
            }
            if (search) {
                list = list.filter(v => v.title.toLowerCase().includes(search) || v.category.toLowerCase().includes(search));
            }

            tbody.innerHTML = list.slice(0, 50).map(v => `
                <tr class="hover:bg-dark-hover/50 transition">
                    <td class="py-2.5 px-4">
                        <div class="relative w-28 h-16 rounded-md overflow-hidden border border-dark-border bg-black cursor-pointer group" title="${escapeHtml(v.title)} (click to play, hover for a live preview)" onclick="openVideoModal(${v.id})" onmouseenter="adminThumbPlay(this, ${v.id})" onmouseleave="adminThumbStop(this)">
                            <img src="${escapeHtml(getThumb(v))}" alt="${escapeHtml(v.title)}" onerror="thumbFallback(this)" class="w-full h-full object-cover">
                            <span class="absolute top-0.5 left-0.5 bg-black/75 text-white text-[9px] font-bold px-1.5 py-px rounded">#${v.id}</span>
                            <span class="absolute bottom-0.5 right-0.5 bg-black/75 text-white text-[9px] font-semibold px-1 py-px rounded">${escapeHtml(v.duration || '')}</span>
                            <span class="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 group-hover:opacity-100 transition pointer-events-none"><i class="fa-solid fa-play text-white text-sm"></i></span>
                        </div>
                    </td>
                    <td class="py-2.5 px-4 max-w-xs">
                        <div class="font-semibold text-white truncate" title="${escapeHtml(v.title)}">${escapeHtml(v.title)}</div>
                        <div class="text-[10px] text-gray-500 truncate">ID ${v.id} \u00b7 ${escapeHtml(videoHostLabel(v))}</div>
                    </td>
                    <td class="py-2.5 px-4"><span class="bg-dark-card px-2 py-0.5 rounded border border-dark-border text-brand-accent">${escapeHtml(v.category)}</span></td>
                    <td class="py-2.5 px-4">${Number(v.views || 0).toLocaleString()}</td>
                    <td class="py-2.5 px-4">${escapeHtml(v.duration)}</td>
                    <td class="py-2.5 px-4">${escapeHtml(v.date)}</td>
                    <td class="py-2.5 px-4">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${v.status === 'published' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}">
                            ${v.status}
                        </span>
                    </td>
                    <td class="py-2.5 px-4 text-right space-x-1">
                        <button onclick="openEditModal(${v.id})" class="p-1.5 rounded hover:bg-dark-card text-amber-400" title="Edit Video"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="openVideoModal(${v.id})" class="p-1.5 rounded hover:bg-dark-card text-brand-accent" title="Preview Video"><i class="fa-solid fa-eye"></i></button>
                        <button onclick="openSharePanel(${v.id})" class="p-1.5 rounded hover:bg-dark-card text-sky-400" title="Share Video"><i class="fa-solid fa-share-nodes"></i></button>
                        <button onclick="duplicateVideoAction(${v.id})" class="p-1.5 rounded hover:bg-dark-card text-indigo-400" title="Duplicate Video"><i class="fa-solid fa-copy"></i></button>
                        <button onclick="toggleVideoStatusAction(${v.id})" class="p-1.5 rounded hover:bg-dark-card ${v.status === 'published' ? 'text-emerald-400' : 'text-gray-400'}" title="Toggle Publish Status"><i class="fa-solid fa-power-off"></i></button>
                        <button onclick="promptDeleteVideo(${v.id})" class="p-1.5 rounded hover:bg-dark-card text-red-400" title="Delete Video"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        };

        window.openEditModal = function(id) {
            const video = VideoService.getById(id);
            if (!video) return;

            document.getElementById('editVideoId').value = video.id;
            document.getElementById('editTitle').value = video.title;
            document.getElementById('editCategory').value = video.category;
            document.getElementById('editStatus').value = video.status;
            document.getElementById('editDuration').value = video.duration;
            document.getElementById('editViews').value = video.views;
            document.getElementById('editTags').value = video.tags ? video.tags.join(', ') : '';
            document.getElementById('editThumbnailUrl').value = video.thumbnail;
            document.getElementById('editVideoUrl').value = video.videoUrl;
            document.getElementById('editDescription').value = video.description;
            document.getElementById('editFeatured').checked = !!video.featured;
            document.getElementById('editAllowDownload').checked = video.allowDownload !== false;
            document.getElementById('editSliderPosition').value = video.sliderPosition || 1;

            document.getElementById('editVideoFileInput').value = '';
            setEditPreviewPoster(video.thumbnail);
            updateEditPreview(video.videoUrl);
            document.getElementById('editCardDesc').classList.remove('expanded');
            renderEditDetails();

            document.getElementById('editModal').classList.remove('hidden');
        };

        window.closeEditModal = function() {
            document.getElementById('editModal').classList.add('hidden');
            // stop playback and release the preview
            updateEditPreview('');
            document.getElementById('editVideoFileInput').value = '';
        };

        window.handleEditSubmit = function(e) {
            e.preventDefault();
            const id = document.getElementById('editVideoId').value;
            const title = document.getElementById('editTitle').value.trim();
            const videoUrl = document.getElementById('editVideoUrl').value.trim();

            if (!title) {
                showToast('Please enter a video title.', { error: true });
                document.getElementById('editTitle').focus();
                return;
            }
            if (!videoUrl) {
                showToast('Please add a video URL or choose a file.', { error: true });
                document.getElementById('editVideoUrl').focus();
                return;
            }

            const featured = document.getElementById('editFeatured').checked;
            const tags = [...new Set(
                document.getElementById('editTags').value.split(',').map(t => t.trim()).filter(Boolean)
            )];

            const updated = {
                title,
                category: document.getElementById('editCategory').value,
                status: document.getElementById('editStatus').value,
                duration: normalizeDuration(document.getElementById('editDuration').value),
                views: Math.max(0, parseInt(document.getElementById('editViews').value, 10) || 0),
                tags,
                thumbnail: document.getElementById('editThumbnailUrl').value.trim(),
                videoUrl,
                description: document.getElementById('editDescription').value.trim(),
                allowDownload: document.getElementById('editAllowDownload').checked,
                featured,
                // a video that is not featured should not keep a hero slot
                sliderPosition: featured ? (parseInt(document.getElementById('editSliderPosition').value, 10) || 1) : null
            };

            const saved = VideoService.update(id, updated);
            closeEditModal();
            renderAdminTable();
            renderAdminDashboard();
            applyFiltersAndSort();

            if (!saved) {
                showToast('Could not save: this video no longer exists.', { error: true });
                return;
            }

            const shortTitle = saved.title.length > 38 ? saved.title.slice(0, 38) + '\u2026' : saved.title;
            if (saved.status === 'published') {
                showToast(`Saved. "${shortTitle}" is live on the homepage.`, {
                    label: 'View card',
                    onClick: () => showVideoOnSite(saved.id)
                });
            } else {
                showToast(`Saved as ${saved.status}. It is hidden from the homepage.`);
            }
        };

        // Jump to the homepage and highlight a video's card
        window.showVideoOnSite = function(id) {
            id = parseInt(id, 10);
            activeCategory = 'All';
            searchQuery = '';
            ['searchInput', 'mobileSearchInput'].forEach(inputId => {
                const el = document.getElementById(inputId);
                if (el) el.value = '';
            });
            const clearBtn = document.getElementById('clearSearchBtn');
            if (clearBtn) clearBtn.classList.add('hidden');
            setupCategoriesUI();
            currentPage = 1;

            switchView('client');

            const idx = filteredVideos.findIndex(v => v.id === id);
            if (idx === -1) return;

            // make sure the card is inside the loaded page range
            currentPage = Math.max(1, Math.ceil((idx + 1) / pageSize));
            renderVideoGrid();

            setTimeout(() => {
                const card = document.getElementById('video-card-' + id);
                if (!card) return;
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('card-flash');
                setTimeout(() => card.classList.remove('card-flash'), 2500);
            }, 250);
        };

// ===== Edit Modal: Video Preview (homepage-style card with the player inside) =====
(function () {
    const $ = (id) => document.getElementById(id);
    const video = $('editVideoPreview');
    const thumbLayer = $('editCardThumbLayer');
    const thumbImg = $('editCardThumb');

    const STATES = {
        empty:   'No video',
        loading: 'Loading',
        ready:   'Ready',
        error:   'Error'
    };
    const STATUS_LABELS = { published: 'Published', draft: 'Draft', private: 'Private' };
    const DASH = '\u2014';

    let currentState = 'empty';
    let currentFileSize = null;
    let urlDebounce = null;
    let thumbTimer = null;
    let revealWhenReady = false;   // true after the user adds/changes a source: show the video itself, not the card thumbnail

    // ---------- formatters ----------
    function formatDuration(sec) {
        if (!sec || isNaN(sec) || !isFinite(sec)) return DASH;
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = Math.floor(sec % 60);
        const pad = (n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    function qualityLabel(w, h) {
        if (!w || !h) return DASH;
        const side = Math.min(w, h);
        let tag = 'SD';
        if (side >= 2160) tag = '4K';
        else if (side >= 1440) tag = '2K';
        else if (side >= 1080) tag = 'Full HD';
        else if (side >= 720) tag = 'HD';
        return `${w}\u00D7${h} \u00B7 ${tag}`;
    }

    function formatSize(bytes) {
        if (!bytes) return '';
        const mb = bytes / (1024 * 1024);
        return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
    }

    function sourceLabel(url) {
        if (!url) return DASH;
        if (url.startsWith('blob:')) {
            const size = formatSize(currentFileSize);
            return size ? `Local file \u00B7 ${size}` : 'Local file';
        }
        try { return new URL(url).hostname.replace(/^www\./, '') || 'Local path'; }
        catch (_) { return 'Custom source'; }
    }

    // ---------- card media: thumbnail <-> player ----------
    // The <video> stays rendered under the thumbnail layer (z-10 vs z-20). It must NOT be display:none,
    // otherwise some browsers never decode a frame / fire loadedmetadata and the preview stays blank.
    function showThumbnail() {
        video.pause();
        thumbLayer.classList.remove('hidden');
    }

    function showPlayer(autoplay) {
        thumbLayer.classList.add('hidden');
        if (autoplay) {
            const p = video.play();
            if (p && p.catch) p.catch(function () {});
        }
    }

    window.playEditPreview = function () {
        if (currentState === 'ready' || currentState === 'loading') showPlayer(true);
    };

    // Card thumbnail follows the Thumbnail field (and the title, for the generated fallback)
    function refreshCardThumb() {
        clearTimeout(thumbTimer);
        const title = $('editTitle').value.trim();
        const src = getThumb({ thumbnail: $('editThumbnailUrl').value.trim(), title: title || 'Video' });
        thumbImg.alt = title || 'Video';
        if (thumbImg.getAttribute('src') !== src) {
            thumbImg.onerror = function () { thumbFallback(thumbImg); };
            thumbImg.src = src;
        }
    }

    function scheduleCardThumb() {
        clearTimeout(thumbTimer);
        thumbTimer = setTimeout(refreshCardThumb, 250);
    }

    // kept under its old name: openEditModal calls it
    window.setEditPreviewPoster = function () { refreshCardThumb(); };

    // ---------- player state ----------
    function resetMeta() {
        $('editMetaDetected').textContent = DASH;
        $('editMetaQuality').textContent = DASH;
        $('editMetaSource').textContent = DASH;
    }

    function setState(state) {
        currentState = state;
        $('editPreviewBadge').dataset.state = state;
        $('editPreviewBadgeText').textContent = STATES[state];

        $('editPreviewPlaceholder').classList.toggle('hidden', state !== 'empty');
        $('editPreviewLoading').classList.toggle('hidden', state !== 'loading');
        $('editPreviewError').classList.toggle('hidden', state !== 'error');

        const hasVideo = state !== 'empty';
        $('editPreviewOpenBtn').disabled = !hasVideo || state === 'error';
        $('editPreviewClearBtn').disabled = !hasVideo;
    }

    window.updateEditPreview = function (url, opts) {
        url = (url || '').trim();
        currentFileSize = opts && opts.fileSize ? opts.fileSize : null;
        revealWhenReady = !!(opts && opts.reveal && url);
        resetMeta();
        showThumbnail();
        $('editLocalNote').classList.toggle('hidden', !url.startsWith('blob:'));

        if (!url) {
            video.removeAttribute('src');
            video.load();
            setState('empty');
            return;
        }

        setState('loading');
        video.src = url;
    };

    window.retryEditPreview = function () {
        window.updateEditPreview($('editVideoUrl').value, { fileSize: currentFileSize, reveal: true });
    };

    window.clearEditPreview = function () {
        $('editVideoUrl').value = '';
        $('editVideoFileInput').value = '';
        window.updateEditPreview('');
    };

    window.openEditPreviewInTab = function () {
        const url = $('editVideoUrl').value.trim();
        if (url) window.open(url, '_blank', 'noopener');
    };

    function onVideoReady() {
        if (!video.getAttribute('src') || currentState === 'ready') return;
        $('editMetaDetected').textContent = formatDuration(video.duration);
        $('editMetaQuality').textContent = qualityLabel(video.videoWidth, video.videoHeight);
        $('editMetaSource').textContent = sourceLabel(video.getAttribute('src'));
        setState('ready');
        if (revealWhenReady) {
            revealWhenReady = false;
            showPlayer(false);   // show the added video itself (first frame + controls)
        }
    }

    video.addEventListener('loadedmetadata', function () {
        onVideoReady();
        // nudge to the first frame so it is painted as the preview image
        if (video.currentTime === 0 && isFinite(video.duration) && video.duration > 0.2) {
            try { video.currentTime = 0.1; } catch (_) {}
        }
    });
    // fallback for browsers that skip loadedmetadata with preload=metadata
    video.addEventListener('loadeddata', onVideoReady);
    video.addEventListener('canplay', onVideoReady);

    video.addEventListener('error', function () {
        // Ignore the event fired when we intentionally clear the source
        if (!video.getAttribute('src')) return;
        setState('error');
        showThumbnail();
    });

    // when playback finishes, go back to the card thumbnail
    video.addEventListener('ended', function () {
        video.currentTime = 0;
        showThumbnail();
    });

    // ---------- live card + listing info ----------
    window.renderEditDetails = function () {
        const title = $('editTitle').value.trim();
        const desc = $('editDescription').value.trim();
        const category = $('editCategory').value;
        const status = $('editStatus').value;
        const duration = $('editDuration').value.trim();
        const views = Math.max(0, parseInt($('editViews').value, 10) || 0);
        const tags = $('editTags').value.split(',').map(t => t.trim()).filter(Boolean);
        const featured = $('editFeatured').checked;
        const slot = parseInt($('editSliderPosition').value, 10) || 1;
        const id = parseInt($('editVideoId').value, 10);
        const record = VideoService.getById(id);

        // ----- the card (textContent only, so typed HTML is never executed) -----
        const titleEl = $('editCardTitle');
        titleEl.textContent = title || 'Untitled video';
        titleEl.classList.toggle('is-empty', !title);

        const descEl = $('editCardDesc');
        descEl.textContent = desc || 'No description added yet.';
        descEl.classList.toggle('is-empty', !desc);

        $('editCardCategory').textContent = category;
        $('editCardDuration').textContent = duration || '00:00';
        $('editCardViews').textContent = views.toLocaleString();
        $('editCardDate').textContent = record ? record.date : new Date().toISOString().split('T')[0];

        // ----- status + tags -----
        const statusEl = $('editDetStatus');
        statusEl.textContent = STATUS_LABELS[status] || status;
        statusEl.dataset.status = status;

        const tagBox = $('editDetTags');
        tagBox.replaceChildren();
        [...new Set(tags)].slice(0, 12).forEach(tag => {
            const chip = document.createElement('span');
            chip.className = 'preview-tag';
            chip.textContent = '#' + tag;
            tagBox.appendChild(chip);
        });
        tagBox.classList.toggle('hidden', tags.length === 0);

        // ----- would this video appear in the hero slider? (same rules as setupHeroSlider) -----
        const heroList = videoData
            .map(v => v.id === id ? { ...v, featured, status, sliderPosition: slot } : v)
            .filter(v => v.featured && v.status === 'published')
            .sort((a, b) => (a.sliderPosition || 99) - (b.sliderPosition || 99))
            .slice(0, 5);
        const heroRank = heroList.findIndex(v => v.id === id);
        const inHero = featured && status === 'published' && heroRank !== -1;

        const heroChip = $('editDetHero');
        heroChip.classList.toggle('hidden', !inHero);
        if (inHero) $('editDetHeroText').textContent = `Hero slide ${heroRank + 1} of ${heroList.length}`;

        // ----- visibility message -----
        const box = $('editDetVisibility');
        const icon = box.querySelector('i');
        let state = 'live';
        let text = 'Will be live on the homepage';

        if (status === 'published') {
            if (featured && inHero) {
                text += ` and in the Hero slider (slide ${heroRank + 1} of ${heroList.length}).`;
            } else if (featured) {
                state = 'warn';
                text += ', but not in the Hero slider: all 5 hero slots are taken by higher-ranked videos.';
            } else {
                text += '.';
            }
        } else {
            state = 'hidden';
            text = `${STATUS_LABELS[status] || status}: hidden from the homepage and the Hero slider.`;
        }

        box.dataset.state = state;
        icon.className = state === 'live' ? 'fa-solid fa-circle-check'
                       : state === 'warn' ? 'fa-solid fa-triangle-exclamation'
                       : 'fa-solid fa-eye-slash';
        $('editDetVisibilityText').textContent = text;
    };

    // PC browse: update URL, preview and duration
    window.handleEditFileSelect = function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const blobUrl = registerLocalFile(file).url;   // also stored in IndexedDB so it survives a refresh
        $('editVideoUrl').value = blobUrl;
        window.updateEditPreview(blobUrl, { fileSize: file.size, reveal: true });

        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.src = blobUrl;
        tempVideo.onerror = function () { disposeVideoEl(tempVideo); };
        tempVideo.onloadedmetadata = function () {
            if (tempVideo.duration && !isNaN(tempVideo.duration)) {
                const mins = Math.floor(tempVideo.duration / 60);
                const secs = Math.floor(tempVideo.duration % 60);
                $('editDuration').value = `${mins < 10 ? '0' + mins : mins}:${secs < 10 ? '0' + secs : secs}`;
                window.renderEditDetails();
            }
            tempVideo.onloadedmetadata = null; tempVideo.onerror = null;
            disposeVideoEl(tempVideo);   // a 4K file must not stay open in a hidden player
        };
    };

    // ---------- wiring ----------
    $('editVideoUrl').addEventListener('input', function (e) {
        clearTimeout(urlDebounce);
        const value = e.target.value;
        urlDebounce = setTimeout(() => window.updateEditPreview(value, { reveal: true }), 450);
    });

    ['editTitle', 'editDescription', 'editCategory', 'editStatus', 'editDuration',
     'editViews', 'editTags', 'editFeatured', 'editSliderPosition'].forEach(function (fieldId) {
        const el = $(fieldId);
        el.addEventListener('input', window.renderEditDetails);
        el.addEventListener('change', window.renderEditDetails);
    });

    // title drives the generated fallback thumbnail
    $('editTitle').addEventListener('input', scheduleCardThumb);

    // changing the thumbnail brings the card thumbnail back so the change is visible
    $('editThumbnailUrl').addEventListener('input', function () {
        showThumbnail();
        scheduleCardThumb();
    });

    $('editCardDesc').addEventListener('click', function (e) {
        e.currentTarget.classList.toggle('expanded');
    });

    setState('empty');
})();

        window.duplicateVideoAction = function(id) {
            const copy = VideoService.duplicate(id);
            if (copy) {
                renderAdminTable();
                renderAdminDashboard();
                showToast(`Duplicated as "${copy.title}"`);
            }
        };

        window.toggleVideoStatusAction = function(id) {
            const video = VideoService.getById(id);
            if (video) {
                const nextStatus = video.status === 'published' ? 'draft' : 'published';
                VideoService.update(id, { status: nextStatus });
                renderAdminTable();
                renderAdminDashboard();
                applyFiltersAndSort();
                showToast(`Video status changed to ${nextStatus}`);
            }
        };

        window.promptDeleteVideo = function(id) {
            const video = VideoService.getById(id);
            if (!video) return;

            document.getElementById('deleteConfirmText').textContent = `Are you sure you want to delete "${video.title}"?`;
            pendingDeleteAction = () => {
                VideoService.delete(id);
                renderAdminTable();
                renderAdminDashboard();
                applyFiltersAndSort();
                showToast('Video deleted successfully.');
            };
            document.getElementById('deleteConfirmModal').classList.remove('hidden');
        };

        window.closeDeleteModal = function() {
            document.getElementById('deleteConfirmModal').classList.add('hidden');
            pendingDeleteAction = null;
        };

        window.executeDeleteAction = function() {
            if (pendingDeleteAction) pendingDeleteAction();
            closeDeleteModal();
        };

        window.renderAdminAdsTable = function() {
            const tbody = document.getElementById('adminAdsTableBody');
            if (!tbody) return;
            const note = document.getElementById('adServerNote');
            if (note) {
                note.classList.remove('hidden');
                if (SERVER.on) {
                    note.className = 'text-[11px] rounded-xl border px-3 py-2 bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
                    note.textContent = 'Server connected: ad slots are saved on your hosting automatically and shown to every visitor. No export needed.';
                } else {
                    note.className = 'text-[11px] rounded-xl border px-3 py-2 bg-amber-500/10 text-amber-300 border-amber-500/30';
                    note.textContent = 'No server found (api.php is not uploaded or PHP is off). Ads are saved in this browser only. Upload api.php to your hosting, or use Export ads-config.js.';
                }
            }

            tbody.innerHTML = adSlots.map(s => `
                <tr class="hover:bg-dark-hover/50 transition">
                    <td class="py-3 px-4 font-bold text-white">${s.name}</td>
                    <td class="py-3 px-4"><span class="uppercase font-semibold text-brand-primary">${({socialbar:'Social Bar',popunder:'Popunder',native:'Native Banner',banner_728x90:'Banner 728x90',banner_320x50:'Banner 320x50',banner_468x60:'Banner 468x60'})[s.type] || s.type}</span></td>
                    <td class="py-3 px-4 text-gray-400">${({top:'Top Header',bottom:'Bottom Fixed',player:'Video Player (5 ads)',none:'—'})[s.position] || (String(s.position||'').startsWith('content_') ? 'After ' + String(s.position).split('_')[1] + (String(s.position).split('_')[1] === '1' ? 'st' : 'th') + ' video' : '—')}</td>
                    <td class="py-3 px-4">
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${s.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}">
                            ${s.enabled ? 'ACTIVE' : 'OFF'}
                        </span>
                    </td>
                    <td class="py-3 px-4 text-right space-x-1">
                        <button onclick="openAdModal(${s.id})" class="p-1.5 rounded hover:bg-dark-card text-amber-400" title="Edit Ad"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button onclick="toggleAdStatus(${s.id})" class="p-1.5 rounded hover:bg-dark-card ${s.enabled ? 'text-emerald-400' : 'text-gray-400'}"><i class="fa-solid fa-power-off"></i></button>
                        <button onclick="promptDeleteAd(${s.id})" class="p-1.5 rounded hover:bg-dark-card text-red-400"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>
            `).join('');
        };

        // Placement select + optional custom "after Nth video" number
        window.adPositionChanged = function () {
            const custom = document.getElementById('adPosition').value === 'content_custom';
            document.getElementById('adPositionCustomWrap').classList.toggle('hidden', !custom);
            if (custom) document.getElementById('adPositionCustom').focus();
        };
        function setAdPositionUi(pos) {
            const sel = document.getElementById('adPosition'), num = document.getElementById('adPositionCustom');
            if ([...sel.options].some(o => o.value === pos)) { sel.value = pos; num.value = ''; }
            else if (/^content_\d+$/.test(pos)) { sel.value = 'content_custom'; num.value = pos.split('_')[1]; }
            else sel.value = 'top';
            adPositionChanged();
        }
        function readAdPositionUi() {
            const v = document.getElementById('adPosition').value;
            if (v !== 'content_custom') return v;
            const n = parseInt(document.getElementById('adPositionCustom').value, 10);
            return (n >= 1 && n <= 500) ? 'content_' + n : 'content_8';
        }

        window.openAdModal = function(id = null) {
            if (id) {
                const slot = adSlots.find(a => a.id === parseInt(id));
                if (slot) {
                    document.getElementById('adSlotId').value = slot.id;
                    document.getElementById('adName').value = slot.name;
                    document.getElementById('adType').value = slot.type;
                    setAdPositionUi(slot.position || 'top');
                    document.getElementById('adCode').value = slot.code || '';
                    document.getElementById('adEnabled').checked = slot.enabled;
                }
            } else {
                document.getElementById('adSlotId').value = '';
                document.getElementById('adForm').reset();
                adPositionChanged();
            }
            document.getElementById('adPosition').disabled = false;
            document.getElementById('adModal').classList.remove('hidden');
        };

        window.closeAdModal = function() {
            document.getElementById('adModal').classList.add('hidden');
        };

        window.handleAdSubmit = function(e) {
            e.preventDefault();
            const id = document.getElementById('adSlotId').value;
            const payload = {
                name: document.getElementById('adName').value.trim(),
                type: document.getElementById('adType').value,
                position: readAdPositionUi(),
                code: document.getElementById('adCode').value.trim(),
                enabled: document.getElementById('adEnabled').checked
            };

            markAdsEdited();
            if (id) {
                AdService.update(id, payload);
            } else {
                AdService.add(payload);
            }

            closeAdModal();
            renderAdminAdsTable();
            renderAdminDashboard();
            renderAds({ grid: true });
            showToast('Ad slot saved and applied to the site!');
        };

        window.toggleAdStatus = function(id) {
            const slot = adSlots.find(a => a.id === parseInt(id));
            if (slot) {
                markAdsEdited();
                AdService.update(id, { enabled: !slot.enabled });
                renderAdminAdsTable();
                renderAdminDashboard();
                renderAds({ grid: true });
                showToast(`Ad slot ${!slot.enabled ? 'Enabled' : 'Disabled'}`);
            }
        };

        window.promptDeleteAd = function(id) {
            const slot = adSlots.find(a => a.id === parseInt(id));
            if (!slot) return;

            document.getElementById('deleteConfirmText').textContent = `Are you sure you want to delete ad slot "${slot.name}"?`;
            pendingDeleteAction = () => {
                markAdsEdited();
                AdService.delete(id);
                renderAdminAdsTable();
                renderAdminDashboard();
                renderAds({ grid: true });
                showToast('Ad slot removed.');
            };
            document.getElementById('deleteConfirmModal').classList.remove('hidden');
        };

        // =====================================================================
        //  ADVERTISEMENT ENGINE  (renders the codes saved in Admin > Ad Manager)
        // =====================================================================
        const adDismissed = { top: false, bottom: false };
        const adDirectBoxes = {};      // cache of script-mounted ad boxes (never run the same script twice)
        let adCheckTimers = [];
        let popupCountdownTimer = null;
        const gid = (id) => document.getElementById(id);

        function getActiveAdSlots() {
            if (!globalAdsEnabled) return [];
            return adSlots.filter(s => s.enabled && s.code && String(s.code).trim());
        }

        // where a slot goes: popup / social bar are decided by type, the rest by position
        function adPlacementOf(slot) {
            if (slot.type === 'popunder') return 'popunder';
            const p = slot.position || (slot.type === 'socialbar' ? 'bottom' : 'top');
            return (p === 'top' || p === 'bottom' || p === 'player' || /^content_\d+$/.test(p)) ? p : 'top';
        }

        // "//host/x.js" -> "https://host/x.js" (protocol-relative URLs break on file:// and inside iframes)
        function adNormalizeCode(code) {
            return String(code || '').replace(/(\s(?:src|href)\s*=\s*["'])\/\//gi, '$1https://').trim();
        }

        // banner / in-content ads, or any code that uses document.write, run in an isolated frame
        function adNeedsFrame(slot) {
            return /^banner_/.test(slot.type) || /atOptions|document\.write/i.test(slot.code || '');
        }

        function adHash(str) {
            let h = 0;
            for (let i = 0; i < str.length; i++) { h = ((h << 5) - h + str.charCodeAt(i)) | 0; }
            return String(h);
        }

        function adBuildFrame(slot) {
            const code = adNormalizeCode(slot.code);
            const DEF = { banner_728x90: [728, 90], banner_320x50: [320, 50], banner_468x60: [468, 60] }[slot.type];
            const w = (code.match(/['"]?width['"]?\s*:\s*['"]?(\d{2,4})/i) || [])[1] || (DEF ? String(DEF[0]) : undefined);
            const hgt = (code.match(/['"]?height['"]?\s*:\s*['"]?(\d{2,4})/i) || [])[1] || (DEF ? String(DEF[1]) : undefined);
            const f = document.createElement('iframe');
            f.className = 'ad-frame';
            f.setAttribute('scrolling', 'no');
            f.setAttribute('frameborder', '0');
            f.setAttribute('allowtransparency', 'true');
            f.setAttribute('title', 'Advertisement');
            f.style.cssText = 'border:0;display:block;margin:0 auto;max-width:100%;flex:0 0 auto;background:transparent;overflow:hidden;';
            f.style.width = w ? w + 'px' : '100%';
            f.style.height = (hgt ? hgt : 90) + 'px';
            f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">' +
                '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}body{display:flex;justify-content:center}</style>' +
                '</head><body>' + code + '</body></html>';
            // grow/shrink to the real creative size once it has rendered
            const fit = () => {
                try {
                    const d = f.contentDocument;
                    if (!d || !d.body) return;
                    const hh = Math.max(d.body.scrollHeight, d.documentElement.scrollHeight);
                    if (hh > 5) f.style.height = hh + 'px';
                    if (!w) {
                        const ww = Math.max(d.body.scrollWidth, 0);
                        if (ww > 5 && ww < f.parentNode.clientWidth) f.style.width = ww + 'px';
                    }
                } catch (e) { /* cross-origin: keep default size */ }
            };
            // small screens: shrink a fixed-width banner (e.g. 728x90) to fit instead of cutting it off
            const naturalW = w ? parseInt(w, 10) : 0;
            const rescale = () => {
                const box = f.parentNode;
                if (!f.isConnected || !box) { window.removeEventListener('resize', rescale); return; }
                const avail = box.clientWidth;
                const nw = naturalW || parseInt(f.style.width, 10) || 0;
                if (!avail || !nw || f.style.width === '100%') return;
                const sc = Math.min(1, avail / nw);
                f.style.maxWidth = 'none';
                f.style.transformOrigin = 'top left';
                f.style.transform = sc < 1 ? 'scale(' + sc + ')' : '';
                box.style.height = sc < 1 ? Math.ceil(parseInt(f.style.height, 10) * sc) + 'px' : '';
            };
            window.addEventListener('resize', rescale);
            f.addEventListener('load', () => {
                const run = () => { fit(); rescale(); };
                run();
                [600, 1800, 4000, 8000].forEach(t => setTimeout(run, t));
            });
            return f;
        }

        // direct (non-iframe) mounting: scripts are re-created so they actually execute, in order
        function adMountDirect(host, rawCode) {
            const tpl = document.createElement('template');
            tpl.innerHTML = adNormalizeCode(rawCode);
            const jobs = [...tpl.content.querySelectorAll('script')].map(old => {
                const ph = document.createComment('ad-script');
                old.replaceWith(ph);
                return { ph, old };
            });
            host.appendChild(tpl.content);
            (async () => {
                for (const { ph, old } of jobs) {
                    await new Promise(resolve => {
                        const sc = document.createElement('script');
                        for (const a of old.attributes) sc.setAttribute(a.name, a.value);
                        const external = !!old.getAttribute('src');
                        if (external) {
                            sc.onload = sc.onerror = () => resolve();
                            setTimeout(resolve, 8000);
                        } else {
                            sc.text = old.textContent;
                        }
                        ph.replaceWith(sc);
                        if (!external) resolve();
                    });
                }
            })();
        }

        function adBuildNode(slot) {
            if (adNeedsFrame(slot)) {
                const box = document.createElement('div');
                box.className = 'ad-unit w-full flex justify-center';
                box.style.overflow = 'hidden';
                box.appendChild(adBuildFrame(slot));
                return box;
            }
            const sig = slot.id + ':' + adHash(slot.code);
            if (!adDirectBoxes[sig]) {
                const box = document.createElement('div');
                box.className = 'ad-unit w-full flex flex-col items-center';
                box._pendingCode = slot.code;   // mounted by adFillHost once the box is in the page
                adDirectBoxes[sig] = box;
            }
            return adDirectBoxes[sig];
        }

        function adFillHost(host, slots) {
            host.innerHTML = '';
            slots.forEach(s => {
                const node = adBuildNode(s);
                host.appendChild(node);
                if (node._pendingCode) {          // scripts must be inserted while attached so they run in order
                    const code = node._pendingCode;
                    node._pendingCode = null;
                    adMountDirect(node, code);
                }
            });
        }

        // does the host show something visible? (frames are checked from the inside)
        function adHasContent(host) {
            return [...host.children].some(box => {
                const f = box.querySelector && box.querySelector('iframe.ad-frame');
                if (f) {
                    try {
                        const d = f.contentDocument;
                        if (!d || !d.body) return false;
                        return d.body.querySelectorAll('img,iframe,ins,canvas,svg,video,a,div,span,object,embed').length > 0 ||
                               d.body.innerText.trim().length > 0;
                    } catch (e) { return true; }   // cross-origin content: assume it rendered
                }
                const r = box.getBoundingClientRect();
                return r.height > 4 && r.width > 4;
            });
        }

        // slow ad networks: check several times; a slot hides when empty and re-appears as soon as it renders
        function adRunChecks(fn) {
            [2500, 6000, 12000].forEach(t => adCheckTimers.push(setTimeout(fn, t)));
        }

        // ---------- top banner ----------
        function renderTopAds(slots) {
            const wrap = gid('topBannerAdContainer'), host = gid('adTopHost');
            const mine = slots.filter(s => adPlacementOf(s) === 'top');
            if (!mine.length || adDismissed.top) { host.innerHTML = ''; wrap.classList.add('hidden'); return; }
            wrap.classList.remove('hidden');
            adFillHost(host, mine);
            adRunChecks(() => { wrap.classList.toggle('hidden', adDismissed.top || !adHasContent(host)); });
        }

        // ---------- bottom bar / social bar ----------
        function renderBottomAds(slots) {
            const bar = gid('bottomSocialBar'), host = gid('adBottomHost');
            const mine = slots.filter(s => adPlacementOf(s) === 'bottom');
            if (!mine.length || adDismissed.bottom) { host.innerHTML = ''; bar.classList.add('hidden'); document.body.style.paddingBottom = ''; return; }
            bar.classList.remove('hidden');
            adFillHost(host, mine);
            const settle = () => {
                if (adDismissed.bottom) return;
                const has = adHasContent(host);
                bar.classList.toggle('hidden', !has);
                document.body.style.paddingBottom = has ? bar.offsetHeight + 'px' : '';
            };
            adRunChecks(settle);
        }

        // ---------- popunder (script only, no visible box; started once per page load) ----------
        function renderPopupAds(slots) {
            const mine = slots.filter(s => adPlacementOf(s) === 'popunder');
            if (!mine.length) return;
            let host = gid('adPopunderHost');
            if (!host) {
                host = document.createElement('div');
                host.id = 'adPopunderHost';
                host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
                document.body.appendChild(host);
            }
            mine.forEach(sl => {
                const sig = sl.id + ':' + adHash(sl.code);
                if (adDirectBoxes[sig]) return;            // already running: never start the same script twice
                const box = document.createElement('div');
                adDirectBoxes[sig] = box;
                host.appendChild(box);
                adMountDirect(box, sl.code);
            });
        }

        // ---------- video player gate: ad over the player 30s after play starts ----------
        // ad appears when the visitor has actually watched this many seconds: 3s, 15s, 30s, 1 min, 2 min
        const AD_GATE_MARKS = [7, 45, 120, 240, 300, 360, 420, 480, 540, 600, 660, 720, 780,];
        const playerGate = { watched: 0, last: 0, next: 0, active: false, tick: null, countdown: null };

        function pickPlayerAdSlots() {
            const slots = getActiveAdSlots();
            let mine = slots.filter(s => adPlacementOf(s) === 'player');
            if (!mine.length) mine = slots.filter(s => /^banner_/.test(s.type));   // fallback (frames can be shown twice safely)
            return mine.slice(0, 1);
        }

        function resetPlayerGate() {
            clearInterval(playerGate.tick); clearInterval(playerGate.countdown);
            playerGate.watched = 0; playerGate.next = 0; playerGate.active = false; playerGate.last = 0;
            const ov = gid('playerAdOverlay');
            if (ov) { ov.classList.add('hidden'); gid('playerAdHost').innerHTML = ''; }
        }

        function startPlayerGate() {
            resetPlayerGate();
            const player = gid('mainVideoPlayer');
            playerGate.last = Date.now();
            playerGate.tick = setInterval(() => {
                const now = Date.now(), dt = Math.min((now - playerGate.last) / 1000, 1);
                playerGate.last = now;
                if (playerGate.next >= AD_GATE_MARKS.length || playerGate.active) return;
                if (gid('videoModal').classList.contains('hidden')) return;
                if (player.paused || player.ended || player.readyState < 3) return;
                playerGate.watched += dt;
                const marks = window.AD_GATE_MARKS_OVERRIDE || AD_GATE_MARKS;
                if (playerGate.watched >= marks[playerGate.next]) showPlayerAd();
            }, 250);
        }

        function showPlayerAd() {
    const slots = pickPlayerAdSlots();
    playerGate.next++;
    if (!slots.length) return;
    const player = gid('mainVideoPlayer');
    try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    player.pause();
    playerGate.active = true;
    gid('playerAdOverlay').classList.remove('hidden');
    adFillHost(gid('playerAdHost'), slots);
    const btn = gid('playerAdCloseBtn');
    let n = 5;
    btn.disabled = true;
    btn.className = 'text-xs text-gray-400 py-2 px-4 opacity-50 cursor-not-allowed';
    btn.innerHTML = 'Close in <span id="playerAdCountdown">' + n + '</span>s';
    clearInterval(playerGate.countdown);
    playerGate.countdown = setInterval(() => {
        n--;
        const c = gid('playerAdCountdown'); if (c) c.textContent = n;
        if (n <= 0) {
            clearInterval(playerGate.countdown);
            btn.disabled = false;
            btn.className = 'text-xs font-semibold text-white bg-brand-primary hover:bg-brand-hover rounded-lg py-2 px-4 cursor-pointer';
            btn.innerHTML = 'Close ad &amp; continue <i class="fa-solid fa-xmark ml-1"></i>';
        }
    }, 1000);

    // 👇👇👇 এই ৭ লাইন নতুন যোগ হয়েছে — ১০ সেকেন্ড পর অটো বন্ধ + video resume
    clearTimeout(playerGate.autoClose);
    playerGate.autoClose = setTimeout(() => {
        if (!playerGate.active) return;
        playerGate.active = false;
        clearInterval(playerGate.countdown);
        gid('playerAdOverlay').classList.add('hidden');
        player.play().catch(() => {});
    }, 15000);
    // 👆👆👆 এখানেই শেষ
}

        window.closePlayerAd = function () {
            if (gid('playerAdCloseBtn').disabled) return;
            clearInterval(playerGate.countdown);
            gid('playerAdOverlay').classList.add('hidden');
            gid('playerAdHost').innerHTML = '';
            clearTimeout(playerGate.autoClose);
            playerGate.last = Date.now();
            const p = gid('mainVideoPlayer').play(); if (p && p.catch) p.catch(() => {});
        };

        // the video must not play while the ad is up (keyboard, controls, any other way)
        document.addEventListener('DOMContentLoaded', () => {
            const pl = gid('mainVideoPlayer');
            if (pl) pl.addEventListener('play', () => { if (playerGate.active) pl.pause(); });
        });

        // ---------- in-content ads (called after every grid render) ----------
        window.mountContentAds = function () {
            const slots = getActiveAdSlots();
            document.querySelectorAll('[data-ad-host]').forEach(host => {
                const pos = host.getAttribute('data-ad-host');
                const mine = slots.filter(s => adPlacementOf(s) === pos);
                if (!mine.length) { host.parentElement.classList.add('hidden'); return; }
                adFillHost(host, mine);
                adRunChecks(() => { if (host.isConnected) host.parentElement.classList.toggle('hidden', !adHasContent(host)); });
            });
        };

        // re-draw everything. opts.grid = also rebuild the video grid (needed after slot changes)
        window.renderAds = function (opts) {
            opts = opts || {};
            adCheckTimers.forEach(clearTimeout);
            adCheckTimers = [];
            const slots = getActiveAdSlots();
            renderTopAds(slots);
            renderBottomAds(slots);
            renderPopupAds(slots);
            if (opts.grid) renderVideoGrid();
        };

        let adTypeUiReady = true;
        window.syncAdPositionToType = function () {
            const type = gid('adType').value;
            const pos = gid('adPosition');
            pos.disabled = false;                       // placement is always selectable
            if (!adTypeUiReady) { adTypeUiReady = true; return; }
            if (type === 'socialbar') pos.value = 'bottom';
        };

        // =====================================================================
        //  VISITOR VIDEO DOWNLOADS
        // =====================================================================
        const downloadsInFlight = {};
        const DOWNLOAD_MAX_IN_MEMORY = 800 * 1024 * 1024;   // above this let the browser handle it
        const MIME_EXT = {
            'video/mp4': 'mp4', 'video/webm': 'webm', 'video/ogg': 'ogv', 'video/quicktime': 'mov',
            'video/x-matroska': 'mkv', 'video/x-msvideo': 'avi', 'video/3gpp': '3gp', 'video/x-m4v': 'm4v'
        };

        function canDownloadVideo(v) {
            return !!v && v.allowDownload !== false && !!v.videoUrl && !String(v.videoUrl).startsWith('idb:');
        }

        function videoFileName(v, mime) {
            const base = String(v.title || 'video')
                .replace(/[\\\/:*?"<>|#%]+/g, '').replace(/\s+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'video';
            let ext = MIME_EXT[String(mime || '').split(';')[0].trim().toLowerCase()];
            if (!ext) {
                const m = String(v.videoUrl).match(/\.(mp4|m4v|webm|ogv|ogg|mov|mkv|avi|3gp)(?:$|[?#])/i);
                ext = m ? m[1].toLowerCase() : 'mp4';
            }
            return base + '.' + ext;
        }

        function saveBlobAs(blob, filename) {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        }

        function setDownloadUi(id, state, pct) {
            const icon = gid('dl-icon-' + id);
            if (icon) icon.className = state === 'done' ? 'fa-solid fa-download text-xs' : 'fa-solid fa-spinner fa-spin text-xs';
            if (id !== activeModalVideoId) return;
            const wrap = gid('modalDownloadProgress'), bar = gid('modalDownloadBar');
            const txt = gid('modalDownloadPct'), btn = gid('modalDownloadBtn'), label = gid('modalDownloadLabel');
            if (state === 'done') {
                wrap.classList.add('hidden'); btn.disabled = false; label.textContent = 'Download';
                bar.classList.remove('animate-pulse');
            } else {
                wrap.classList.remove('hidden'); btn.disabled = true; label.textContent = 'Downloading...';
                if (pct === null || pct === undefined) { bar.style.width = '100%'; bar.classList.add('animate-pulse'); txt.textContent = 'Please wait...'; }
                else { bar.classList.remove('animate-pulse'); bar.style.width = pct + '%'; txt.textContent = Math.round(pct) + '%'; }
            }
        }

        async function fetchVideoBlob(url, onProgress) {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const total = parseInt(res.headers.get('content-length') || '0', 10);
            if (total > DOWNLOAD_MAX_IN_MEMORY) throw new Error('too-large');
            if (!res.body || !res.body.getReader) { onProgress(null); return res.blob(); }
            const reader = res.body.getReader();
            const chunks = [];
            let got = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                got += value.length;
                if (got > DOWNLOAD_MAX_IN_MEMORY) throw new Error('too-large');
                onProgress(total ? (got / total) * 100 : null);
            }
            return new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' });
        }

        function recordDownload(v) {
            const downloads = (v.downloads || 0) + 1;
            VideoService.update(v.id, { downloads });
            if (v.id === activeModalVideoId) {
                gid('modalDownloadsText').textContent = `\u00b7 ${downloads.toLocaleString()} downloads`;
            }
        }

        window.downloadVideoById = async function (id) {
            const v = VideoService.getById(id);
            if (!v) return;
            if (!canDownloadVideo(v)) { showToast('Download is not available for this video.', { error: true }); return; }
            if (downloadsInFlight[id]) { showToast('This video is already downloading.'); return; }

            downloadsInFlight[id] = true;
            setDownloadUi(id, 'start', 0);
            showToast('Starting download...');
            try {
                const blob = await fetchVideoBlob(v.videoUrl, (pct) => setDownloadUi(id, 'progress', pct));
                saveBlobAs(blob, videoFileName(v, blob.type));
                recordDownload(v);
                showToast('Download started! Check your Downloads folder.');
            } catch (err) {
                // the host blocks cross-site reads (CORS) or the file is too large: let the browser handle the file itself
                const opened = window.open(v.videoUrl, '_blank');
                if (opened) {
                    try { opened.opener = null; } catch (e) {}
                    recordDownload(v);
                    showToast('Video opened in a new tab. Use the \u22ee menu \u2192 Download (or right-click \u2192 Save video as).');
                } else {
                    // popup blocked (needs a fresh tap): offer a button
                    showToast('This video is hosted on another site. Tap to open it, then use \u22ee \u2192 Download.', {
                        label: 'Open video',
                        onClick: () => { window.open(v.videoUrl, '_blank'); recordDownload(v); }
                    });
                }
            } finally {
                downloadsInFlight[id] = false;
                setDownloadUi(id, 'done');
            }
        };

        window.downloadCurrentVideo = function () {
            if (activeModalVideoId !== null) window.downloadVideoById(activeModalVideoId);
        };

        function markAdsEdited() { try { localStorage.setItem(STORAGE_ADS_EDITED, '1'); } catch (e) {} }

        // Download the site-wide ad file. Upload it to js/ on the hosting so every visitor gets these ads.
        window.exportAdsConfig = function () {
            const cfg = {
                globalAdsEnabled: globalAdsEnabled,
                slots: adSlots.map(s => ({ id: s.id, name: s.name, type: s.type, position: s.position, enabled: !!s.enabled, code: s.code || '' }))
            };
            const text = '// Ad slots shown to ALL visitors.\n' +
                '// Generated by Admin > Ad Manager > Export ads-config.js. Upload to the js/ folder on your hosting (replace the old file).\n' +
                'window.SITE_AD_CONFIG = ' + JSON.stringify(cfg, null, 2) + ';\n';
            saveBlobAs(new Blob([text], { type: 'application/javascript' }), 'ads-config.js');
            showToast('ads-config.js downloaded. Upload it to the js/ folder on your hosting.');
        };

        window.toggleGlobalAds = function(enabled) {
            markAdsEdited();
            globalAdsEnabled = enabled;
            try { localStorage.setItem(STORAGE_GLOBAL_ADS, enabled ? '1' : '0'); } catch (e) {}
            queueServerSync();
            showToast(`Global Ads ${enabled ? 'Enabled' : 'Disabled'}`);
            renderAds({ grid: true });
        };

        // Advertisement Dismiss Handlers
        window.dismissTopBanner = function() {
            adDismissed.top = true;
            document.getElementById('topBannerAdContainer').classList.add('hidden');
        };

        window.dismissSocialBar = function() {
            adDismissed.bottom = true;
            document.getElementById('bottomSocialBar').classList.add('hidden');
            document.body.style.paddingBottom = '';
        };

        window.dismissPopupAd = function() {
            clearInterval(popupCountdownTimer);
            document.getElementById('popupAdModal').classList.add('hidden');
        };

        window.toggleMobileMenu = function() {
            document.getElementById('mobileMenu').classList.toggle('hidden');
        };

        let toastTimer = null;
        window.showToast = function(msg, opts) {
            opts = opts || {};
            const toast = document.getElementById('toastNotification');
            const icon = document.getElementById('toastIcon');
            const actionBtn = document.getElementById('toastAction');

            document.getElementById('toastText').textContent = msg;

            if (icon) {
                icon.className = opts.error
                    ? 'fa-solid fa-triangle-exclamation text-amber-400 text-sm'
                    : 'fa-solid fa-circle-check text-brand-accent text-sm';
            }

            if (opts.label && typeof opts.onClick === 'function') {
                actionBtn.textContent = opts.label;
                actionBtn.onclick = () => { toast.classList.add('hidden'); opts.onClick(); };
                actionBtn.classList.remove('hidden');
            } else {
                actionBtn.classList.add('hidden');
                actionBtn.onclick = null;
            }

            toast.classList.remove('hidden');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { toast.classList.add('hidden'); }, opts.label ? 7000 : 3000);
        };

        window.onload = async function() {
            await serverLoad();
            initData();
            applyServerData();
            await resolveStoredFiles();
            setupCategoriesUI();
            applyFiltersAndSort();
            renderAds();
            refreshSyncBadge();
            // opened from a shared link: index.html?v=VIDEO_ID
            const dl = parseInt(new URLSearchParams(location.search).get('v'), 10);
            const dv = dl ? VideoService.getById(dl) : null;
            if (dv && dv.status === 'published') setTimeout(() => openVideoModal(dl), 400);
        };
