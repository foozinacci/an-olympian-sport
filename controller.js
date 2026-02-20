/* ═══════════════════════════════════════════
   DEGEN HORSESHOES 💣 — PHONE CONTROLLER
   Touch-based throw controls for mobile players
   ═══════════════════════════════════════════ */

const Controller = (() => {
    let isMyTurn = false;
    let aimX = 0, aimY = 0.5;
    let power = 0;
    let charging = false;
    let chargeStartTime = 0;
    let chargeInterval = null;
    let mySeat = null;
    let myName = '';

    const $ = id => document.getElementById(id);

    function init(seat, name) {
        mySeat = seat;
        myName = name;
        setupAimTouch();
        setupThrowButton();
    }

    /* ── Aim Zone (top half — drag to aim) ── */
    function setupAimTouch() {
        const zone = $('pc-aim-zone');
        if (!zone) return;

        let touching = false;
        let startX, startY;

        zone.addEventListener('touchstart', e => {
            e.preventDefault();
            if (!isMyTurn) return;
            touching = true;
            const touch = e.touches[0];
            startX = touch.clientX;
            startY = touch.clientY;
        }, { passive: false });

        zone.addEventListener('touchmove', e => {
            e.preventDefault();
            if (!touching || !isMyTurn) return;
            const touch = e.touches[0];
            const rect = zone.getBoundingClientRect();
            const relX = (touch.clientX - rect.left) / rect.width;
            const relY = (touch.clientY - rect.top) / rect.height;

            aimX = (relX - 0.5) * 2; // -1 to 1
            aimY = 1 - relY; // 0 (bottom) to 1 (top)
            aimX = Math.max(-1, Math.min(1, aimX));
            aimY = Math.max(0, Math.min(1, aimY));

            // Update reticle
            const reticle = $('pc-aim-reticle');
            if (reticle) {
                reticle.style.left = `${relX * 100}%`;
                reticle.style.top = `${relY * 100}%`;
            }

            // Send to host
            Network.sendInput({ type: 'aim', x: aimX, y: aimY });
        }, { passive: false });

        zone.addEventListener('touchend', () => { touching = false; });

        // Mouse fallback for testing
        zone.addEventListener('mousemove', e => {
            if (!isMyTurn) return;
            const rect = zone.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;
            aimX = (relX - 0.5) * 2;
            aimY = 1 - relY;
            aimX = Math.max(-1, Math.min(1, aimX));
            aimY = Math.max(0, Math.min(1, aimY));

            const reticle = $('pc-aim-reticle');
            if (reticle) {
                reticle.style.left = `${relX * 100}%`;
                reticle.style.top = `${relY * 100}%`;
            }

            Network.sendInput({ type: 'aim', x: aimX, y: aimY });
        });
    }

    /* ── Throw Button (bottom — hold to charge, release to throw) ── */
    function setupThrowButton() {
        const btn = $('pc-throw-btn');
        if (!btn) return;

        const startCharge = (e) => {
            e.preventDefault();
            if (!isMyTurn || charging) return;
            charging = true;
            power = 0;
            chargeStartTime = performance.now();

            Network.sendInput({ type: 'chargeStart' });

            btn.classList.add('charging');

            chargeInterval = setInterval(() => {
                const elapsed = (performance.now() - chargeStartTime) / 1000;
                power = Math.min(1, elapsed * 0.7); // 0→1 in ~1.4s
                updatePowerUI(power);
                Network.sendInput({ type: 'charging', power });
            }, 50);
        };

        const endCharge = (e) => {
            e.preventDefault();
            if (!charging) return;
            charging = false;
            clearInterval(chargeInterval);

            btn.classList.remove('charging');

            Network.sendInput({ type: 'throw', power, aimX, aimY });

            // Lock controls
            isMyTurn = false;
            showWaiting('Watching your throw...');
        };

        // Touch
        btn.addEventListener('touchstart', startCharge, { passive: false });
        btn.addEventListener('touchend', endCharge, { passive: false });
        btn.addEventListener('touchcancel', endCharge, { passive: false });

        // Mouse fallback
        btn.addEventListener('mousedown', startCharge);
        btn.addEventListener('mouseup', endCharge);
        btn.addEventListener('mouseleave', e => { if (charging) endCharge(e); });
    }

    function updatePowerUI(p) {
        const fill = $('pc-power-fill');
        if (fill) {
            fill.style.width = `${p * 100}%`;
            // Color
            if (p < 0.2) fill.style.background = '#888';
            else if (p < 0.4) fill.style.background = '#bbbb33';
            else if (p < 0.7) fill.style.background = '#00ff66';
            else if (p < 0.9) fill.style.background = '#ff8833';
            else fill.style.background = '#ff2222';
        }
    }

    /* ── View Switching ── */
    function showControls(timer) {
        isMyTurn = true;
        power = 0;
        aimX = 0;
        aimY = 0.5;
        charging = false;

        $('pc-lobby').classList.add('hidden');
        $('pc-controls').classList.remove('hidden');
        $('pc-waiting').classList.add('hidden');
        $('pc-spectator').classList.add('hidden');

        $('pc-timer-display').textContent = timer.toFixed(1);
        updatePowerUI(0);

        // Reset reticle
        const reticle = $('pc-aim-reticle');
        if (reticle) {
            reticle.style.left = '50%';
            reticle.style.top = '50%';
        }

        // Vibrate if available
        if (navigator.vibrate) navigator.vibrate(200);
    }

    function showWaiting(text = 'Watching the action...') {
        isMyTurn = false;
        $('pc-lobby').classList.add('hidden');
        $('pc-controls').classList.add('hidden');
        $('pc-waiting').classList.remove('hidden');
        $('pc-spectator').classList.add('hidden');
        $('pc-waiting-text').textContent = text;
    }

    function showLobby() {
        $('pc-lobby').classList.remove('hidden');
        $('pc-controls').classList.add('hidden');
        $('pc-waiting').classList.add('hidden');
        $('pc-spectator').classList.add('hidden');
    }

    function showSpectator() {
        $('pc-lobby').classList.add('hidden');
        $('pc-controls').classList.add('hidden');
        $('pc-waiting').classList.add('hidden');
        $('pc-spectator').classList.remove('hidden');
    }

    function updateTimer(time) {
        const el = $('pc-timer-display');
        if (el) {
            el.textContent = time.toFixed(1);
            el.style.color = time <= 1.5 ? '#ff2222' : time <= 3 ? '#ff8833' : '#ffffff';
        }
    }

    function updateScores(red, blue) {
        // Update mini scores on all views
        document.querySelectorAll('.pc-score-mini').forEach(el => {
            el.innerHTML = `
        <span class="red">RED: <strong>${red}</strong></span>
        <span class="blue">BLUE: <strong>${blue}</strong></span>
      `;
        });
    }

    function updateLobbySeats(lobbyState) {
        const container = $('pc-lobby-seats');
        if (!container) return;
        container.innerHTML = lobbyState.seats.map(s => `
      <div class="pc-seat ${s.taken ? 'taken' : 'empty'} ${s.key === mySeat ? 'mine' : ''}">
        <span class="pc-seat-label">${s.label}</span>
        <span class="pc-seat-name">${s.taken ? s.name : '---'}</span>
      </div>
    `).join('');
    }

    function addFeedItem(text) {
        const feed = $('pc-spec-feed');
        if (!feed) return;
        const div = document.createElement('div');
        div.className = 'feed-item';
        div.textContent = text;
        feed.prepend(div);
        // Limit to 20
        while (feed.children.length > 20) feed.removeChild(feed.lastChild);
    }

    return {
        init,
        showControls,
        showWaiting,
        showLobby,
        showSpectator,
        updateTimer,
        updateScores,
        updateLobbySeats,
        addFeedItem,
        get isMyTurn() { return isMyTurn; },
    };
})();
