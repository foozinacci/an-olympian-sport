/* ═══════════════════════════════════════════
   DEGEN HORSESHOES 💣 — THREE.JS SCENE
   Hyperspace Arena, Stake, Grenade, Alien Hands
   ═══════════════════════════════════════════ */

const GameScene = (() => {
    let scene, camera, renderer, clock;
    let throwPlatform, stakePlatform, stakeMesh, stakeBeacon;
    let grenadeGroup, grenadeMesh, grenadeTrailParticles;
    let alienHand;
    let scoringRings = [];
    let distantPlatforms = [];
    let hyperspaceParticles, nebulaeMeshes = [];
    let tetheredParticles;

    // Camera modes
    const CAM_FIRST_PERSON = 0;
    const CAM_FOLLOW_GRENADE = 1;
    const CAM_IMPACT = 2;
    let cameraMode = CAM_FIRST_PERSON;

    // Constants
    const THROW_POS = new THREE.Vector3(0, 5, 0);
    const STAKE_POS = new THREE.Vector3(0, 5, -45);
    const STAKE_DISTANCE = 45;
    const PLATFORM_RADIUS = 6;
    const STAKE_PLATFORM_RADIUS = 5;

    // State
    let grenadeInFlight = false;
    let grenadeVelocity = new THREE.Vector3();
    let grenadeStartTime = 0;
    let currentHandColor = '#CC2222';
    let currentHandAccent = '#ff6600';
    let handShakeIntensity = 0;
    let veinPulseSpeed = 1;
    let handAnimState = 'idle';
    let chargeAmount = 0;
    let aimX = 0, aimY = 0.6; // normalized aim
    let grenadeFlightCallback = null;
    let isGoldenApple = false;

    // Trail system
    let trailPoints = [];
    let trailLine = null;
    const MAX_TRAIL_POINTS = 200;

    // Hand parts
    let handGroup, palmMesh, fingers = [], thumb, forearm;
    let handMaterials = [];

    // Grenade fuse glow
    let fuseLight;

    const PLAYER_HAND_COLORS = {
        'redA': { skin: 0xCC2222, accent: 0xff6600, claw: 0xff8844 },
        'redB': { skin: 0xCC6622, accent: 0xffaa00, claw: 0xddcc44 },
        'blueA': { skin: 0x22AAAA, accent: 0x00ffff, claw: 0x88ccff },
        'blueB': { skin: 0x6633CC, accent: 0xaa66ff, claw: 0xccccff },
    };

    /* ══════════════════════════════════
       INIT
       ══════════════════════════════════ */
    function init() {
        clock = new THREE.Clock();

        // Scene
        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x0a0614, 0.004);

        // Camera
        camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 500);
        camera.position.copy(THROW_POS);
        camera.position.y += 1.6;
        camera.lookAt(STAKE_POS);

        // Renderer
        const canvas = document.getElementById('game-canvas');
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;

        // Lighting
        setupLighting();

        // Environment
        createHyperspaceBackground();
        createThrowPlatform();
        createStakePlatform();
        createStake();
        createScoringRings();
        createEnergyTether();
        createDistantPlatforms();

        // Grenade
        createGrenade();

        // Alien hand
        createAlienHand('redA');

        // Trail
        createTrailSystem();

        // Resize
        window.addEventListener('resize', onResize);

        // Start render loop
        animate();
    }

    /* ── Lighting ── */
    function setupLighting() {
        // Ambient — void glow (purple tinted)
        const ambient = new THREE.AmbientLight(0x221144, 0.4);
        scene.add(ambient);

        // Hemisphere — void above, dark below
        const hemi = new THREE.HemisphereLight(0x332266, 0x0a0614, 0.3);
        scene.add(hemi);

        // Stake beacon spotlight
        const stakeLight = new THREE.PointLight(0xff6633, 2, 30);
        stakeLight.position.set(STAKE_POS.x, STAKE_POS.y + 8, STAKE_POS.z);
        scene.add(stakeLight);

        // Platform glow lights
        const throwGlow = new THREE.PointLight(0x6633cc, 1, 15);
        throwGlow.position.set(THROW_POS.x, THROW_POS.y + 1, THROW_POS.z);
        scene.add(throwGlow);
    }

    /* ══════════════════════════════════
       HYPERSPACE BACKGROUND
       ══════════════════════════════════ */
    function createHyperspaceBackground() {
        // Distant starfield
        const starCount = 4000;
        const starGeo = new THREE.BufferGeometry();
        const starPos = new Float32Array(starCount * 3);
        const starColors = new Float32Array(starCount * 3);
        const starSizes = new Float32Array(starCount);

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const r = 150 + Math.random() * 200;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(Math.random() * 2 - 1);
            starPos[i3] = r * Math.sin(phi) * Math.cos(theta);
            starPos[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
            starPos[i3 + 2] = r * Math.cos(phi);

            // Color variety
            const colorChoice = Math.random();
            if (colorChoice < 0.6) { starColors[i3] = 1; starColors[i3 + 1] = 1; starColors[i3 + 2] = 1; }
            else if (colorChoice < 0.75) { starColors[i3] = 0.6; starColors[i3 + 1] = 0.7; starColors[i3 + 2] = 1; }
            else if (colorChoice < 0.9) { starColors[i3] = 1; starColors[i3 + 1] = 0.8; starColors[i3 + 2] = 0.5; }
            else { starColors[i3] = 1; starColors[i3 + 1] = 0.5; starColors[i3 + 2] = 0.8; }

            starSizes[i] = 0.5 + Math.random() * 2;
        }

        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
        starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));

        const starMat = new THREE.PointsMaterial({
            size: 1.2,
            vertexColors: true,
            transparent: true,
            opacity: 0.8,
            sizeAttenuation: true,
        });

        hyperspaceParticles = new THREE.Points(starGeo, starMat);
        scene.add(hyperspaceParticles);

        // Nebulae
        const nebulaColors = [0x6633cc, 0xcc33aa, 0x3355cc, 0x993366, 0x224488];
        for (let i = 0; i < 5; i++) {
            const geo = new THREE.SphereGeometry(20 + Math.random() * 25, 16, 16);
            const mat = new THREE.MeshBasicMaterial({
                color: nebulaColors[i],
                transparent: true,
                opacity: 0.06,
                side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            const r = 80 + Math.random() * 100;
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.random() * Math.PI;
            mesh.position.set(
                r * Math.sin(phi) * Math.cos(theta),
                r * Math.sin(phi) * Math.sin(theta) - 20,
                r * Math.cos(phi)
            );
            mesh.userData.pulseOffset = Math.random() * Math.PI * 2;
            mesh.userData.pulseSpeed = 0.3 + Math.random() * 0.5;
            scene.add(mesh);
            nebulaeMeshes.push(mesh);
        }

        // Hyperspace streaks (elongated particles)
        const streakCount = 300;
        const streakGeo = new THREE.BufferGeometry();
        const streakPos = new Float32Array(streakCount * 3);
        const streakVel = [];
        for (let i = 0; i < streakCount; i++) {
            const i3 = i * 3;
            streakPos[i3] = (Math.random() - 0.5) * 200;
            streakPos[i3 + 1] = (Math.random() - 0.5) * 100;
            streakPos[i3 + 2] = (Math.random() - 0.5) * 200;
            streakVel.push(0.1 + Math.random() * 0.3);
        }
        streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
        const streakMat = new THREE.PointsMaterial({
            size: 0.3,
            color: 0x8866cc,
            transparent: true,
            opacity: 0.3,
        });
        const streaks = new THREE.Points(streakGeo, streakMat);
        streaks.userData.velocities = streakVel;
        scene.add(streaks);
        hyperspaceParticles.userData.streaks = streaks;
    }

    /* ══════════════════════════════════
       PLATFORMS
       ══════════════════════════════════ */
    function createThrowPlatform() {
        // Main slab
        const geo = new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS + 0.5, 1.5, 32);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.4,
            metalness: 0.8,
            emissive: 0x110022,
            emissiveIntensity: 0.3,
        });
        throwPlatform = new THREE.Mesh(geo, mat);
        throwPlatform.position.set(THROW_POS.x, THROW_POS.y - 0.75, THROW_POS.z);
        scene.add(throwPlatform);

        // Grid lines on surface
        const ringGeo = new THREE.RingGeometry(0.5, PLATFORM_RADIUS - 0.1, 32);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x6633cc,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(THROW_POS.x, THROW_POS.y + 0.01, THROW_POS.z);
        scene.add(ring);

        // Edge mist particles
        createEdgeMist(THROW_POS, PLATFORM_RADIUS);
    }

    function createStakePlatform() {
        const geo = new THREE.CylinderGeometry(STAKE_PLATFORM_RADIUS, STAKE_PLATFORM_RADIUS + 0.3, 1, 32);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x1a1a2e,
            roughness: 0.35,
            metalness: 0.85,
            emissive: 0x221100,
            emissiveIntensity: 0.3,
        });
        stakePlatform = new THREE.Mesh(geo, mat);
        stakePlatform.position.set(STAKE_POS.x, STAKE_POS.y - 0.5, STAKE_POS.z);
        scene.add(stakePlatform);

        // Base ring glow
        const baseGlow = new THREE.RingGeometry(STAKE_PLATFORM_RADIUS - 0.2, STAKE_PLATFORM_RADIUS + 0.3, 64);
        const baseMat = new THREE.MeshBasicMaterial({
            color: 0xff6633,
            transparent: true,
            opacity: 0.3,
            side: THREE.DoubleSide,
        });
        const baseRing = new THREE.Mesh(baseGlow, baseMat);
        baseRing.rotation.x = -Math.PI / 2;
        baseRing.position.set(STAKE_POS.x, STAKE_POS.y + 0.02, STAKE_POS.z);
        baseRing.userData.pulseBase = 0.3;
        scene.add(baseRing);
        stakeBeacon = baseRing;

        createEdgeMist(STAKE_POS, STAKE_PLATFORM_RADIUS);
    }

    function createEdgeMist(center, radius) {
        const count = 100;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = radius + Math.random() * 0.5;
            pos[i * 3] = center.x + Math.cos(angle) * r;
            pos[i * 3 + 1] = center.y - 0.5 - Math.random() * 2;
            pos[i * 3 + 2] = center.z + Math.sin(angle) * r;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            size: 0.4,
            color: 0x6633cc,
            transparent: true,
            opacity: 0.15,
        });
        const mist = new THREE.Points(geo, mat);
        mist.userData.center = center.clone();
        mist.userData.radius = radius;
        scene.add(mist);
    }

    /* ══════════════════════════════════
       STAKE
       ══════════════════════════════════ */
    function createStake() {
        const stakeGroup = new THREE.Group();
        stakeGroup.position.copy(STAKE_POS);

        // Post
        const postGeo = new THREE.CylinderGeometry(0.12, 0.15, 3, 12);
        const postMat = new THREE.MeshStandardMaterial({
            color: 0x333333,
            metalness: 0.9,
            roughness: 0.3,
        });
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.y = 1.5;
        stakeGroup.add(post);

        // Hazard stripes (orange bands)
        for (let i = 0; i < 5; i++) {
            const stripeGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.15, 12);
            const stripeMat = new THREE.MeshStandardMaterial({
                color: i % 2 === 0 ? 0xff6600 : 0x111111,
                emissive: i % 2 === 0 ? 0xff3300 : 0x000000,
                emissiveIntensity: 0.3,
                metalness: 0.8,
                roughness: 0.3,
            });
            const stripe = new THREE.Mesh(stripeGeo, stripeMat);
            stripe.position.y = 0.5 + i * 0.5;
            stakeGroup.add(stripe);
        }

        // Detonator cap (glowing red)
        const capGeo = new THREE.SphereGeometry(0.2, 16, 16);
        const capMat = new THREE.MeshStandardMaterial({
            color: 0xff2222,
            emissive: 0xff0000,
            emissiveIntensity: 0.8,
            metalness: 0.5,
            roughness: 0.2,
        });
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.y = 3.1;
        cap.userData.isPulsing = true;
        stakeGroup.add(cap);

        // Beacon light beam (vertical)
        const beamGeo = new THREE.CylinderGeometry(0.05, 0.15, 20, 8);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0xff4422,
            transparent: true,
            opacity: 0.1,
        });
        const beam = new THREE.Mesh(beamGeo, beamMat);
        beam.position.y = 13;
        stakeGroup.add(beam);

        stakeMesh = stakeGroup;
        scene.add(stakeGroup);
    }

    /* ── Scoring Rings ── */
    function createScoringRings() {
        const rings = [
            { inner: 0, outer: 0.3, color: 0x00ff66, opacity: 0.35, label: 'ringer' },
            { inner: 0.3, outer: 0.7, color: 0xff8833, opacity: 0.25, label: 'leaner' },
            { inner: 0.7, outer: 1.5, color: 0xffdd33, opacity: 0.18, label: 'close' },
            { inner: 1.5, outer: 2.5, color: 0xcccccc, opacity: 0.1, label: 'near' },
            { inner: 2.5, outer: 4.0, color: 0x666666, opacity: 0.06, label: 'far' },
        ];

        rings.forEach(r => {
            const geo = new THREE.RingGeometry(r.inner, r.outer, 64);
            const mat = new THREE.MeshBasicMaterial({
                color: r.color,
                transparent: true,
                opacity: r.opacity,
                side: THREE.DoubleSide,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(STAKE_POS.x, STAKE_POS.y + 0.03, STAKE_POS.z);
            mesh.userData.label = r.label;
            mesh.userData.baseOpacity = r.opacity;
            scene.add(mesh);
            scoringRings.push(mesh);
        });
    }

    /* ── Energy Tether ── */
    function createEnergyTether() {
        const count = 150;
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            const t = i / count;
            pos[i * 3] = THREE.MathUtils.lerp(THROW_POS.x, STAKE_POS.x, t) + (Math.random() - 0.5) * 0.3;
            pos[i * 3 + 1] = THREE.MathUtils.lerp(THROW_POS.y, STAKE_POS.y, t) - 1 + Math.sin(t * Math.PI) * 2 + (Math.random() - 0.5) * 0.3;
            pos[i * 3 + 2] = THREE.MathUtils.lerp(THROW_POS.z, STAKE_POS.z, t) + (Math.random() - 0.5) * 0.3;
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            size: 0.15,
            color: 0x6633cc,
            transparent: true,
            opacity: 0.08,
        });
        tetheredParticles = new THREE.Points(geo, mat);
        scene.add(tetheredParticles);
    }

    /* ── Distant Platforms ── */
    function createDistantPlatforms() {
        for (let i = 0; i < 5; i++) {
            const group = new THREE.Group();
            const dist = 100 + Math.random() * 100;
            const angle = Math.random() * Math.PI * 2;
            const yOff = (Math.random() - 0.5) * 40;
            group.position.set(
                Math.cos(angle) * dist,
                yOff,
                Math.sin(angle) * dist
            );

            // Tiny platform
            const platGeo = new THREE.CylinderGeometry(1, 1.2, 0.3, 8);
            const platMat = new THREE.MeshBasicMaterial({ color: 0x1a1a2e });
            const plat = new THREE.Mesh(platGeo, platMat);
            group.add(plat);

            // Beacon
            const beaconGeo = new THREE.SphereGeometry(0.3, 8, 8);
            const beaconMat = new THREE.MeshBasicMaterial({
                color: [0xff4422, 0x4488ff, 0x00ff66, 0xff8833, 0xcc33aa][i],
                transparent: true,
                opacity: 0.6,
            });
            const beacon = new THREE.Mesh(beaconGeo, beaconMat);
            beacon.position.y = 2;
            beacon.userData.pulseOffset = Math.random() * Math.PI * 2;
            group.add(beacon);

            scene.add(group);
            distantPlatforms.push(group);
        }
    }

    /* ══════════════════════════════════
       HORSESHOE GRENADE
       ══════════════════════════════════ */
    function createGrenade() {
        grenadeGroup = new THREE.Group();
        grenadeGroup.visible = false;

        // Horseshoe U-shape (torus segment)
        const torusGeo = new THREE.TorusGeometry(0.18, 0.06, 8, 16, Math.PI);
        const torusMat = new THREE.MeshStandardMaterial({
            color: 0x445533,
            roughness: 0.6,
            metalness: 0.4,
        });
        grenadeMesh = new THREE.Mesh(torusGeo, torusMat);
        grenadeMesh.rotation.x = Math.PI / 2;
        grenadeGroup.add(grenadeMesh);

        // Grenade body (sphere at top of U)
        const bodyGeo = new THREE.SphereGeometry(0.1, 12, 12);
        const bodyMat = new THREE.MeshStandardMaterial({
            color: 0x445533,
            roughness: 0.5,
            metalness: 0.5,
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.18;
        grenadeGroup.add(body);

        // Pull ring (gold/emissive)
        const ringGeo = new THREE.TorusGeometry(0.04, 0.015, 6, 8);
        const ringMat = new THREE.MeshStandardMaterial({
            color: 0xddaa00,
            emissive: 0xaa8800,
            emissiveIntensity: 0.5,
            metalness: 0.8,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(0, 0.28, 0);
        grenadeGroup.add(ring);

        // Fuse glow point light
        fuseLight = new THREE.PointLight(0xff4400, 1, 5);
        fuseLight.position.set(0, 0.3, 0);
        grenadeGroup.add(fuseLight);

        // Fuse glow sphere
        const fuseGeo = new THREE.SphereGeometry(0.025, 8, 8);
        const fuseMat = new THREE.MeshBasicMaterial({
            color: 0xff6600,
            transparent: true,
            opacity: 0.9,
        });
        const fuseMesh = new THREE.Mesh(fuseGeo, fuseMat);
        fuseMesh.position.set(0, 0.3, 0);
        grenadeGroup.add(fuseMesh);

        scene.add(grenadeGroup);
    }

    function createGoldenAppleVisual() {
        // Replace grenade visual with golden apple
        grenadeGroup.children.forEach(c => { if (c !== fuseLight) c.visible = false; });

        const appleGeo = new THREE.SphereGeometry(0.2, 24, 24);
        const appleMat = new THREE.MeshStandardMaterial({
            color: 0xffd700,
            emissive: 0xaa8800,
            emissiveIntensity: 0.6,
            metalness: 0.9,
            roughness: 0.15,
        });
        const apple = new THREE.Mesh(appleGeo, appleMat);
        apple.name = 'goldenApple';
        grenadeGroup.add(apple);

        fuseLight.color.set(0xffd700);
        fuseLight.intensity = 2;

        return apple;
    }

    function restoreGrenadeVisual() {
        const apple = grenadeGroup.getObjectByName('goldenApple');
        if (apple) grenadeGroup.remove(apple);
        grenadeGroup.children.forEach(c => c.visible = true);
        fuseLight.color.set(0xff4400);
        fuseLight.intensity = 1;
    }

    /* ══════════════════════════════════
       TRAIL SYSTEM
       ══════════════════════════════════ */
    function createTrailSystem() {
        const geo = new THREE.BufferGeometry();
        const positions = new Float32Array(MAX_TRAIL_POINTS * 3);
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geo.setDrawRange(0, 0);
        const mat = new THREE.LineBasicMaterial({
            color: isGoldenApple ? 0xffd700 : 0xff6633,
            transparent: true,
            opacity: 0.6,
        });
        trailLine = new THREE.Line(geo, mat);
        scene.add(trailLine);
    }

    function resetTrail() {
        trailPoints = [];
        if (trailLine) trailLine.geometry.setDrawRange(0, 0);
    }

    function addTrailPoint(pos) {
        trailPoints.push(pos.clone());
        if (trailPoints.length > MAX_TRAIL_POINTS) trailPoints.shift();

        const positions = trailLine.geometry.attributes.position.array;
        for (let i = 0; i < trailPoints.length; i++) {
            positions[i * 3] = trailPoints[i].x;
            positions[i * 3 + 1] = trailPoints[i].y;
            positions[i * 3 + 2] = trailPoints[i].z;
        }
        trailLine.geometry.attributes.position.needsUpdate = true;
        trailLine.geometry.setDrawRange(0, trailPoints.length);
    }

    /* ══════════════════════════════════
       ALIEN HAND
       ══════════════════════════════════ */
    function createAlienHand(playerKey) {
        if (handGroup) scene.remove(handGroup);

        const colors = PLAYER_HAND_COLORS[playerKey] || PLAYER_HAND_COLORS.redA;
        handGroup = new THREE.Group();
        handMaterials = [];

        const skinMat = new THREE.MeshStandardMaterial({
            color: colors.skin,
            roughness: 0.7,
            metalness: 0.2,
            emissive: colors.accent,
            emissiveIntensity: 0.05,
        });
        handMaterials.push(skinMat);

        const clawMat = new THREE.MeshStandardMaterial({
            color: colors.claw,
            roughness: 0.3,
            metalness: 0.6,
            transparent: true,
            opacity: 0.8,
        });

        // Palm
        palmMesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 12, 12),
            skinMat
        );
        palmMesh.scale.set(1.3, 0.7, 1);
        handGroup.add(palmMesh);

        // Fingers (2)
        fingers = [];
        const fingerOffsets = [-0.15, 0.15];
        for (let i = 0; i < 2; i++) {
            const fingerGroup = new THREE.Group();
            fingerGroup.position.set(fingerOffsets[i], 0, -0.25);

            // Segments
            for (let s = 0; s < 3; s++) {
                const seg = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.04 - s * 0.008, 0.04 - s * 0.005, 0.15, 8),
                    skinMat
                );
                seg.position.set(0, 0, -s * 0.14);
                seg.rotation.x = Math.PI / 2;
                fingerGroup.add(seg);
            }

            // Claw tip
            const claw = new THREE.Mesh(
                new THREE.ConeGeometry(0.025, 0.08, 6),
                clawMat
            );
            claw.position.set(0, 0, -0.45);
            claw.rotation.x = Math.PI / 2;
            fingerGroup.add(claw);

            handGroup.add(fingerGroup);
            fingers.push(fingerGroup);
        }

        // Thumb
        thumb = new THREE.Group();
        thumb.position.set(0.22, -0.05, -0.05);
        thumb.rotation.z = -0.5;

        const thumbSeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.04, 0.12, 8),
            skinMat
        );
        thumbSeg.rotation.x = Math.PI / 2;
        thumb.add(thumbSeg);

        const thumbClaw = new THREE.Mesh(
            new THREE.ConeGeometry(0.03, 0.06, 6),
            clawMat
        );
        thumbClaw.position.set(0, 0, -0.1);
        thumbClaw.rotation.x = Math.PI / 2;
        thumb.add(thumbClaw);

        handGroup.add(thumb);

        // Forearm
        forearm = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.12, 0.5, 8),
            skinMat
        );
        forearm.position.set(0, 0, 0.35);
        forearm.rotation.x = Math.PI / 2;
        handGroup.add(forearm);

        // Position in front of camera
        handGroup.position.set(0.3, -0.35, -0.6);
        handGroup.rotation.set(0.2, -0.1, 0);

        scene.add(handGroup);
        currentHandColor = '#' + colors.skin.toString(16).padStart(6, '0');
        currentHandAccent = '#' + colors.accent.toString(16).padStart(6, '0');
    }

    /* ── Hand Animations ── */
    function updateHandAnimation(dt) {
        if (!handGroup || !handGroup.visible) return;

        const t = clock.getElapsedTime();

        // Base sway
        const swayX = Math.sin(t * 1.2) * 0.01;
        const swayY = Math.sin(t * 0.8) * 0.008;

        // Shake from timer pressure
        const shakeX = (Math.random() - 0.5) * handShakeIntensity * 0.05;
        const shakeY = (Math.random() - 0.5) * handShakeIntensity * 0.05;

        // Aim offset
        const aimOffX = aimX * 0.15;
        const aimOffY = aimY * -0.05;

        handGroup.position.x = 0.3 + swayX + shakeX + aimOffX;
        handGroup.position.y = -0.35 + swayY + shakeY + aimOffY;

        // Charge pullback
        if (handAnimState === 'charging') {
            handGroup.position.z = -0.6 + chargeAmount * 0.2;
            handGroup.rotation.x = 0.2 - chargeAmount * 0.3;
            // Fingers squeeze
            fingers.forEach(f => {
                f.rotation.x = chargeAmount * 0.3;
            });
            // Tremor at high charge
            if (chargeAmount > 0.7) {
                handGroup.position.x += (Math.random() - 0.5) * chargeAmount * 0.02;
                handGroup.position.y += (Math.random() - 0.5) * chargeAmount * 0.02;
            }
        } else if (handAnimState === 'idle') {
            handGroup.position.z = -0.6;
            handGroup.rotation.x = 0.2;
            fingers.forEach(f => { f.rotation.x = Math.sin(t * 0.5) * 0.05; });
        } else if (handAnimState === 'released') {
            // After throw — hand drops
            handGroup.position.z = -0.65;
            handGroup.position.y = -0.45;
            handGroup.rotation.x = 0.5;
            fingers.forEach(f => { f.rotation.x = -0.4; });
        } else if (handAnimState === 'exploded') {
            // Fingers splay
            fingers.forEach((f, i) => {
                f.rotation.x = -0.8;
                f.rotation.z = (i === 0 ? -0.5 : 0.5);
            });
            thumb.rotation.z = -1.2;
            handGroup.position.y = -0.5 + Math.random() * 0.05;
        }

        // Vein pulse — emissive intensity
        const veinPulse = (Math.sin(t * veinPulseSpeed * 4) + 1) * 0.5;
        handMaterials.forEach(m => {
            m.emissiveIntensity = 0.05 + veinPulse * 0.15 * (handShakeIntensity + 0.2);
        });
    }

    /* ══════════════════════════════════
       THROW PHYSICS
       ══════════════════════════════════ */
    function launchGrenade(power, aimH, aimV, deviation, goldenApple = false) {
        isGoldenApple = goldenApple;
        if (goldenApple) {
            createGoldenAppleVisual();
            trailLine.material.color.set(0xffd700);
        } else {
            restoreGrenadeVisual();
            trailLine.material.color.set(0xff6633);
        }

        grenadeGroup.visible = true;
        grenadeGroup.position.copy(THROW_POS);
        grenadeGroup.position.y += 1.4;
        grenadeInFlight = true;
        grenadeStartTime = clock.getElapsedTime();

        resetTrail();

        // Calculate launch parameters using spec
        let launchAngle, speed;
        if (power < 0.2) {
            launchAngle = 45 * (Math.PI / 180);
            speed = 8 + power * 20;
        } else if (power < 0.4) {
            launchAngle = 55 * (Math.PI / 180);
            speed = 14 + (power - 0.2) * 25;
        } else if (power < 0.7) {
            launchAngle = 60 * (Math.PI / 180);
            speed = 20 + (power - 0.4) * 8;
        } else if (power < 0.9) {
            launchAngle = 65 * (Math.PI / 180);
            speed = 24 + (power - 0.7) * 10;
        } else {
            // Overcooked — shouldn't reach here, handled in game.js
            launchAngle = 70 * (Math.PI / 180);
            speed = 30;
        }

        // Apply aim deviation
        const deviationH = (aimH + (Math.random() - 0.5) * deviation * 2) * 0.3;
        const deviationV = (Math.random() - 0.5) * deviation * 0.15;

        // Velocity
        const vUp = Math.sin(launchAngle + deviationV) * speed;
        const vForward = Math.cos(launchAngle + deviationV) * speed;

        grenadeVelocity.set(
            deviationH * speed * 0.5,
            vUp,
            -vForward // negative Z = toward stake
        );

        // Switch hand to released
        handAnimState = 'released';

        // Camera follow after brief delay
        setTimeout(() => {
            if (grenadeInFlight) cameraMode = CAM_FOLLOW_GRENADE;
        }, 200);

        return grenadeVelocity.clone();
    }

    function updateGrenadePhysics(dt) {
        if (!grenadeInFlight) return null;

        // Gravity
        grenadeVelocity.y -= 9.8 * dt;

        // Update position
        grenadeGroup.position.add(grenadeVelocity.clone().multiplyScalar(dt));

        // Tumble rotation
        grenadeGroup.rotation.x += dt * 3;
        grenadeGroup.rotation.z += dt * 2;

        // Add trail
        addTrailPoint(grenadeGroup.position);

        // Fuse glow flicker
        const flicker = 0.8 + Math.random() * 0.4;
        fuseLight.intensity = flicker * (isGoldenApple ? 2 : 1);

        // Check landing conditions
        const gp = grenadeGroup.position;
        const stakeFloor = STAKE_POS.y;

        // Fell into void (below platforms)
        if (gp.y < STAKE_POS.y - 15) {
            grenadeInFlight = false;
            cameraMode = CAM_FIRST_PERSON;
            return { result: 'void', distance: Infinity, position: gp.clone() };
        }

        // Check if at stake platform height and past it
        if (gp.y <= stakeFloor + 0.3 && gp.z < STAKE_POS.z + STAKE_PLATFORM_RADIUS) {
            // Check if on stake platform
            const dx = gp.x - STAKE_POS.x;
            const dz = gp.z - STAKE_POS.z;
            const distFromStake = Math.sqrt(dx * dx + dz * dz);

            if (distFromStake <= STAKE_PLATFORM_RADIUS + 1) {
                // Landed on or near platform
                grenadeInFlight = false;
                grenadeGroup.position.y = stakeFloor + 0.15;

                // Determine result
                let result;
                if (distFromStake <= 0.3) result = 'ringer';
                else if (distFromStake <= 0.7) result = 'leaner';
                else if (distFromStake <= 1.5) result = 'close';
                else if (distFromStake <= 2.5) result = 'near';
                else if (distFromStake <= 4.0) result = 'far';
                else result = 'whiff';

                cameraMode = CAM_IMPACT;
                return { result, distance: distFromStake, position: gp.clone() };
            } else if (gp.y <= stakeFloor - 5) {
                // Missed platform entirely
                grenadeInFlight = false;
                cameraMode = CAM_FIRST_PERSON;
                return { result: 'void', distance: Infinity, position: gp.clone() };
            }
        }

        // Overshot far past stake
        if (gp.z < STAKE_POS.z - STAKE_PLATFORM_RADIUS - 5 && gp.y < stakeFloor) {
            grenadeInFlight = false;
            cameraMode = CAM_FIRST_PERSON;
            return { result: 'void', distance: Infinity, position: gp.clone() };
        }

        return null; // Still in flight
    }

    /* ══════════════════════════════════
       CAMERA SYSTEM
       ══════════════════════════════════ */
    function updateCamera(dt) {
        const t = clock.getElapsedTime();

        if (cameraMode === CAM_FIRST_PERSON) {
            // First person on throw platform
            const targetPos = THROW_POS.clone();
            targetPos.y += 1.6;
            camera.position.lerp(targetPos, dt * 5);

            const lookTarget = STAKE_POS.clone();
            lookTarget.y += 2;
            // Subtle breathing
            lookTarget.x += Math.sin(t * 0.3) * 0.1;
            lookTarget.y += Math.sin(t * 0.5) * 0.05;

            const currentDir = new THREE.Vector3();
            camera.getWorldDirection(currentDir);
            const wantedDir = lookTarget.clone().sub(camera.position).normalize();
            currentDir.lerp(wantedDir, dt * 3);
            camera.lookAt(camera.position.clone().add(currentDir.multiplyScalar(10)));

        } else if (cameraMode === CAM_FOLLOW_GRENADE && grenadeInFlight) {
            // Ride behind and above grenade
            const gp = grenadeGroup.position;
            const gv = grenadeVelocity.clone().normalize();
            const camOffset = gv.clone().multiplyScalar(-2);
            camOffset.y += 1.5;

            const targetCam = gp.clone().add(camOffset);
            camera.position.lerp(targetCam, dt * 4);

            // Look ahead of grenade
            const lookAhead = gp.clone().add(grenadeVelocity.clone().normalize().multiplyScalar(3));
            camera.lookAt(lookAhead);

        } else if (cameraMode === CAM_IMPACT) {
            // Overhead angled view of landing
            const gp = grenadeGroup.position;
            const targetCam = gp.clone();
            targetCam.y += 4;
            targetCam.z += 3;
            camera.position.lerp(targetCam, dt * 3);
            camera.lookAt(gp);
        }
    }

    /* ══════════════════════════════════
       PARTICLE EFFECTS
       ══════════════════════════════════ */
    let activeParticles = [];

    function spawnExplosion(position, color = 0xff4400, count = 80, intensity = 1) {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(count * 3);
        const vel = [];
        for (let i = 0; i < count; i++) {
            pos[i * 3] = position.x;
            pos[i * 3 + 1] = position.y;
            pos[i * 3 + 2] = position.z;
            vel.push(new THREE.Vector3(
                (Math.random() - 0.5) * 8 * intensity,
                Math.random() * 6 * intensity,
                (Math.random() - 0.5) * 8 * intensity
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            size: 0.2 * intensity,
            color,
            transparent: true,
            opacity: 1,
        });
        const particles = new THREE.Points(geo, mat);
        particles.userData = { vel, life: 0, maxLife: 1.5, mat };
        scene.add(particles);
        activeParticles.push(particles);

        // Flash light
        const flash = new THREE.PointLight(color, 5 * intensity, 15);
        flash.position.copy(position);
        scene.add(flash);
        setTimeout(() => scene.remove(flash), 200);
    }

    function spawnRingerParticles(position) {
        spawnExplosion(position, 0x00ff66, 50, 0.8);
        // Additional upward burst
        const geo = new THREE.BufferGeometry();
        const count = 30;
        const pos = new Float32Array(count * 3);
        const vel = [];
        for (let i = 0; i < count; i++) {
            pos[i * 3] = position.x + (Math.random() - 0.5) * 0.3;
            pos[i * 3 + 1] = position.y;
            pos[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.3;
            vel.push(new THREE.Vector3(
                (Math.random() - 0.5) * 1,
                3 + Math.random() * 5,
                (Math.random() - 0.5) * 1
            ));
        }
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const mat = new THREE.PointsMaterial({
            size: 0.15,
            color: 0x00ff66,
            transparent: true,
            opacity: 1,
        });
        const particles = new THREE.Points(geo, mat);
        particles.userData = { vel, life: 0, maxLife: 2, mat };
        scene.add(particles);
        activeParticles.push(particles);
    }

    function updateParticles(dt) {
        for (let i = activeParticles.length - 1; i >= 0; i--) {
            const p = activeParticles[i];
            p.userData.life += dt;
            const lifeRatio = p.userData.life / p.userData.maxLife;

            if (lifeRatio >= 1) {
                scene.remove(p);
                activeParticles.splice(i, 1);
                continue;
            }

            // Update positions
            const positions = p.geometry.attributes.position.array;
            const count = positions.length / 3;
            for (let j = 0; j < count; j++) {
                const vel = p.userData.vel[j];
                positions[j * 3] += vel.x * dt;
                positions[j * 3 + 1] += vel.y * dt;
                positions[j * 3 + 2] += vel.z * dt;
                vel.y -= 4 * dt; // gravity on particles
            }
            p.geometry.attributes.position.needsUpdate = true;

            // Fade
            p.userData.mat.opacity = 1 - lifeRatio;
        }
    }

    /* ══════════════════════════════════
       ANIMATION LOOP
       ══════════════════════════════════ */
    function animate() {
        requestAnimationFrame(animate);
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.getElapsedTime();

        // Hyperspace rotation
        if (hyperspaceParticles) {
            hyperspaceParticles.rotation.y += dt * 0.01;

            // Streak drift
            const streaks = hyperspaceParticles.userData.streaks;
            if (streaks) {
                const sp = streaks.geometry.attributes.position.array;
                const vels = streaks.userData.velocities;
                for (let i = 0; i < vels.length; i++) {
                    sp[i * 3 + 1] -= vels[i] * dt * 5;
                    if (sp[i * 3 + 1] < -50) sp[i * 3 + 1] = 50;
                }
                streaks.geometry.attributes.position.needsUpdate = true;
            }
        }

        // Nebula pulse
        nebulaeMeshes.forEach(n => {
            const pulse = (Math.sin(t * n.userData.pulseSpeed + n.userData.pulseOffset) + 1) * 0.5;
            n.material.opacity = 0.04 + pulse * 0.04;
            n.scale.setScalar(1 + pulse * 0.05);
        });

        // Stake beacon pulse
        if (stakeBeacon) {
            stakeBeacon.material.opacity = stakeBeacon.userData.pulseBase + Math.sin(t * 2) * 0.1;
        }

        // Stake cap pulse
        if (stakeMesh) {
            stakeMesh.children.forEach(c => {
                if (c.userData.isPulsing) {
                    c.material.emissiveIntensity = 0.5 + Math.sin(t * 3) * 0.3;
                }
            });
        }

        // Distant platform beacons
        distantPlatforms.forEach(dp => {
            dp.children.forEach(c => {
                if (c.userData.pulseOffset !== undefined) {
                    c.material.opacity = 0.3 + Math.sin(t * 1.5 + c.userData.pulseOffset) * 0.3;
                }
            });
        });

        // Tether particle drift
        if (tetheredParticles) {
            const tp = tetheredParticles.geometry.attributes.position.array;
            for (let i = 0; i < tp.length / 3; i++) {
                tp[i * 3 + 1] += Math.sin(t * 0.5 + i * 0.1) * 0.003;
            }
            tetheredParticles.geometry.attributes.position.needsUpdate = true;
        }

        // Scoring ring pulse
        scoringRings.forEach((r, i) => {
            r.material.opacity = r.userData.baseOpacity + Math.sin(t * 1.5 + i * 0.5) * r.userData.baseOpacity * 0.3;
        });

        // Grenade physics
        const landingResult = updateGrenadePhysics(dt);
        if (landingResult && grenadeFlightCallback) {
            grenadeFlightCallback(landingResult);
            grenadeFlightCallback = null;
        }

        // Hand animation
        updateHandAnimation(dt);

        // Camera
        updateCamera(dt);

        // Particles
        updateParticles(dt);

        renderer.render(scene, camera);
    }

    /* ── Resize ── */
    function onResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    /* ══════════════════════════════════
       PUBLIC API
       ══════════════════════════════════ */
    function setPlayerHand(playerKey) {
        createAlienHand(playerKey);
    }

    function setHandVisible(visible) {
        if (handGroup) handGroup.visible = visible;
    }

    function setHandState(state) {
        handAnimState = state;
    }

    function setAim(h, v) {
        aimX = h;
        aimY = v;
    }

    function setCharge(amount) {
        chargeAmount = amount;
        handAnimState = amount > 0 ? 'charging' : 'idle';
    }

    function setHandShake(intensity) {
        handShakeIntensity = intensity;
    }

    function setVeinPulse(speed) {
        veinPulseSpeed = speed;
    }

    function throwGrenade(power, aimH, aimV, deviation, goldenApple = false) {
        return new Promise(resolve => {
            grenadeFlightCallback = resolve;
            launchGrenade(power, aimH, aimV, deviation, goldenApple);
            AudioEngine.whoosh();
        });
    }

    function detonateInHand() {
        handAnimState = 'exploded';
        const handPos = THROW_POS.clone();
        handPos.y += 1.4;
        spawnExplosion(handPos, 0xff2200, 100, 1.5);
        AudioEngine.explosion(1.5);

        // Camera shake effect
        camera.position.x += (Math.random() - 0.5) * 0.5;
        camera.position.y += (Math.random() - 0.5) * 0.3;
    }

    function detonateMidAir() {
        if (grenadeInFlight) {
            const pos = grenadeGroup.position.clone();
            grenadeInFlight = false;
            grenadeGroup.visible = false;
            spawnExplosion(pos, 0xff8833, 60, 1);
            AudioEngine.explosion(0.8);
            cameraMode = CAM_FIRST_PERSON;
            return pos;
        }
        return null;
    }

    function resetForNextThrow() {
        grenadeGroup.visible = false;
        grenadeInFlight = false;
        resetTrail();
        cameraMode = CAM_FIRST_PERSON;
        handAnimState = 'idle';
        chargeAmount = 0;
        aimX = 0;
        aimY = 0.6;
        handShakeIntensity = 0;
        veinPulseSpeed = 1;
        restoreGrenadeVisual();
    }

    function showLandingEffect(result, position) {
        switch (result) {
            case 'ringer':
                spawnRingerParticles(position);
                AudioEngine.ringerChime();
                break;
            case 'leaner':
                spawnExplosion(position, 0xff8833, 30, 0.6);
                AudioEngine.leanerClang();
                break;
            case 'close':
            case 'near':
                AudioEngine.impact(result === 'close' ? 0.5 : 0.3);
                break;
            case 'far':
                AudioEngine.impact(0.2);
                break;
            case 'whiff':
                AudioEngine.whiffSound();
                break;
            case 'void':
                AudioEngine.distantExplosion();
                setTimeout(() => {
                    spawnExplosion(position.clone().setY(position.y - 10), 0xff4400, 30, 0.5);
                }, 400);
                break;
        }
    }

    function setPlatformGlow(teamColor) {
        if (throwPlatform) {
            throwPlatform.material.emissive.set(
                teamColor === 'red' ? 0x220000 : 0x000022
            );
        }
    }

    function snapCamera() {
        // Hard cut back to first person
        cameraMode = CAM_FIRST_PERSON;
        camera.position.copy(THROW_POS);
        camera.position.y += 1.6;
        camera.lookAt(STAKE_POS.clone().add(new THREE.Vector3(0, 2, 0)));
    }

    return {
        init,
        setPlayerHand,
        setHandVisible,
        setHandState,
        setAim,
        setCharge,
        setHandShake,
        setVeinPulse,
        throwGrenade,
        detonateInHand,
        detonateMidAir,
        resetForNextThrow,
        showLandingEffect,
        setPlatformGlow,
        snapCamera,
        createGoldenAppleVisual,
        restoreGrenadeVisual,
        get grenadeInFlight() { return grenadeInFlight; },
        get grenadePosition() { return grenadeGroup ? grenadeGroup.position.clone() : null; },
    };
})();
