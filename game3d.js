import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

const levels = [
    {
        name: "Shiva Lingam",
        statueImg: "assets/lingga.png",
        color: 0x444444,
        resolution: 24,
        winThreshold: 0.8
    },
    {
        name: "Lord Ganesha",
        statueImg: "assets/ganesha.png",
        color: 0x888888,
        resolution: 32,
        winThreshold: 0.85
    },
    {
        name: "Garuda",
        statueImg: "assets/garuda.png",
        color: 0x5d3a1a,
        resolution: 36,
        winThreshold: 0.9
    }
];

const TOOLS = {
    BODAN: {
        id: 'BODAN',
        name: 'Palu Bodan',
        radius: 6.8,
        strength: 150,
        hint: "Palu Bodan untuk hantaman awal membelah blok batu",
        particleCount: 15,
        particleSize: 0.18,
        shake: 0.08
    },
    RUNCING: {
        id: 'RUNCING',
        name: 'Tatah Runcing',
        radius: 4.2,
        strength: 110,
        hint: "Tatah Runcing untuk membuat lekukan dan bentuk dasar",
        particleCount: 8,
        particleSize: 0.1,
        shake: 0.03
    },
    GERIGI: {
        id: 'GERIGI',
        name: 'Tatah Gerigi',
        radius: 2.8,
        strength: 80,
        hint: "Tatah Gerigi untuk meratakan massa dan membentuk tekstur",
        particleCount: 5,
        particleSize: 0.06,
        shake: 0.01
    },
    PIPIH: {
        id: 'PIPIH',
        name: 'Tatah Pipih',
        radius: 1.8,
        strength: 50,
        hint: "Tatah Pipih untuk menghaluskan bidang dan detail akhir",
        particleCount: 3,
        particleSize: 0.04,
        shake: 0
    }
};

let currentLevelIndex = 0;
let currentStage = 1; 
let mode = 'sculpt';
let currentTool = TOOLS.BODAN;

let scene, camera, renderer, controls, raycaster;
let marchContext;
let statueCore, debugMarker;
let particles = [];
let isMouseDown = false;
let progress = 0;
let lastHitTime = 0;
let strengthMultiplier = 1.0;

// History System
const MAX_HISTORY = 40;
let undoStack = [];
let redoStack = [];

function saveState() {
    // Save current field state
    const currentState = new Float32Array(marchContext.field);
    undoStack.push(currentState);
    if (undoStack.length > MAX_HISTORY) {
        undoStack.shift();
    }
    // Clear redo stack when new action is performed
    redoStack = [];
}

function undo() {
    if (undoStack.length === 0) return;
    
    // Save current to redo
    redoStack.push(new Float32Array(marchContext.field));
    
    // Restore last
    const prevState = undoStack.pop();
    marchContext.field.set(prevState);
    marchContext.update();
}

function redo() {
    if (redoStack.length === 0) return;
    
    // Save current to undo
    undoStack.push(new Float32Array(marchContext.field));
    
    // Restore next
    const nextState = redoStack.pop();
    marchContext.field.set(nextState);
    marchContext.update();
}

// Particle class for fragments
class Fragment3D {
    constructor(pos, color, size = 0.1) {
        // Randomize geometry for more natural shards
        const geometry = Math.random() > 0.5 ? 
            new THREE.BoxGeometry(size, size, size) : 
            new THREE.TetrahedronGeometry(size);
            
        this.mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshLambertMaterial({ color: color })
        );
        this.mesh.position.copy(pos);
        // Random rotation for shards
        this.mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        
        this.velocity = new THREE.Vector3(
            (Math.random() - 0.5) * 0.25,
            (Math.random()) * 0.35, // More upward velocity
            (Math.random() - 0.5) * 0.25
        );
        this.rotSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2,
            (Math.random() - 0.5) * 0.2
        );
        this.life = 1.0;
        scene.add(this.mesh);
    }
    update() {
        this.mesh.position.add(this.velocity);
        this.mesh.rotation.x += this.rotSpeed.x;
        this.mesh.rotation.y += this.rotSpeed.y;
        this.velocity.y -= 0.015; // Stronger gravity
        this.life -= 0.02;
        this.mesh.scale.setScalar(this.life);
        if (this.life <= 0) {
            scene.remove(this.mesh);
            return false;
        }
        return true;
    }
}

