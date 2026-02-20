/* ═══════════════════════════════════════════
   AN OLYMPIAN SPORT 💣 — APP BOOTSTRAPPER
   Wires together Network, Game, Controller
   ═══════════════════════════════════════════ */

const App = (() => {
    const $ = id => document.getElementById(id);
    let currentView = 'landing';
    let connectionTimeout = null;

    function init() {
        setupLanding();
        setupNameInput();
        // Init audio on any first interaction
        document.addEventListener('click', () => AudioEngine.init(), { once: true });
        document.addEventListener('touchstart', () => AudioEngine.init(), { once: true });
    }

    /* ══════════════════════════════════
       LANDING SCREEN
       ══════════════════════════════════ */
    function setupLanding() {
        $('btn-host').addEventListener('click', () => {
            AudioEngine.init();
            AudioEngine.uiClick();
            startAsHost();
        });

        $('btn-join').addEventListener('click', () => {
            AudioEngine.init();
            AudioEngine.uiClick();
            const code = $('join-code-input').value.trim();
            if (code.length !== 4) {
                shakeElement($('join-code-input'));
                return;
            }
            startAsPlayer(code);
        });

        // Enter key on join code
        $('join-code-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') $('btn-join').click();
        });

        // Force uppercase on code input
        $('join-code-input').addEventListener('input', e => {
            e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        });
    }

    /* ══════════════════════════════════
       HOST FLOW
       ══════════════════════════════════ */
    function startAsHost() {
        // Show lobby immediately with "connecting..." state
        showView('host-lobby');
        $('room-code-display').textContent = '...';
        $('join-url-display').textContent = window.location.host || window.location.hostname;

        const code = Network.hostGame(handleHostEvent);

        $('btn-start-game').addEventListener('click', () => {
            AudioEngine.uiClick();
            Network.hostStartGame();
        });
    }

    function handleHostEvent(event, data) {
        switch (event) {
            case 'roomCreated':
                console.log('[APP] Room created:', data.code);
                $('room-code-display').textContent = data.code;
                $('host-status').textContent = '✅ Room live — waiting for players';
                $('host-status').style.color = '#00ff66';
                break;

            case 'lobbyUpdated':
                updateHostLobby(data);
                break;

            case 'gameStart': {
                showView('game');
                Game.initGame(data.names);
                break;
            }

            case 'playerInput':
                handleRemotePlayerInput(data);
                break;

            case 'playerDisconnected':
                console.log(`[APP] ${data.name} disconnected from seat ${data.seat}`);
                // TODO: could show a toast notification on the host screen
                break;

            case 'error':
                console.error('[APP] Host error:', data.message);
                $('room-code-display').textContent = 'ERR';
                $('host-status').textContent = '❌ ' + (data.message || 'Connection error');
                $('host-status').style.color = '#ff4444';
                break;
        }
    }

    function updateHostLobby(lobbyState) {
        // Update seat displays
        lobbyState.seats.forEach(s => {
            const el = $(`seat-${s.key}`);
            if (el) {
                el.textContent = s.taken ? s.name : 'WAITING...';
                el.parentElement.classList.toggle('filled', s.taken);
                el.parentElement.querySelector('.seat-status').className =
                    `seat-status ${s.taken ? 'filled' : 'empty'}`;
            }
        });

        // Spectators
        $('spec-count').textContent = lobbyState.spectatorCount;
        $('spectator-list').innerHTML = lobbyState.spectators
            .map(s => `<div class="spec-chip">${s.name}</div>`)
            .join('');

        // Start button
        const btn = $('btn-start-game');
        const playerCount = lobbyState.playerCount;
        if (playerCount > 0) {
            btn.disabled = false;
            btn.textContent = playerCount < 4
                ? `START (${playerCount}/4 — CPU FILLS EMPTY)`
                : 'START GAME';
        } else {
            btn.disabled = true;
            btn.textContent = 'WAITING FOR PLAYERS...';
        }
    }

    function handleRemotePlayerInput(data) {
        const { seat, type: inputType } = data;

        // Only process if it's the active player's seat
        if (!Game.isActiveSeat || !Game.isActiveSeat(seat)) return;

        switch (inputType) {
            case 'aim':
                Game.setRemoteAim(data.x, data.y);
                break;
            case 'chargeStart':
                Game.startRemoteCharge();
                break;
            case 'charging':
                Game.updateRemoteCharge(data.power);
                break;
            case 'throw':
                Game.executeRemoteThrow(data.power, data.aimX, data.aimY);
                break;
        }
    }

    /* ══════════════════════════════════
       PLAYER/SPECTATOR FLOW (Phone Join)
       ══════════════════════════════════ */
    function startAsPlayer(code) {
        const name = localStorage.getItem('degen-name') || 'Player';

        // Show controller screen with "connecting" status
        showView('player-controller');
        Controller.showLobby();
        $('pc-name-input').value = name;
        setJoinStatus('connecting', `Connecting to room ${code}...`);

        // Set a timeout — if PeerJS doesn't connect in 8 seconds, show error
        connectionTimeout = setTimeout(() => {
            setJoinStatus('error', `Could not find room ${code}. Check the code and try again.`);
        }, 8000);

        Network.joinGame(code, name, 'player', handlePlayerEvent);
    }

    function handlePlayerEvent(event, data) {
        switch (event) {
            case 'joined':
                // Clear timeout — we connected!
                if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; }

                Controller.init(data.seat, data.name);
                $('pc-seat-badge').textContent = data.seatLabel;
                $('pc-seat-badge').className = `pc-badge ${data.seat.startsWith('red') ? 'red' : 'blue'}`;
                setJoinStatus('connected', `Joined as ${data.seatLabel}!`);

                if (data.role === 'spectator') {
                    Controller.showSpectator();
                    setJoinStatus('connected', 'Joined as spectator');
                }
                break;

            case 'joinDenied':
                if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; }
                setJoinStatus('error', data.reason || 'Join denied');
                setTimeout(() => {
                    showView('landing');
                }, 2000);
                break;

            case 'lobbyUpdated':
                Controller.updateLobbySeats(data);
                break;

            case 'gameStarted':
                Controller.showWaiting('Game is starting...');
                break;

            case 'yourTurn':
                Controller.showControls(data.timer);
                break;

            case 'turnStart':
                if (!Controller.isMyTurn) {
                    Controller.showWaiting(`${data.playerName} is throwing...`);
                }
                break;

            case 'throwResult':
                Controller.showWaiting(data.result.label || 'Result!');
                Controller.addFeedItem(data.result.description || '');
                break;

            case 'gameState':
                Controller.updateScores(data.scores?.red || 0, data.scores?.blue || 0);
                break;

            case 'splash':
                Controller.addFeedItem(data.text || '');
                break;

            case 'disconnected':
                if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; }
                setJoinStatus('error', 'Disconnected from host');
                setTimeout(() => {
                    showView('landing');
                    Network.destroy();
                }, 2000);
                break;

            case 'error':
                if (connectionTimeout) { clearTimeout(connectionTimeout); connectionTimeout = null; }
                setJoinStatus('error', data.message || 'Connection error');
                setTimeout(() => {
                    showView('landing');
                    Network.destroy();
                }, 3000);
                break;
        }
    }

    /* ── Join status display (shown on phone controller lobby) ── */
    function setJoinStatus(status, text) {
        const statusEl = document.querySelector('.pc-status');
        if (!statusEl) return;

        const emojiEl = statusEl.querySelector('.pc-emoji');
        const textEl = statusEl.querySelector('p');

        if (status === 'connecting') {
            if (emojiEl) emojiEl.textContent = '⏳';
            if (textEl) textEl.textContent = text;
        } else if (status === 'connected') {
            if (emojiEl) emojiEl.textContent = '🎯';
            if (textEl) textEl.textContent = text;
        } else if (status === 'error') {
            if (emojiEl) emojiEl.textContent = '❌';
            if (textEl) { textEl.textContent = text; textEl.style.color = '#ff4444'; }
        }
    }

    /* ══════════════════════════════════
       NAME INPUT
       ══════════════════════════════════ */
    function setupNameInput() {
        const input = $('pc-name-input');
        if (!input) return;
        input.addEventListener('change', () => {
            const name = input.value.trim() || 'Player';
            localStorage.setItem('degen-name', name);
            Network.sendNameChange(name);
        });
    }

    /* ══════════════════════════════════
       VIEW MANAGEMENT
       ══════════════════════════════════ */
    function showView(view) {
        currentView = view;
        $('landing-screen').classList.toggle('hidden', view !== 'landing');
        $('host-lobby').classList.toggle('hidden', view !== 'host-lobby');
        $('player-controller').classList.toggle('hidden', view !== 'player-controller');

        // Game view: hide lobby stuff, show canvas + HUD
        if (view === 'game') {
            $('landing-screen').classList.add('hidden');
            $('host-lobby').classList.add('hidden');
            $('player-controller').classList.add('hidden');
            $('hud').classList.add('active');
        }
    }

    function shakeElement(el) {
        el.style.animation = 'shakeLight 0.3s ease';
        setTimeout(() => el.style.animation = '', 300);
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
