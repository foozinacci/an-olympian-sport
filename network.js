/* ═══════════════════════════════════════════
   DEGEN HORSESHOES 💣 — NETWORK LAYER
   PeerJS-based P2P multiplayer with join codes
   Host = game authority, Players = phone controllers
   ═══════════════════════════════════════════ */

const Network = (() => {

    let peer = null;
    let connections = new Map(); // peerId → { conn, role, seat, name, playerKey }
    let hostConn = null; // client→host connection
    let role = null; // 'host' | 'player' | 'spectator'
    let roomCode = '';
    let onEventCallback = null;

    const MAX_PLAYERS = 4;
    const MAX_SPECTATORS = 8;
    const PLAYER_SEATS = ['redA', 'redB', 'blueA', 'blueB'];
    const SEAT_LABELS = {
        redA: 'RED A', redB: 'RED B',
        blueA: 'BLUE A', blueB: 'BLUE B',
    };

    // Lobby state (host tracks this)
    let lobby = {
        players: {}, // seat → { name, peerId }
        spectators: [], // [{ name, peerId }]
        started: false,
    };

    /* ══════════════════════════════════
       ROOM CODE GENERATION
       ══════════════════════════════════ */
    function generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/1/0 confusion
        let code = '';
        for (let i = 0; i < 4; i++) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }

    /* ══════════════════════════════════
       HOST — Create Room
       ══════════════════════════════════ */
    function hostGame(callback) {
        onEventCallback = callback;
        role = 'host';
        roomCode = generateRoomCode();

        // PeerJS ID = "DEGEN-{code}" so joiners can find us
        const peerId = `DEGEN-${roomCode}`;

        peer = new Peer(peerId, {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                ]
            }
        });

        peer.on('open', id => {
            console.log(`[HOST] Room created: ${roomCode} (peer: ${id})`);
            emit('roomCreated', { code: roomCode });
        });

        peer.on('connection', conn => {
            handleIncomingConnection(conn);
        });

        peer.on('error', err => {
            console.error('[HOST] Peer error:', err);
            if (err.type === 'unavailable-id') {
                // Room code collision — regenerate
                roomCode = generateRoomCode();
                peer.destroy();
                hostGame(callback);
            } else {
                emit('error', { message: err.message || 'Connection error' });
            }
        });

        return roomCode;
    }

    function handleIncomingConnection(conn) {
        conn.on('open', () => {
            console.log(`[HOST] Peer connected: ${conn.peer}`);

            conn.on('data', data => {
                handleHostMessage(conn, data);
            });

            conn.on('close', () => {
                handleDisconnect(conn.peer);
            });
        });
    }

    function handleHostMessage(conn, data) {
        switch (data.type) {
            case 'joinRequest': {
                const { name, wantRole } = data;
                let assignedRole = null;
                let assignedSeat = null;

                if (wantRole === 'player') {
                    // Find open seat
                    const openSeat = PLAYER_SEATS.find(s => !lobby.players[s]);
                    if (openSeat && !lobby.started) {
                        assignedRole = 'player';
                        assignedSeat = openSeat;
                        lobby.players[openSeat] = { name, peerId: conn.peer };
                        connections.set(conn.peer, { conn, role: 'player', seat: openSeat, name });
                    } else if (lobby.spectators.length < MAX_SPECTATORS) {
                        // Full — assign as spectator
                        assignedRole = 'spectator';
                        lobby.spectators.push({ name, peerId: conn.peer });
                        connections.set(conn.peer, { conn, role: 'spectator', seat: null, name });
                    } else {
                        conn.send({ type: 'joinDenied', reason: 'Room is full' });
                        return;
                    }
                } else {
                    // Wants spectator
                    if (lobby.spectators.length < MAX_SPECTATORS) {
                        assignedRole = 'spectator';
                        lobby.spectators.push({ name, peerId: conn.peer });
                        connections.set(conn.peer, { conn, role: 'spectator', seat: null, name });
                    } else {
                        conn.send({ type: 'joinDenied', reason: 'Spectator seats full' });
                        return;
                    }
                }

                // Confirm to joiner
                conn.send({
                    type: 'joinConfirmed',
                    role: assignedRole,
                    seat: assignedSeat,
                    seatLabel: assignedSeat ? SEAT_LABELS[assignedSeat] : null,
                    name,
                });

                // Broadcast updated lobby to all
                broadcastLobby();
                emit('lobbyUpdated', getLobbyState());
                break;
            }

            case 'seatSwap': {
                const info = connections.get(conn.peer);
                if (!info || info.role !== 'player' || lobby.started) return;
                const { targetSeat } = data;
                if (!PLAYER_SEATS.includes(targetSeat)) return;
                if (lobby.players[targetSeat]) return; // Seat taken

                // Remove from old seat
                delete lobby.players[info.seat];
                // Assign new seat
                lobby.players[targetSeat] = { name: info.name, peerId: conn.peer };
                info.seat = targetSeat;
                connections.set(conn.peer, info);

                conn.send({ type: 'seatUpdated', seat: targetSeat, seatLabel: SEAT_LABELS[targetSeat] });
                broadcastLobby();
                emit('lobbyUpdated', getLobbyState());
                break;
            }

            case 'playerInput': {
                // Forward player input to game engine
                const info = connections.get(conn.peer);
                if (!info || info.role !== 'player') return;
                emit('playerInput', { seat: info.seat, ...data.input });
                break;
            }

            case 'changeName': {
                const info = connections.get(conn.peer);
                if (!info || lobby.started) return;
                info.name = data.name;
                if (info.role === 'player' && lobby.players[info.seat]) {
                    lobby.players[info.seat].name = data.name;
                }
                connections.set(conn.peer, info);
                broadcastLobby();
                emit('lobbyUpdated', getLobbyState());
                break;
            }
        }
    }

    function handleDisconnect(peerId) {
        const info = connections.get(peerId);
        if (!info) return;

        if (info.role === 'player') {
            delete lobby.players[info.seat];
        } else if (info.role === 'spectator') {
            lobby.spectators = lobby.spectators.filter(s => s.peerId !== peerId);
        }

        connections.delete(peerId);
        broadcastLobby();
        emit('playerDisconnected', { name: info.name, seat: info.seat, role: info.role });
        emit('lobbyUpdated', getLobbyState());
    }

    /* ── Host broadcasts ── */
    function broadcastLobby() {
        const lobbyState = getLobbyState();
        broadcast({ type: 'lobbyState', lobby: lobbyState });
    }

    function broadcast(data) {
        connections.forEach(({ conn }) => {
            try { conn.send(data); } catch (e) { }
        });
    }

    function sendToPlayer(seat, data) {
        const entry = [...connections.values()].find(c => c.seat === seat);
        if (entry) {
            try { entry.conn.send(data); } catch (e) { }
        }
    }

    function broadcastGameState(gameState) {
        broadcast({ type: 'gameState', state: gameState });
    }

    function broadcastTurnStart(playerKey, timer, playerName) {
        broadcast({
            type: 'turnStart',
            activePlayer: playerKey,
            timer,
            playerName,
        });

        // Tell the active player they're up
        sendToPlayer(playerKey, {
            type: 'yourTurn',
            timer,
        });
    }

    function broadcastResult(result) {
        broadcast({ type: 'throwResult', result });
    }

    function broadcastSplash(splash) {
        broadcast({ type: 'splash', splash });
    }

    function hostStartGame() {
        lobby.started = true;
        // Fill empty seats with CPU names
        const cpuNames = ['BOT-1', 'BOT-2', 'BOT-3', 'BOT-4'];
        let cpuIdx = 0;
        PLAYER_SEATS.forEach(seat => {
            if (!lobby.players[seat]) {
                lobby.players[seat] = { name: cpuNames[cpuIdx++], peerId: null, isCPU: true };
            }
        });

        const names = PLAYER_SEATS.map(s => lobby.players[s].name);
        broadcast({ type: 'gameStarted', names });
        broadcastLobby();
        emit('gameStart', { names });
    }

    /* ══════════════════════════════════
       CLIENT — Join Room
       ══════════════════════════════════ */
    function joinGame(code, name, wantRole, callback) {
        onEventCallback = callback;
        role = wantRole;
        roomCode = code.toUpperCase();

        peer = new Peer(undefined, {
            debug: 0,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                ]
            }
        });

        peer.on('open', () => {
            const hostPeerId = `DEGEN-${roomCode}`;
            hostConn = peer.connect(hostPeerId, { reliable: true });

            hostConn.on('open', () => {
                console.log(`[CLIENT] Connected to host: ${roomCode}`);
                hostConn.send({
                    type: 'joinRequest',
                    name,
                    wantRole,
                });
            });

            hostConn.on('data', data => {
                handleClientMessage(data);
            });

            hostConn.on('close', () => {
                emit('disconnected', { reason: 'Host disconnected' });
            });

            hostConn.on('error', err => {
                emit('error', { message: 'Connection failed' });
            });
        });

        peer.on('error', err => {
            console.error('[CLIENT] Peer error:', err);
            emit('error', { message: err.type === 'peer-unavailable' ? 'Room not found' : err.message });
        });
    }

    function handleClientMessage(data) {
        switch (data.type) {
            case 'joinConfirmed':
                role = data.role;
                emit('joined', data);
                break;
            case 'joinDenied':
                emit('joinDenied', data);
                break;
            case 'seatUpdated':
                emit('seatUpdated', data);
                break;
            case 'lobbyState':
                emit('lobbyUpdated', data.lobby);
                break;
            case 'gameStarted':
                emit('gameStarted', data);
                break;
            case 'gameState':
                emit('gameState', data.state);
                break;
            case 'turnStart':
                emit('turnStart', data);
                break;
            case 'yourTurn':
                emit('yourTurn', data);
                break;
            case 'throwResult':
                emit('throwResult', data);
                break;
            case 'splash':
                emit('splash', data.splash);
                break;
        }
    }

    /* ── Client sends ── */
    function sendInput(input) {
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'playerInput', input });
        }
    }

    function sendSeatSwap(targetSeat) {
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'seatSwap', targetSeat });
        }
    }

    function sendNameChange(name) {
        if (hostConn && hostConn.open) {
            hostConn.send({ type: 'changeName', name });
        }
    }

    /* ══════════════════════════════════
       HELPERS
       ══════════════════════════════════ */
    function getLobbyState() {
        return {
            code: roomCode,
            players: { ...lobby.players },
            spectators: [...lobby.spectators],
            playerCount: Object.keys(lobby.players).length,
            spectatorCount: lobby.spectators.length,
            started: lobby.started,
            seats: PLAYER_SEATS.map(s => ({
                key: s,
                label: SEAT_LABELS[s],
                taken: !!lobby.players[s],
                name: lobby.players[s]?.name || null,
                isCPU: lobby.players[s]?.isCPU || false,
            })),
        };
    }

    function emit(event, data) {
        if (onEventCallback) onEventCallback(event, data);
    }

    function isHost() { return role === 'host'; }
    function isPlayer() { return role === 'player'; }
    function isSpectator() { return role === 'spectator'; }
    function getRole() { return role; }
    function getCode() { return roomCode; }

    function destroy() {
        if (peer) peer.destroy();
        connections.clear();
        hostConn = null;
        role = null;
        roomCode = '';
        lobby = { players: {}, spectators: [], started: false };
    }

    return {
        hostGame,
        joinGame,
        sendInput,
        sendSeatSwap,
        sendNameChange,
        hostStartGame,
        broadcast,
        broadcastGameState,
        broadcastTurnStart,
        broadcastResult,
        broadcastSplash,
        sendToPlayer,
        getLobbyState,
        isHost, isPlayer, isSpectator,
        getRole, getCode,
        destroy,
        get lobby() { return lobby; },
        PLAYER_SEATS,
        SEAT_LABELS,
    };
})();
