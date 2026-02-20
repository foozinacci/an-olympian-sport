/* ═══════════════════════════════════════════
   DEGEN HORSESHOES 💣 — GAME ENGINE
   State machine, scoring, timer economy, turns
   ═══════════════════════════════════════════ */

const Game = (() => {

    /* ── Constants ── */
    const TOTAL_ROUNDS = 6;
    const BASE_TIMER = 8.0;
    const TIMER_FLOOR = 2.0;
    const TIMER_CAP = 8.0;
    const POWER_CHARGE_RATE = 0.7; // per second (0→1 in ~1.4s)

    const SCORING = {
        ringer: { points: 5, opponentTimerPenalty: -3, label: '🎯 RINGER', cssClass: 'ringer' },
        leaner: { points: 4, opponentTimerPenalty: -2, label: '🔥 LEANER', cssClass: 'leaner' },
        close: { points: 3, opponentTimerPenalty: -1, label: '✅ CLOSE', cssClass: 'close' },
        near: { points: 2, opponentTimerPenalty: 0, label: '🟡 NEAR', cssClass: 'near' },
        far: { points: 1, opponentTimerPenalty: 0, label: '⬜ FAR', cssClass: 'far' },
        whiff: { points: 0, opponentTimerPenalty: 0, label: '💨 WHIFF', cssClass: 'whiff' },
        void: { points: 0, opponentTimerPenalty: 0, label: '💨 WHIFF', cssClass: 'whiff' },
    };

    /* ── State ── */
    let state = null;
    let timerInterval = null;
    let fuseHiss = null;
    let chargeHum = null;
    let inputState = { left: false, right: false, up: false, down: false, space: false };
    let powerCharging = false;
    let currentPower = 0;
    let currentAimH = 0;
    let currentAimV = 0.6;
    let throwInProgress = false;
    let gamePhase = 'setup'; // setup, preTurn, aiming, flight, result, roundEnd, gameOver, goldenApple

    /* ── DOM Refs ── */
    const $ = id => document.getElementById(id);

    /* ══════════════════════════════════
       INIT / SETUP
       ══════════════════════════════════ */
    function initGame(players) {
        AudioEngine.init();

        state = {
            round: 1,
            throwInRound: 0,
            scores: { red: 0, blue: 0 },
            players: {
                redA: { name: players[0], team: 'red', key: 'redA', timerMod: 0, totalScore: 0, ringers: 0, explosions: 0, lastResult: null },
                redB: { name: players[1], team: 'red', key: 'redB', timerMod: 0, totalScore: 0, ringers: 0, explosions: 0, lastResult: null },
                blueA: { name: players[2], team: 'blue', key: 'blueA', timerMod: 0, totalScore: 0, ringers: 0, explosions: 0, lastResult: null },
                blueB: { name: players[3], team: 'blue', key: 'blueB', timerMod: 0, totalScore: 0, ringers: 0, explosions: 0, lastResult: null },
            },
            turnOrder: [],
            currentTurnIndex: 0,
            goldenAppleUsed: false,
            goldenAppleRound: 3 + Math.floor(Math.random() * 3), // 3-5
            roundEvents: [],
            doubleRingerTracking: { red: 0, blue: 0 },
            suddenDeath: false,
        };

        // Turn order
        updateTurnOrder();

        // Init scene
        GameScene.init();

        // Show HUD (view switching handled by app.js)
        $('hud').classList.add('active');

        updateScoreboard();

        // Setup keyboard input (for host-local play / debug)
        setupInput();

        // Start game
        setTimeout(() => startRound(), 1000);
    }

    function updateTurnOrder() {
        const r = state.round;
        if (state.suddenDeath) {
            // One throw each — same alternating order
            state.turnOrder = ['redA', 'blueA', 'redB', 'blueB'];
        } else if (r % 2 === 1) {
            // Odd: A, C, B, D
            state.turnOrder = ['redA', 'blueA', 'redB', 'blueB'];
        } else {
            // Even: B, D, A, C
            state.turnOrder = ['redB', 'blueB', 'redA', 'blueA'];
        }
        state.currentTurnIndex = 0;
        state.throwInRound = 0;
        state.doubleRingerTracking = { red: 0, blue: 0 };
    }

    /* ══════════════════════════════════
       INPUT
       ══════════════════════════════════ */
    function setupInput() {
        // Guard: keyboard only allowed in solo/local play (no network)
        // When network is active, bots auto-throw and remote players use phones
        function keyboardAllowed() {
            // If network exists and we're hosting, keyboard is disabled
            // (bots auto-play, remote players use phones)
            if (typeof Network !== 'undefined' && Network.isHost()) return false;
            // No network = solo local play, keyboard is fine
            if (typeof Network === 'undefined') return true;
            return false;
        }

        document.addEventListener('keydown', e => {
            if (gamePhase !== 'aiming') return;
            if (!keyboardAllowed()) return;
            switch (e.key.toLowerCase()) {
                case 'a': inputState.left = true; break;
                case 'd': inputState.right = true; break;
                case 'w': inputState.up = true; break;
                case 's': inputState.down = true; break;
                case ' ':
                    e.preventDefault();
                    if (!powerCharging) {
                        powerCharging = true;
                        currentPower = 0;
                        if (chargeHum) chargeHum.stop();
                        chargeHum = AudioEngine.startChargeHum();
                        $('power-meter-container').classList.add('active');
                    }
                    break;
            }
        });

        document.addEventListener('keyup', e => {
            if (!keyboardAllowed()) return;
            switch (e.key.toLowerCase()) {
                case 'a': inputState.left = false; break;
                case 'd': inputState.right = false; break;
                case 'w': inputState.up = false; break;
                case 's': inputState.down = false; break;
                case ' ':
                    if (powerCharging && gamePhase === 'aiming') {
                        powerCharging = false;
                        if (chargeHum) { chargeHum.stop(); chargeHum = null; }
                        executeThrow();
                    }
                    break;
            }
        });
    }

    /* ── Aim update loop ── */
    let aimLoopId = null;
    function startAimLoop() {
        const AIM_SPEED = 1.5;
        const ARC_SPEED = 0.8;
        let lastTime = performance.now();

        function update() {
            if (gamePhase !== 'aiming') return;
            const now = performance.now();
            const dt = (now - lastTime) / 1000;
            lastTime = now;

            // Aim
            if (inputState.left) currentAimH = Math.max(-1, currentAimH - AIM_SPEED * dt);
            if (inputState.right) currentAimH = Math.min(1, currentAimH + AIM_SPEED * dt);
            if (inputState.up) currentAimV = Math.min(1, currentAimV + ARC_SPEED * dt);
            if (inputState.down) currentAimV = Math.max(0, currentAimV - ARC_SPEED * dt);

            GameScene.setAim(currentAimH, currentAimV);

            // Update aim indicator
            const dot = $('aim-dot');
            if (dot) {
                dot.style.left = `${50 + currentAimH * 35}%`;
                dot.style.top = `${50 - (currentAimV - 0.5) * 60}%`;
            }

            // Power charge
            if (powerCharging) {
                currentPower = Math.min(1, currentPower + POWER_CHARGE_RATE * dt);
                updatePowerMeter(currentPower);
                GameScene.setCharge(currentPower);
                if (chargeHum) chargeHum.setPower(currentPower);
                updateTouchPowerBar();
            }

            aimLoopId = requestAnimationFrame(update);
        }
        aimLoopId = requestAnimationFrame(update);
    }

    function stopAimLoop() {
        if (aimLoopId) cancelAnimationFrame(aimLoopId);
        aimLoopId = null;
    }

    /* ── Controls hint + touch overlay ── */
    let touchInputSetup = false;

    function showControlsHint() {
        const hint = $('controls-hint');
        const touchOverlay = $('touch-overlay');
        const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

        if (isTouchDevice) {
            // Mobile — show touch overlay for aiming + throwing
            if (hint) hint.classList.remove('active');
            if (touchOverlay) {
                touchOverlay.classList.remove('hidden');
                touchOverlay.classList.add('active');
            }
            if (!touchInputSetup) {
                setupTouchInput();
                touchInputSetup = true;
            }
        } else {
            // Desktop — show keyboard hint (WASD + SPACE)
            if (hint) hint.classList.add('active');
            if (touchOverlay) {
                touchOverlay.classList.add('hidden');
                touchOverlay.classList.remove('active');
            }
        }
    }

    function hideControlsHint() {
        const hint = $('controls-hint');
        const touchOverlay = $('touch-overlay');
        if (hint) hint.classList.remove('active');
        if (touchOverlay) {
            touchOverlay.classList.remove('active');
            touchOverlay.classList.add('hidden');
        }
    }

    /* ── Touch input on host screen (mobile) ── */
    function setupTouchInput() {
        const aimZone = $('touch-aim-zone');
        const throwBtn = $('touch-throw-btn');
        if (!aimZone || !throwBtn) return;

        // Aim zone — drag to move aim
        aimZone.addEventListener('touchstart', e => {
            e.preventDefault();
        }, { passive: false });

        aimZone.addEventListener('touchmove', e => {
            e.preventDefault();
            if (gamePhase !== 'aiming') return;
            const touch = e.touches[0];
            const rect = aimZone.getBoundingClientRect();
            const relX = (touch.clientX - rect.left) / rect.width;
            const relY = (touch.clientY - rect.top) / rect.height;

            currentAimH = (relX - 0.5) * 2; // -1 to 1
            currentAimV = 1 - relY; // 0 (bottom) to 1 (top)
            currentAimH = Math.max(-1, Math.min(1, currentAimH));
            currentAimV = Math.max(0, Math.min(1, currentAimV));

            GameScene.setAim(currentAimH, currentAimV);

            // Update reticle
            const reticle = $('touch-reticle');
            if (reticle) {
                reticle.style.left = `${relX * 100}%`;
                reticle.style.top = `${relY * 100}%`;
            }

            // Update HUD aim dot too
            const dot = $('aim-dot');
            if (dot) {
                dot.style.left = `${50 + currentAimH * 35}%`;
                dot.style.top = `${50 - (currentAimV - 0.5) * 60}%`;
            }
        }, { passive: false });

        // Throw button — hold to charge, release to throw
        let touchCharging = false;

        const startTouchCharge = (e) => {
            e.preventDefault();
            if (gamePhase !== 'aiming' || powerCharging) return;
            touchCharging = true;
            powerCharging = true;
            currentPower = 0;
            if (chargeHum) chargeHum.stop();
            chargeHum = AudioEngine.startChargeHum();
            $('power-meter-container').classList.add('active');
            throwBtn.classList.add('charging');
            const label = throwBtn.querySelector('.touch-throw-label');
            if (label) label.textContent = 'CHARGING...';
        };

        const endTouchCharge = (e) => {
            e.preventDefault();
            if (!touchCharging || gamePhase !== 'aiming') return;
            touchCharging = false;
            powerCharging = false;
            if (chargeHum) { chargeHum.stop(); chargeHum = null; }
            throwBtn.classList.remove('charging');
            const label = throwBtn.querySelector('.touch-throw-label');
            if (label) label.textContent = 'HOLD TO CHARGE';

            // Reset power bar
            const fill = $('touch-power-fill');
            if (fill) fill.style.width = '0%';

            executeThrow();
        };

        throwBtn.addEventListener('touchstart', startTouchCharge, { passive: false });
        throwBtn.addEventListener('touchend', endTouchCharge, { passive: false });
        throwBtn.addEventListener('touchcancel', endTouchCharge, { passive: false });

        // Mouse fallback for testing
        throwBtn.addEventListener('mousedown', startTouchCharge);
        throwBtn.addEventListener('mouseup', endTouchCharge);
        throwBtn.addEventListener('mouseleave', e => { if (touchCharging) endTouchCharge(e); });
    }

    // Update touch power bar in aim loop
    function updateTouchPowerBar() {
        const fill = $('touch-power-fill');
        if (!fill) return;
        fill.style.width = `${currentPower * 100}%`;
        if (currentPower < 0.2) fill.style.background = '#888';
        else if (currentPower < 0.4) fill.style.background = '#bbbb33';
        else if (currentPower < 0.7) fill.style.background = '#00ff66';
        else if (currentPower < 0.9) fill.style.background = '#ff8833';
        else fill.style.background = '#ff2222';
    }

    /* ══════════════════════════════════
       ROUND FLOW
       ══════════════════════════════════ */
    function startRound() {
        updateTurnOrder();
        state.roundEvents = [];

        // Check for golden apple
        if (!state.goldenAppleUsed && state.round === state.goldenAppleRound) {
            startGoldenApple();
            return;
        }

        showSplash(`ROUND ${state.round}`, '', '', 2000).then(() => {
            $('round-indicator').textContent = `ROUND ${state.round} OF ${TOTAL_ROUNDS}`;
            startTurn();
        });
    }

    function startTurn() {
        if (state.currentTurnIndex >= state.turnOrder.length) {
            endRound();
            return;
        }

        gamePhase = 'preTurn';
        const playerKey = state.turnOrder[state.currentTurnIndex];
        const player = state.players[playerKey];
        const teamColor = player.team === 'red' ? 'var(--red-team)' : 'var(--blue-team)';

        // Calculate timer
        let timer = BASE_TIMER + player.timerMod;
        timer = Math.max(TIMER_FLOOR, Math.min(TIMER_CAP, timer));
        player.currentTimer = timer;
        player.timerMod = 0; // Reset after applying

        // Set up scene
        GameScene.resetForNextThrow();
        GameScene.snapCamera();
        GameScene.setPlayerHand(playerKey);
        GameScene.setHandVisible(true);
        GameScene.setPlatformGlow(player.team);

        // Pre-turn splash
        const penaltyText = timer < BASE_TIMER ? `⏱ ${timer.toFixed(1)}s FUSE` : '';
        let penaltySource = '';
        if (timer < BASE_TIMER) {
            penaltySource = `PENALTY: -${(BASE_TIMER - timer).toFixed(1)}s`;
        }

        // Show splash
        showPlayerTurnSplash(player, timer, penaltySource).then(() => {
            // Countdown
            return showCountdown();
        }).then(() => {
            // Start aiming phase
            startAimingPhase(player, timer);
        });
    }

    function startAimingPhase(player, timer) {
        gamePhase = 'aiming';
        throwInProgress = false;
        currentPower = 0;
        currentAimH = 0;
        currentAimV = 0.6;
        powerCharging = false;

        GameScene.setHandState('idle');

        // Show HUD elements
        $('aim-indicator').classList.add('active');
        $('power-meter-container').classList.remove('active');

        // Update active player badge
        updatePlayerBadge(player);

        // Broadcast turn start to connected players
        if (typeof Network !== 'undefined' && Network.isHost()) {
            const playerKey = state.turnOrder[state.currentTurnIndex];
            Network.broadcastTurnStart(playerKey, timer, player.name);
            Network.broadcastGameState({ scores: state.scores, round: state.round });
        }

        // Start fuse timer
        startFuseTimer(player, timer);

        // Start aim loop
        startAimLoop();

        // Start fuse hiss sound
        if (fuseHiss) fuseHiss.stop();
        fuseHiss = AudioEngine.startFuseHiss();

        // CHECK: Is this a CPU seat? Auto-throw!
        if (isCPUTurn()) {
            hideControlsHint();
            scheduleCPUThrow();
        } else if (isLocalHumanTurn()) {
            // Show controls hint for local human player
            showControlsHint();
        } else {
            // Remote player's turn — hide local controls
            hideControlsHint();
        }
    }

    /* ── CPU / seat helpers ── */
    function isCPUTurn() {
        if (typeof Network === 'undefined') return false;
        if (!Network.isHost() || !state) return false;
        const activeKey = state.turnOrder[state.currentTurnIndex];
        const seatInfo = Network.lobby.players[activeKey];
        return seatInfo && seatInfo.isCPU;
    }

    function isRemoteTurn() {
        if (typeof Network === 'undefined') return false;
        if (!Network.isHost() || !state) return false;
        const activeKey = state.turnOrder[state.currentTurnIndex];
        const seatInfo = Network.lobby.players[activeKey];
        return seatInfo && !seatInfo.isCPU && seatInfo.peerId;
    }

    function isLocalHumanTurn() {
        // Local human turn = either no network at all, or network host with no remote player on this seat
        if (typeof Network === 'undefined') return true; // Solo play
        if (!Network.isHost()) return false;
        return !isCPUTurn() && !isRemoteTurn();
    }

    /* ── CPU Auto-throw AI ── */
    let cpuThrowTimeout = null;
    function scheduleCPUThrow() {
        // Random delay 1-2.5 seconds, then throw
        const delay = 1000 + Math.random() * 1500;
        cpuThrowTimeout = setTimeout(() => {
            if (gamePhase !== 'aiming') return;

            // Random aim: slight horizontal offset, decent vertical
            currentAimH = (Math.random() - 0.5) * 1.2; // -0.6 to 0.6
            currentAimV = 0.4 + Math.random() * 0.3; // 0.4 to 0.7
            GameScene.setAim(currentAimH, currentAimV);

            // Start charging
            powerCharging = true;
            currentPower = 0;
            $('power-meter-container').classList.add('active');

            // Charge for 0.5-1.2 seconds, then release
            const chargeTime = 500 + Math.random() * 700;
            setTimeout(() => {
                if (gamePhase !== 'aiming') return;
                // Land in sweet spot: 0.35 - 0.65 power
                currentPower = 0.35 + Math.random() * 0.3;
                updatePowerMeter(currentPower);
                powerCharging = false;
                executeThrow();
            }, chargeTime);
        }, delay);
    }

    /* ══════════════════════════════════
       FUSE TIMER
       ══════════════════════════════════ */
    function startFuseTimer(player, duration) {
        let remaining = duration;
        const timerEl = $('fuse-timer');
        const vignette = $('vignette');
        const borderFlash = $('border-flash');

        updateTimerDisplay(remaining);

        timerInterval = setInterval(() => {
            if (gamePhase !== 'aiming' && gamePhase !== 'flight') return;

            remaining -= 0.1;
            remaining = Math.max(0, remaining);
            updateTimerDisplay(remaining);

            // Timer pressure effects
            const fuseEl = $('fuse-timer');
            fuseEl.className = '';

            if (remaining <= 1.5) {
                fuseEl.classList.add('critical');
                vignette.classList.add('active', 'heartbeat');
                borderFlash.classList.add('active');
                GameScene.setHandShake(1);
                GameScene.setVeinPulse(4);
                if (fuseHiss) fuseHiss.setIntensity(1);
                if (remaining % 0.3 < 0.15) AudioEngine.timerTick();
            } else if (remaining <= 3) {
                fuseEl.classList.add('danger');
                vignette.classList.add('active');
                vignette.classList.remove('heartbeat');
                borderFlash.classList.remove('active');
                GameScene.setHandShake(0.5);
                GameScene.setVeinPulse(2.5);
                if (fuseHiss) fuseHiss.setIntensity(0.6);
            } else if (remaining <= 5) {
                fuseEl.classList.add('warning');
                vignette.classList.remove('active', 'heartbeat');
                borderFlash.classList.remove('active');
                GameScene.setHandShake(0.15);
                GameScene.setVeinPulse(1.5);
                if (fuseHiss) fuseHiss.setIntensity(0.3);
            } else {
                vignette.classList.remove('active', 'heartbeat');
                borderFlash.classList.remove('active');
                GameScene.setHandShake(0);
                GameScene.setVeinPulse(1);
                if (fuseHiss) fuseHiss.setIntensity(0);
            }

            // Timer expired!
            if (remaining <= 0) {
                clearInterval(timerInterval);
                stopAimLoop();
                if (cpuThrowTimeout) { clearTimeout(cpuThrowTimeout); cpuThrowTimeout = null; }
                handleTimerExpired(player);
            }
        }, 100);
    }

    function updateTimerDisplay(time) {
        const el = $('fuse-timer');
        if (el) el.textContent = time.toFixed(1);
    }

    function stopTimer() {
        if (timerInterval) clearInterval(timerInterval);
        timerInterval = null;
        if (fuseHiss) { fuseHiss.stop(); fuseHiss = null; }
    }

    /* ══════════════════════════════════
       THROW EXECUTION
       ══════════════════════════════════ */
    function executeThrow() {
        if (throwInProgress || gamePhase !== 'aiming') return;
        throwInProgress = true;

        const playerKey = state.turnOrder[state.currentTurnIndex];
        const player = state.players[playerKey];

        // Hide aim-related HUD
        $('aim-indicator').classList.remove('active');
        $('power-meter-container').classList.remove('active');
        hideControlsHint();

        // Check overcooked
        if (currentPower >= 0.9) {
            handleOvercooked(player);
            return;
        }

        // Check undercooked
        if (currentPower < 0.2) {
            // Not an explosion, but weak throw — might still fly
        }

        gamePhase = 'flight';

        // Calculate deviation based on timer pressure
        const timerEl = $('fuse-timer');
        const timeLeft = parseFloat(timerEl.textContent) || 8;
        let deviation = 0.05; // base ±5%
        if (timeLeft < 5) deviation = 0.08;
        if (timeLeft < 3) deviation = 0.12;
        if (timeLeft < 1.5) deviation = 0.18;

        // For golden apple, no deviation
        const isApple = gamePhase === 'goldenAppleAim';

        // Throw!
        GameScene.throwGrenade(currentPower, currentAimH, currentAimV, isApple ? 0 : deviation, false)
            .then(result => {
                handleLanding(result, player);
            });
    }

    function handleOvercooked(player) {
        gamePhase = 'result';
        stopTimer();
        stopAimLoop();

        // Explosion in hand
        GameScene.detonateInHand();
        screenFlash('red');
        screenShake('heavy');

        // Penalties
        const points = -3;
        state.scores[player.team] += points;
        player.totalScore += points;
        player.explosions++;

        // Teammate timer penalty
        const teammate = getTeammate(player.key);
        teammate.timerMod += -3;

        state.roundEvents.push(`💥 ${player.name} OVERCOOKED! -3 pts, ${teammate.name} gets -3s`);

        // Check butterfingers
        if (player.lastResult === 'explode') {
            state.roundEvents.push(`🧈 ${player.name}: BUTTERFINGERS!`);
        }
        player.lastResult = 'explode';

        updateScoreboard();

        // Show result
        showResultSplash('💥 BOOM!', `${points} POINTS`, 'explode').then(() => {
            advanceTurn();
        });
    }

    function handleTimerExpired(player) {
        const playerKey = state.turnOrder[state.currentTurnIndex];

        if (gamePhase === 'aiming') {
            // Still aiming — explodes in hand
            gamePhase = 'result';
            stopTimer();
            hideControlsHint();

            GameScene.detonateInHand();
            screenFlash('red');
            screenShake('heavy');

            const points = -4;
            state.scores[player.team] += points;
            player.totalScore += points;
            player.explosions++;

            const teammate = getTeammate(player.key);
            teammate.timerMod += -2;

            state.roundEvents.push(`⏰💥 ${player.name} TIMED OUT! -4 pts`);
            player.lastResult = 'explode';

            updateScoreboard();

            showResultSplash('⏰ TIME OUT!', `${points} POINTS`, 'explode').then(() => {
                advanceTurn();
            });
        } else if (gamePhase === 'flight') {
            // In flight — detonates mid-air
            gamePhase = 'result';
            stopTimer();

            GameScene.detonateMidAir();
            screenFlash('orange');

            // No points, whiff penalty to teammate
            const teammate = getTeammate(player.key);
            teammate.timerMod += -1;

            state.roundEvents.push(`⏰💥 ${player.name}'s grenade detonated mid-air!`);
            player.lastResult = 'whiff';

            showResultSplash('💥 MID-AIR!', '0 POINTS', 'explode').then(() => {
                advanceTurn();
            });
        }
    }

    function handleLanding(result, player) {
        gamePhase = 'result';
        stopTimer();
        stopAimLoop();

        const scoring = SCORING[result.result];
        const points = scoring.points;

        // Apply score
        state.scores[player.team] += points;
        player.totalScore += points;

        // Visual effects
        GameScene.showLandingEffect(result.result, result.position);

        if (result.result === 'ringer') {
            screenFlash('green');
            screenShake('light');
            player.ringers++;
            state.doubleRingerTracking[player.team]++;
        } else if (result.result === 'leaner') {
            screenFlash('orange');
        } else if (result.result === 'whiff' || result.result === 'void') {
            // Red vignette for void
            if (result.result === 'void') {
                const vig = $('vignette');
                vig.classList.add('active');
                setTimeout(() => vig.classList.remove('active'), 1000);
            }
        }

        // Timer effects
        // Good throws punish opponents
        if (scoring.opponentTimerPenalty < 0) {
            const nextOpponent = getNextOpponent(state.currentTurnIndex);
            if (nextOpponent) {
                nextOpponent.timerMod += scoring.opponentTimerPenalty;
                state.roundEvents.push(`${scoring.label} by ${player.name}! ${nextOpponent.name} gets ${scoring.opponentTimerPenalty}s`);
            }
        }

        // Bad throws (whiff) punish teammate
        if (result.result === 'whiff' || result.result === 'void') {
            const teammate = getTeammate(player.key);
            teammate.timerMod += -1;
            state.roundEvents.push(`${scoring.label} by ${player.name}. ${teammate.name} gets -1s`);
        } else if (scoring.opponentTimerPenalty === 0 && points > 0) {
            state.roundEvents.push(`${scoring.label} by ${player.name}! +${points} pts`);
        }

        player.lastResult = result.result;

        // Check double ringer
        if (state.doubleRingerTracking[player.team] >= 2) {
            state.scores[player.team] += 2;
            state.roundEvents.push(`🎯🎯 DOUBLE RINGER! +2 bonus for ${player.team.toUpperCase()}!`);
            state.doubleRingerTracking[player.team] = 0;
        }

        updateScoreboard();

        const pointsText = points > 0 ? `+${points} POINTS` : points < 0 ? `${points} POINTS` : '0 POINTS';

        // Broadcast result to connected players
        if (typeof Network !== 'undefined' && Network.isHost()) {
            Network.broadcastResult({
                label: scoring.label,
                points,
                description: `${scoring.label} by ${player.name}! ${pointsText}`,
            });
            Network.broadcastGameState({ scores: state.scores, round: state.round });
        }

        // Show result splash
        showResultSplash(scoring.label, pointsText, scoring.cssClass).then(() => {
            advanceTurn();
        });
    }

    /* ══════════════════════════════════
       TURN ADVANCEMENT
       ══════════════════════════════════ */
    function advanceTurn() {
        state.currentTurnIndex++;
        state.throwInRound++;

        // Clean up screen effects
        $('vignette').classList.remove('active', 'heartbeat');
        $('border-flash').classList.remove('active');

        if (state.suddenDeath) {
            if (state.currentTurnIndex >= state.turnOrder.length) {
                checkSuddenDeathResult();
                return;
            }
        }

        if (state.currentTurnIndex >= state.turnOrder.length) {
            endRound();
        } else {
            // Hard smash cut
            GameScene.snapCamera();
            setTimeout(() => startTurn(), 300);
        }
    }

    function endRound() {
        gamePhase = 'roundEnd';

        // Show round summary
        showRoundSummary().then(() => {
            state.round++;
            if (state.round > TOTAL_ROUNDS) {
                endGame();
            } else {
                startRound();
            }
        });
    }

    function endGame() {
        // Check tie
        if (state.scores.red === state.scores.blue) {
            startSuddenDeath();
            return;
        }

        gamePhase = 'gameOver';
        showGameOver();
    }

    function startSuddenDeath() {
        state.suddenDeath = true;
        state.currentTurnIndex = 0;
        state.turnOrder = ['redA', 'blueA', 'redB', 'blueB'];

        // Reset all timer mods
        Object.values(state.players).forEach(p => { p.timerMod = 0; });

        showSplash('⚡ SUDDEN DEATH ⚡', 'ONE THROW EACH', 'Highest single throw wins!', 3000).then(() => {
            // Track sudden death scores separately
            state.suddenDeathScores = { red: 0, blue: 0 };
            state.suddenDeathBest = { red: 0, blue: 0 };
            startTurn();
        });
    }

    function checkSuddenDeathResult() {
        // Highest individual score
        const redBest = Math.max(
            state.players.redA.lastResult === 'ringer' ? 5 : state.players.redA.lastResult === 'leaner' ? 4 : state.players.redA.lastResult === 'close' ? 3 : state.players.redA.lastResult === 'near' ? 2 : state.players.redA.lastResult === 'far' ? 1 : 0,
            state.players.redB.lastResult === 'ringer' ? 5 : state.players.redB.lastResult === 'leaner' ? 4 : state.players.redB.lastResult === 'close' ? 3 : state.players.redB.lastResult === 'near' ? 2 : state.players.redB.lastResult === 'far' ? 1 : 0
        );
        const blueBest = Math.max(
            state.players.blueA.lastResult === 'ringer' ? 5 : state.players.blueA.lastResult === 'leaner' ? 4 : state.players.blueA.lastResult === 'close' ? 3 : state.players.blueA.lastResult === 'near' ? 2 : state.players.blueA.lastResult === 'far' ? 1 : 0,
            state.players.blueB.lastResult === 'ringer' ? 5 : state.players.blueB.lastResult === 'leaner' ? 4 : state.players.blueB.lastResult === 'close' ? 3 : state.players.blueB.lastResult === 'near' ? 2 : state.players.blueB.lastResult === 'far' ? 1 : 0
        );

        if (redBest === blueBest) {
            // Still tied — repeat sudden death
            showSplash('⚡ STILL TIED! ⚡', 'GOING AGAIN', '', 2000).then(() => {
                state.currentTurnIndex = 0;
                Object.values(state.players).forEach(p => { p.timerMod = 0; p.lastResult = null; });
                startTurn();
            });
        } else {
            if (redBest > blueBest) state.scores.red++;
            else state.scores.blue++;
            updateScoreboard();
            state.suddenDeath = false;
            showGameOver();
        }
    }

    /* ══════════════════════════════════
       GOLDEN APPLE 🍎
       ══════════════════════════════════ */
    function startGoldenApple() {
        state.goldenAppleUsed = true;
        gamePhase = 'goldenApple';

        // Pick random player
        const keys = ['redA', 'redB', 'blueA', 'blueB'];
        const chosenKey = keys[Math.floor(Math.random() * keys.length)];
        const chosen = state.players[chosenKey];

        AudioEngine.goldenApple();

        showAppleSplash(chosen).then(() => {
            return showSplash(`${chosen.name.toUpperCase()}`, 'HAS BEEN CHOSEN', 'No timer. No deviation. Pure skill.', 3000);
        }).then(() => {
            startGoldenAppleThrow(chosen, chosenKey);
        });
    }

    function startGoldenAppleThrow(player, playerKey) {
        gamePhase = 'aiming'; // reuse aiming phase
        throwInProgress = false;
        currentPower = 0;
        currentAimH = 0;
        currentAimV = 0.6;
        powerCharging = false;

        // Set up scene
        GameScene.resetForNextThrow();
        GameScene.snapCamera();
        GameScene.setPlayerHand(playerKey);
        GameScene.setHandVisible(true);
        GameScene.createGoldenAppleVisual();

        // Update badge
        updatePlayerBadge(player);
        showControlsHint();

        // Show HUD — no timer for golden apple
        $('aim-indicator').classList.add('active');
        $('fuse-timer').textContent = '∞';
        $('fuse-timer').className = '';
        $('fuse-label').textContent = 'NO FUSE';

        // Start aim loop
        startAimLoop();

        // Override throw to be apple throw
        const origExecute = executeThrow;
        executeThrow = () => {
            if (throwInProgress || gamePhase !== 'aiming') return;
            throwInProgress = true;

            $('aim-indicator').classList.remove('active');
            $('power-meter-container').classList.remove('active');
            $('controls-hint').style.display = 'none';

            if (currentPower >= 0.9) {
                // Even overcooked — apple doesn't explode, just fumble
                currentPower = 0.88;
            }

            gamePhase = 'flight';

            GameScene.throwGrenade(currentPower, currentAimH, currentAimV, 0, true)
                .then(result => {
                    handleAppleLanding(result, player);
                });

            // Restore original
            executeThrow = origExecute;
        };
    }

    function handleAppleLanding(result, player) {
        gamePhase = 'result';
        stopAimLoop();

        const dist = result.distance;
        let appleResult, flavor, effectText;

        if (dist <= 0.3) {
            appleResult = 'bullseye';
            flavor = 'None shall be spared';
            effectText = 'DISCORD: All timers set to 3.0s!';
            // All other players get 3.0s timers
            Object.values(state.players).forEach(p => {
                if (p.key !== player.key) {
                    p.timerMod = 3.0 - BASE_TIMER; // Set to 3.0
                }
            });
        } else if (dist <= 1.5) {
            appleResult = 'blessing';
            flavor = 'The gods smile upon your house';
            effectText = 'BLESSING: Teammate +3s, Opponents -2s';
            const teammate = getTeammate(player.key);
            teammate.timerMod += 3;
            getOpponents(player.key).forEach(opp => { opp.timerMod += -2; });
        } else if (dist <= 3.0) {
            appleResult = 'neutral';
            flavor = 'The scales are balanced';
            effectText = 'STALEMATE: All timers reset to 8.0s';
            Object.values(state.players).forEach(p => { p.timerMod = 0; });
        } else {
            appleResult = 'fumble';
            flavor = 'You reached too far, mortal';
            effectText = 'HUBRIS: Your team -3.0s each!';
            const teammate = getTeammate(player.key);
            player.timerMod += -3;
            teammate.timerMod += -3;
        }

        // Landing effect
        if (result.result !== 'void') {
            GameScene.showLandingEffect(dist <= 1.5 ? 'ringer' : 'near', result.position);
        }

        state.roundEvents.push(`🍎 ${player.name}: ${appleResult.toUpperCase()} — "${flavor}"`);

        // Show apple result
        showAppleResultSplash(appleResult, flavor, effectText).then(() => {
            // Resume normal game — apple replaces a round
            state.round++;
            if (state.round > TOTAL_ROUNDS) {
                endGame();
            } else {
                startRound();
            }
        });
    }

    /* ══════════════════════════════════
       HELPERS
       ══════════════════════════════════ */
    function getTeammate(playerKey) {
        const teammates = {
            redA: 'redB', redB: 'redA',
            blueA: 'blueB', blueB: 'blueA',
        };
        return state.players[teammates[playerKey]];
    }

    function getNextOpponent(currentIndex) {
        // Find next player in turn order from opposing team
        const current = state.players[state.turnOrder[currentIndex]];
        for (let i = currentIndex + 1; i < state.turnOrder.length; i++) {
            const p = state.players[state.turnOrder[i]];
            if (p.team !== current.team) return p;
        }
        return null;
    }

    function getOpponents(playerKey) {
        const team = state.players[playerKey].team;
        return Object.values(state.players).filter(p => p.team !== team);
    }

    /* ══════════════════════════════════
       UI UPDATES
       ══════════════════════════════════ */
    function updateScoreboard() {
        const redVal = $('red-score');
        const blueVal = $('blue-score');
        if (redVal) {
            redVal.textContent = state.scores.red;
            redVal.classList.add('pop');
            setTimeout(() => redVal.classList.remove('pop'), 300);
        }
        if (blueVal) {
            blueVal.textContent = state.scores.blue;
            blueVal.classList.add('pop');
            setTimeout(() => blueVal.classList.remove('pop'), 300);
        }
    }

    function updatePowerMeter(power) {
        const fill = $('power-fill');
        const pct = $('power-pct');
        if (!fill) return;

        fill.style.height = `${power * 100}%`;
        if (pct) pct.textContent = `${Math.round(power * 100)}%`;

        // Zone colors
        fill.className = '';
        if (power < 0.2) fill.classList.add('weak');
        else if (power < 0.4) fill.classList.add('short');
        else if (power < 0.7) fill.classList.add('sweet');
        else if (power < 0.9) fill.classList.add('hot');
        else fill.classList.add('overcooked');
    }

    function updatePlayerBadge(player) {
        const dot = $('player-color-dot');
        const name = $('player-name-display');
        if (dot) {
            const colors = {
                redA: '#CC2222', redB: '#CC6622',
                blueA: '#22AAAA', blueB: '#6633CC'
            };
            dot.style.backgroundColor = colors[player.key];
            dot.style.color = colors[player.key];
        }
        if (name) name.textContent = player.name;
    }

    function showControlsHint() {
        const hint = $('controls-hint');
        if (hint) {
            hint.style.display = 'block';
            hint.innerHTML = `<kbd>A</kbd><kbd>D</kbd> aim &nbsp; <kbd>W</kbd><kbd>S</kbd> arc &nbsp; Hold <kbd>SPACE</kbd> power → release to throw`;
        }
    }

    /* ══════════════════════════════════
       SPLASHES
       ══════════════════════════════════ */
    function showSplash(title, subtitle, extra, duration = 2000) {
        return new Promise(resolve => {
            const overlay = $('splash-overlay');
            overlay.innerHTML = `
        <div class="splash-text splash-title">${title}</div>
        ${subtitle ? `<div class="splash-text splash-subtitle">${subtitle}</div>` : ''}
        ${extra ? `<div class="splash-text splash-penalty">${extra}</div>` : ''}
      `;
            overlay.classList.add('active');
            AudioEngine.dramaticReveal();

            setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(resolve, 300);
            }, duration);
        });
    }

    function showPlayerTurnSplash(player, timer, penaltySource) {
        return new Promise(resolve => {
            const overlay = $('splash-overlay');
            const teamColor = player.team === 'red' ? 'var(--red-team)' : 'var(--blue-team)';
            const timerColor = timer < BASE_TIMER ? 'var(--explode-red)' : 'var(--hud-bright)';

            overlay.innerHTML = `
        <div class="splash-text splash-title" style="color: ${teamColor}">${player.name.toUpperCase()}'S TURN</div>
        <div class="splash-text splash-subtitle" style="color: ${timerColor}">FUSE SET: ${timer.toFixed(1)}s</div>
        ${penaltySource ? `<div class="splash-text splash-penalty">${penaltySource}</div>` : ''}
      `;
            overlay.classList.add('active');
            AudioEngine.uiClick();

            setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(resolve, 200);
            }, 2000);
        });
    }

    function showCountdown() {
        return new Promise(resolve => {
            const overlay = $('splash-overlay');
            let count = 3;

            function tick() {
                if (count > 0) {
                    overlay.innerHTML = `<div class="splash-countdown">${count}</div>`;
                    overlay.classList.add('active');
                    AudioEngine.countBeep(false);
                    count--;
                    setTimeout(tick, 600);
                } else {
                    overlay.innerHTML = `<div class="splash-countdown" style="color: var(--ringer-green)">THROW!</div>`;
                    AudioEngine.countBeep(true);
                    setTimeout(() => {
                        overlay.classList.remove('active');
                        setTimeout(resolve, 200);
                    }, 500);
                }
            }
            tick();
        });
    }

    function showResultSplash(label, pointsText, cssClass) {
        return new Promise(resolve => {
            const overlay = $('splash-overlay');
            overlay.innerHTML = `
        <div class="result-splash ${cssClass}">${label}</div>
        <div class="result-points" style="color: ${cssClass === 'explode' ? 'var(--explode-red)' : 'var(--hud-bright)'}">${pointsText}</div>
      `;
            overlay.classList.add('active');

            setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(resolve, 300);
            }, 2000);
        });
    }

    function showAppleSplash(player) {
        return new Promise(resolve => {
            const overlay = $('splash-overlay');
            overlay.innerHTML = `
        <div class="apple-splash">
          <div class="apple-title">🍎 THE APPLE OF DISCORD</div>
          <div class="apple-flavor">"For the Worthiest"</div>
        </div>
      `;
            overlay.classList.add('active');

            setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(resolve, 300);
            }, 3000);
        });
    }

    function showAppleResultSplash(result, flavor, effectText) {
        return new Promise(resolve => {
            const overlay = $('splash-overlay');
            const color = result === 'bullseye' ? 'var(--explode-red)' :
                result === 'blessing' ? 'var(--gold-apple)' :
                    result === 'neutral' ? 'var(--hud-bright)' : 'var(--whiff-gray)';

            overlay.innerHTML = `
        <div class="apple-splash">
          <div class="apple-title" style="color: ${color}">🍎 ${result.toUpperCase()}</div>
          <div class="apple-flavor">"${flavor}"</div>
          <div class="splash-text splash-subtitle" style="margin-top: 1rem">${effectText}</div>
        </div>
      `;
            overlay.classList.add('active');

            setTimeout(() => {
                overlay.classList.remove('active');
                setTimeout(resolve, 300);
            }, 4000);
        });
    }

    function showRoundSummary() {
        return new Promise(resolve => {
            const summary = $('round-summary');
            const card = summary.querySelector('.summary-card');

            card.querySelector('h2').textContent = `ROUND ${state.round} COMPLETE`;
            card.querySelector('.summary-team.red .value').textContent = state.scores.red;
            card.querySelector('.summary-team.blue .value').textContent = state.scores.blue;

            const eventsEl = card.querySelector('.summary-events');
            eventsEl.innerHTML = state.roundEvents.length > 0
                ? state.roundEvents.map(e => `<div>${e}</div>`).join('')
                : '<div>A quiet round...</div>';

            summary.classList.add('active');

            setTimeout(() => {
                summary.classList.remove('active');
                setTimeout(resolve, 300);
            }, 4000);
        });
    }

    function showGameOver() {
        const screen = $('game-over-screen');
        const winner = state.scores.red > state.scores.blue ? 'red' : 'blue';
        const winnerName = winner === 'red' ? 'RED TEAM' : 'BLUE TEAM';

        // MVP
        let mvp = null;
        let mvpScore = -Infinity;
        Object.values(state.players).forEach(p => {
            if (p.totalScore > mvpScore) { mvpScore = p.totalScore; mvp = p; }
        });

        screen.querySelector('.winner-text').textContent = `${winnerName} WINS!`;
        screen.querySelector('.winner-text').className = `winner-text ${winner}`;

        const summaryCard = screen.querySelector('.summary-card');
        summaryCard.querySelector('.summary-team.red .value').textContent = state.scores.red;
        summaryCard.querySelector('.summary-team.blue .value').textContent = state.scores.blue;

        screen.querySelector('.mvp-callout').textContent = `🏆 MVP: ${mvp.name} (${mvpScore} pts, ${mvp.ringers} ringers)`;

        screen.classList.add('active');

        $('play-again-btn').onclick = () => {
            screen.classList.remove('active');
            $('hud').classList.remove('active');
            gamePhase = 'setup';
            // Reload to go back to lobby
            window.location.reload();
        };
    }

    /* ══════════════════════════════════
       SCREEN EFFECTS
       ══════════════════════════════════ */
    function screenFlash(color) {
        const flash = $('screen-flash');
        flash.className = color;
        flash.style.opacity = '1';
        setTimeout(() => { flash.style.opacity = '0'; }, 150);
    }

    function screenShake(intensity) {
        document.body.classList.add(`shake-${intensity}`);
        setTimeout(() => {
            document.body.classList.remove(`shake-${intensity}`);
        }, intensity === 'heavy' ? 500 : 300);
    }

    /* ══════════════════════════════════
       REMOTE INPUT (Phone Controllers)
       ══════════════════════════════════ */
    function isActiveSeat(seat) {
        if (!state || gamePhase !== 'aiming') return false;
        const activeKey = state.turnOrder[state.currentTurnIndex];
        return seat === activeKey;
    }

    function setRemoteAim(x, y) {
        if (gamePhase !== 'aiming') return;
        currentAimH = x;
        currentAimV = y;
        GameScene.setAim(currentAimH, currentAimV);
        const dot = $('aim-dot');
        if (dot) {
            dot.style.left = `${50 + currentAimH * 35}%`;
            dot.style.top = `${50 - (currentAimV - 0.5) * 60}%`;
        }
    }

    function startRemoteCharge() {
        if (gamePhase !== 'aiming' || powerCharging) return;
        powerCharging = true;
        currentPower = 0;
        if (chargeHum) chargeHum.stop();
        chargeHum = AudioEngine.startChargeHum();
        $('power-meter-container').classList.add('active');
    }

    function updateRemoteCharge(power) {
        if (!powerCharging || gamePhase !== 'aiming') return;
        currentPower = Math.max(0, Math.min(1, power));
        updatePowerMeter(currentPower);
        GameScene.setCharge(currentPower);
        if (chargeHum) chargeHum.setPower(currentPower);
    }

    function executeRemoteThrow(power, aimX, aimY) {
        if (gamePhase !== 'aiming') return;
        // Apply the final values from the phone controller
        currentPower = Math.max(0, Math.min(1, power));
        currentAimH = aimX;
        currentAimV = aimY;
        powerCharging = false;
        if (chargeHum) { chargeHum.stop(); chargeHum = null; }
        executeThrow();
    }

    return {
        initGame,
        isActiveSeat,
        setRemoteAim,
        startRemoteCharge,
        updateRemoteCharge,
        executeRemoteThrow,
    };
})();
