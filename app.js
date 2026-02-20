/* ═══════════════════════════════════════════
   DEGEN HORSESHOES 💣 — APP BOOTSTRAPPER
   Wires together Network, Game, Controller
   ═══════════════════════════════════════════ */

const App = (() => {
    const $ = id => document.getElementById(id);
    let currentView = 'landing';

    function init() {
        setupLanding();
        setupNameInput();
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
        const code = Network.hostGame(handleHostEvent);
        showView('host-lobby');

        $('room-code-display').textContent = code;
        $('join-url-display').textContent = window.location.host;

        $('btn-start-game').addEventListener('click', () => {
            AudioEngine.uiClick();
            Network.hostStartGame();
        });
    }

    function handleHostEvent(event, data) {
        switch (event) {
            case 'roomCreated':
                $('room-code-display').textContent = data.code;
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
                console.log(`[HOST] ${data.name} disconnected from seat ${data.seat}`);
                break;

            case 'error':
                console.error('[HOST] Error:', data.message);
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
        // Forward remote input as if it were local keyboard input
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

        Network.joinGame(code, name, 'player', handlePlayerEvent);
        showView('player-controller');

        $('pc-name-input').value = name;
        Controller.showLobby();
    }

    function handlePlayerEvent(event, data) {
        switch (event) {
            case 'joined':
                Controller.init(data.seat, data.name);
                $('pc-seat-badge').textContent = data.seatLabel;
                $('pc-seat-badge').className = `pc-badge ${data.seat.startsWith('red') ? 'red' : 'blue'}`;
                if (data.role === 'spectator') {
                    Controller.showSpectator();
                }
                break;

            case 'joinDenied':
                alert(data.reason);
                showView('landing');
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
                // Could show splash text on phone too
                Controller.addFeedItem(data.text || '');
                break;

            case 'disconnected':
                alert('Disconnected from host');
                showView('landing');
                Network.destroy();
                break;

            case 'error':
                alert(data.message);
                showView('landing');
                Network.destroy();
                break;
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