function init() {
    console.log("Initializing Game 3D...");
    try {
        // Scene setup
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0b0b0e);
        scene.fog = new THREE.Fog(0x0b0b0e, 5, 20);

        camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 1, 4);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        
        const container = document.getElementById('game-container');
        if (!container) {
            console.error("Game container not found!");
            return;
        }
        container.appendChild(renderer.domElement);
        console.log("Renderer appended to container.");

        // Controls
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.enabled = false;

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        scene.add(dirLight);

        const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
        backLight.position.set(-5, -2, -5);
        scene.add(backLight);

        // Debug Marker
        debugMarker = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0xff0000 })
        );
        debugMarker.visible = false;
        scene.add(debugMarker);

        raycaster = new THREE.Raycaster();

        window.addEventListener('resize', onWindowResize);
        
        // GLOBAL DIAGNOSTIC: Captured events to bypass any blocking
        window.addEventListener('pointerdown', (e) => {
            console.log("Window pointerdown detected. Active Mode:", mode);
            if (mode === 'sculpt') {
                isMouseDown = true;
                handleInteraction(e);
            }
        }, true);

        window.addEventListener('pointermove', (e) => {
            if (mode === 'sculpt') {
                updateMarker(e);
            } else {
                debugMarker.visible = false;
            }
        }, true);

        window.addEventListener('pointerup', () => {
            isMouseDown = false;
        }, true);

        // Tool Selection Events
        const toolItems = document.querySelectorAll('.tool-item');
        toolItems.forEach(item => {
            item.onclick = () => {
                const toolKey = item.getAttribute('data-tool');
                setTool(TOOLS[toolKey]);
            };
        });

        document.getElementById('btn-undo').onclick = undo;
        document.getElementById('btn-redo').onclick = redo;
        document.getElementById('btn-finish-manual').onclick = levelComplete;
        document.getElementById('btn-mode-rotate').onclick = toggleRotateMode;
        document.getElementById('btn-start').onclick = startGame;
        document.getElementById('btn-next').onclick = nextLevel;

        // Strength Control
        const strengthInput = document.getElementById('input-strength');
        const strengthVal = document.getElementById('strength-val');
        strengthInput.oninput = () => {
            strengthMultiplier = strengthInput.value / 100;
            strengthVal.textContent = strengthInput.value;
        };

        console.log("Initialization complete. Waiting for user to start.");
        animate();
    } catch (err) {
        console.error("Initialization failed:", err);
        alert("Gagal memuat game 3D. Pastikan browser Anda mendukung WebGL.");
    }
}

function startGame() {
    document.getElementById('overlay-instructions').classList.remove('active');
    loadLevel(0);
}

function setTool(tool) {
    currentTool = tool;
    mode = 'sculpt';
    
    // UI Update
    document.querySelectorAll('.tool-item').forEach(item => {
        item.classList.toggle('active', item.getAttribute('data-tool') === tool.id);
    });
    document.getElementById('btn-mode-rotate').classList.remove('active');
    controls.enabled = false;
    
    document.getElementById('hint-text').textContent = tool.hint;
}

function toggleRotateMode() {
    const btn = document.getElementById('btn-mode-rotate');
    if (mode === 'rotate') {
        // Switch back to previous tool or default to sculpt
        mode = 'sculpt';
        btn.classList.remove('active');
        controls.enabled = false;
    } else {
        mode = 'rotate';
        btn.classList.add('active');
        controls.enabled = true;
        // Remove active from all tools
        document.querySelectorAll('.tool-item').forEach(item => item.classList.remove('active'));
    }
    
    document.getElementById('hint-text').textContent = mode === 'sculpt' ? 
        currentTool.hint : "Seret untuk memutar sudut pandang";
}

function loadLevel(index) {
    console.log("Loading level:", index);
    currentLevelIndex = index;
    currentStage = 1;
    updateHUD();
    
    if (marchContext) scene.remove(marchContext);
    
    const level = levels[index];

    // Marching Cubes Setup (The Solid Mass)
    try {
        const resolution = level.resolution;
        const material = new THREE.MeshPhongMaterial({ 
            color: level.color, 
            flatShading: true, // RAW STONE LOOK
            shininess: 0,
            side: THREE.DoubleSide
        });
        
        // TEST BOX (Diagnostic)
        const testBox = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2, 2),
            new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.2 })
        );
        testBox.name = "DEBUG_BOX";
        // scene.add(testBox); // Uncomment if everything else fails
        
        marchContext = new MarchingCubes(resolution, material, true, false, 100000);
        marchContext.position.set(0, 0, 0);
        marchContext.scale.set(1.5, 1.5, 1.5);
        marchContext.isolation = 80;
        
        // Fill the mass with density
        fillMass(marchContext);
        
        // Initial update
        marchContext.update();
        marchContext.geometry.computeBoundingSphere();
        marchContext.geometry.computeBoundingBox();
        
        scene.add(marchContext);
        console.log("Level loaded with MarchingCubes.");
    } catch (err) {
        console.error("Failed to setup MarchingCubes:", err);
    }
    
    progress = 0;
}

