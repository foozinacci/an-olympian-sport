/* ═══════════════════════════════════════════
   AN OLYMPIAN SPORT 💣 — NETWORK LAYER
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

    // ICE servers for NAT traversal
    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
    ];

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

        // PeerJS ID = "OLYMP-{code}" so joiners can find us
        const peerId = `OLYMP-${roomCode}`;

        console.log(`[NET] Creating host peer: ${peerId}`);

        peer = new Peer(peerId, {
            debug: 2, // increased debug for troubleshooting
            config: {
                iceServers: ICE_SERVERS,
            }
        });

        peer.on('open', id => {
            console.log(`[NET] ✅ Host peer OPEN: ${id}, room code: ${roomCode}`);
            emit('roomCreated', { code: roomCode });
        });

        peer.on('connection', conn => {
            console.log(`[NET] Incoming connection from: ${conn.peer}`);
            handleIncomingConnection(conn);
        });

        peer.on('error', err => {
            console.error('[NET] Host peer error:', err.type, err.message);
            if (err.type === 'unavailable-id') {
                // Room code collision — regenerate
                roomCode = generateRoomCode();
                peer.destroy();
                hostGame(callback);
            } else {
                emit('error', { message: err.message || 'Connection error' });
            }
        });

        peer.on('disconnected', () => {
            console.warn('[NET] Host peer disconnected from signaling. Attempting reconnect...');
            if (peer && !peer.destroyed) {
                peer.reconnect();
            }
        });

        return roomCode;
    }

    function handleIncomingConnection(conn) {
        console.log(`[NET] Waiting for connection to open from: ${conn.peer}`);

        conn.on('open', () => {
            console.log(`[NET] ✅ Connection OPEN from: ${conn.peer}`);

            conn.on('data', data => {
                console.log(`[NET] Data from ${conn.peer}:`, data.type);
                handleHostMessage(conn, data);
            });

            conn.on('close', () => {
                console.log(`[NET] Connection closed: ${conn.peer}`);
                handleDisconnect(conn.peer);
            });

            conn.on('error', err => {
                console.error(`[NET] Connection error from ${conn.peer}:`, err);
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

                console.log(`[NET] ✅ Player joined: ${name} as ${assignedRole} (seat: ${assignedSeat})`);

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
        console.log(`[NET] 🎮 Game starting with:`, names);
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

        console.log(`[NET] Joining room: ${roomCode} as ${name}`);

        peer = new Peer(undefined, {
            debug: 2,
            config: {
                iceServers: ICE_SERVERS,
            }
        });

        peer.on('open', myId => {
            console.log(`[NET] ✅ Client peer OPEN: ${myId}`);
            const hostPeerId = `OLYMP-${roomCode}`;
            console.log(`[NET] Connecting to host: ${hostPeerId}`);

            hostConn = peer.connect(hostPeerId, { reliable: true });

            hostConn.on('open', () => {
                console.log(`[NET] ✅ Connected to host!`);
                hostConn.send({
                    type: 'joinRequest',
                    name,
                    wantRole,
                });
            });

            hostConn.on('data', data => {
                console.log(`[NET] Data from host:`, data.type);
                handleClientMessage(data);
            });

            hostConn.on('close', () => {
                console.log(`[NET] Host connection closed`);
                emit('disconnected', { reason: 'Host disconnected' });
            });

            hostConn.on('error', err => {
                console.error(`[NET] Host connection error:`, err);
                emit('error', { message: 'Connection to host failed' });
            });
        });

        peer.on('error', err => {
            console.error('[NET] Client peer error:', err.type, err.message);
            if (err.type === 'peer-unavailable') {
                emit('error', { message: `Room "${roomCode}" not found. Check the code!` });
            } else if (err.type === 'network') {
                emit('error', { message: 'Network error — check your connection' });
            } else if (err.type === 'server-error') {
                emit('error', { message: 'PeerJS server error — try again' });
            } else {
                emit('error', { message: err.message || 'Connection error' });
            }
        });

        peer.on('disconnected', () => {
            console.warn('[NET] Client peer disconnected from signaling');
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