function fillMass(mc) {
    const res = mc.resolution;
    mc.reset(); 
    
    for (let x = 0; x < res; x++) {
        for (let y = 0; y < res; y++) {
            for (let z = 0; z < res; z++) {
                let val = 0;
                const dx = Math.abs(x - res/2);
                const dy = Math.abs(y - res/2);
                const dz = Math.abs(z - res/2);
                
                // Shrink dimensions slightly to ensure it stays within the grid boundaries
                // and doesn't appear "hollow" or cut off at the top/bottom.
                if (dx < res/3.5 && dy < res/2.6 && dz < res/3.5) {
                    val = 100;
                }
                
                mc.field[x + y * res + z * res * res] = val;
            }
        }
    }
}

function updateMarker(e) {
    const cx = e.clientX !== undefined ? e.clientX : (e.touches ? e.touches[0].clientX : 0);
    const cy = e.clientY !== undefined ? e.clientY : (e.touches ? e.touches[0].clientY : 0);

    const mouse = new THREE.Vector2(
        (cx / window.innerWidth) * 2 - 1,
        -(cy / window.innerHeight) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(marchContext, false);

    if (intersects.length > 0) {
        debugMarker.visible = true;
        debugMarker.position.copy(intersects[0].point);
    } else {
        debugMarker.visible = false;
    }
}

function handleInteraction(e) {
    const cx = e.clientX !== undefined ? e.clientX : (e.touches ? e.touches[0].clientX : 0);
    const cy = e.clientY !== undefined ? e.clientY : (e.touches ? e.touches[0].clientY : 0);

    const mouse = new THREE.Vector2(
        (cx / window.innerWidth) * 2 - 1,
        -(cy / window.innerHeight) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(marchContext, false);

    if (intersects.length > 0) {
        const hit = intersects[0];
        debugMarker.visible = true;
        debugMarker.position.copy(hit.point);
        
        // Always sculpt on interaction (since it's only called on pointerdown now)
        sculptAt(hit);
    } else {
        debugMarker.visible = false;
    }
}

function sculptAt(hit) {
    const level = levels[currentLevelIndex];
    const mc = marchContext;
    const res = mc.resolution;
    
    // SAVE STATE BEFORE MODIFICATION
    saveState();

    const localPoint = mc.worldToLocal(hit.point.clone());
    
    const gridX = ((localPoint.x + 1) / 2) * res;
    const gridY = ((localPoint.y + 1) / 2) * res;
    const gridZ = ((localPoint.z + 1) / 2) * res;

    let baseRadius = currentTool.radius; 
    let strength = currentTool.strength * strengthMultiplier;

    let changed = false;
    for (let x = Math.floor(gridX - baseRadius - 1); x <= Math.ceil(gridX + baseRadius + 1); x++) {
        for (let y = Math.floor(gridY - baseRadius - 1); y <= Math.ceil(gridY + baseRadius + 1); y++) {
            for (let z = Math.floor(gridZ - baseRadius - 1); z <= Math.ceil(gridZ + baseRadius + 1); z++) {
                if (x >= 0 && x < res && y >= 0 && y < res && z >= 0 && z < res) {
                    const dx = x - gridX;
                    const dy = y - gridY;
                    const dz = z - gridZ;
                    
                    const jitter = (Math.random() - 0.5) * 1.5;
                    const currentRadius = baseRadius + jitter;
                    const distSq = dx*dx + dy*dy + dz*dz;
                    
                    if (distSq < currentRadius * currentRadius) {
                        const idx = x + y * res + z * res * res;
                        if (mc.field[idx] > 10) {
                            mc.field[idx] -= strength; 
                            if (mc.field[idx] < 0) mc.field[idx] = 0;
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    if (changed) {
        mc.update();
        
        const now = Date.now();
        if (now - lastHitTime > 50) {
            for (let i = 0; i < currentTool.particleCount; i++) {
                particles.push(new Fragment3D(hit.point, level.color, currentTool.particleSize));
            }
            
            if (currentTool.shake > 0) {
                camera.position.x += (Math.random() - 0.5) * currentTool.shake;
                camera.position.y += (Math.random() - 0.5) * currentTool.shake;
            }
            
            lastHitTime = now;
        }
    } else {
        // If nothing changed, remove the redundant state from history
        undoStack.pop();
    }
}

function updateHUD() {
    document.getElementById('current-level-num').textContent = currentLevelIndex + 1;
    document.getElementById('current-statue-name').textContent = levels[currentLevelIndex].name;
}

function levelComplete() {
    isMouseDown = false;
    scene.remove(marchContext);
    document.getElementById('success-statue-info').textContent = "Mahakarya Anda telah selesai sesuai keinginan Anda.";
    document.getElementById('overlay-success').classList.add('active');
}

function nextLevel() {
    document.getElementById('overlay-success').classList.remove('active');
    currentLevelIndex++;
    if (currentLevelIndex < levels.length) {
        loadLevel(currentLevelIndex);
    } else {
        document.getElementById('overlay-win').classList.add('active');
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    if (controls.enabled) controls.update();
    
    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        if (!particles[i].update()) {
            particles.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

init();
