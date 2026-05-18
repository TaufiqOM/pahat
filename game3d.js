import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

const levels = [
    {
        name: "Patung Master 3D",
        statueImg: "assets/Gemini_Generated_Image_x3r3z1x3r3z1x3r3.png",
        isFourView: true,
        color: 0xa0a5aa, 
        resolution: 128,
        winThreshold: 0.85
    },
    {
        name: "Patung 2",
        statueImg: "assets/IMG_20260512_074340.png",
        color: 0x9a8b7a, 
        resolution: 96,
        winThreshold: 0.8
    },
    {
        name: "Patung 3",
        statueImg: "assets/IMG_20260512_074401.png",
        color: 0x8b857a, 
        resolution: 96, 
        winThreshold: 0.85
    },
    {
        name: "Patung Ganesha",
        statueImg: "assets/ganesha_color.png",
        color: 0x9a8b8b, 
        resolution: 96, 
        winThreshold: 0.85
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
let targetField = null;
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
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        
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

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.2); // Darker ambient for more contrast
        scene.add(ambientLight);

        // High-contrast Spotlight
        const spotLight = new THREE.SpotLight(0xffffff, 40);
        spotLight.position.set(5, 10, 5);
        spotLight.angle = Math.PI / 8;
        spotLight.penumbra = 0.2;
        spotLight.decay = 0.5;
        spotLight.distance = 40;
        spotLight.castShadow = true;
        spotLight.shadow.mapSize.width = 2048;
        spotLight.shadow.mapSize.height = 2048;
        scene.add(spotLight);

        // Rim Light for edge highlights
        const rimLight = new THREE.DirectionalLight(0x99bbff, 0.6);
        rimLight.position.set(-5, 5, -5);
        scene.add(rimLight);

        // Fill Light
        const fillLight = new THREE.DirectionalLight(0xffeebb, 0.4);
        fillLight.position.set(-8, 2, 5);
        scene.add(fillLight);

        // Interactive Point Light (follows marker)
        const pointLight = new THREE.PointLight(0xffffff, 8, 4);
        pointLight.castShadow = false;
        scene.add(pointLight);
        scene.pointLight = pointLight;

        // Bounce Lights for better volume
        const bounce1 = new THREE.PointLight(0xffccaa, 2, 10);
        bounce1.position.set(-3, -2, 3);
        scene.add(bounce1);

        const bounce2 = new THREE.PointLight(0xaabbff, 1.5, 10);
        bounce2.position.set(3, -2, 2);
        scene.add(bounce2);

        // Ground to catch shadows
        const ground = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8 })
        );
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -1.5;
        ground.receiveShadow = true;
        scene.add(ground);

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
        document.getElementById('btn-destroy').onclick = destroyEverything;
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

async function loadLevel(index) {
    console.log("Loading level:", index);
    currentLevelIndex = index;
    currentStage = 1;
    updateHUD();
    
    if (marchContext) scene.remove(marchContext);
    
    const level = levels[index];

    // Marching Cubes Setup (The Solid Mass)
    try {
        const resolution = level.resolution;
        const textureLoader = new THREE.TextureLoader();
        const texture = textureLoader.load(level.statueImg);
        texture.colorSpace = THREE.SRGBColorSpace;

        const material = new THREE.MeshStandardMaterial({ 
            color: level.color, 
            roughness: 0.8,
            metalness: 0.15,
            flatShading: true,
            side: THREE.DoubleSide
        });

        material.onBeforeCompile = (shader) => {
            shader.uniforms.uTex = { value: texture };
            shader.uniforms.uRockColor = { value: new THREE.Color(level.color) };
            shader.uniforms.uIsFourView = { value: !!level.isFourView };
            
            shader.vertexShader = `
                varying vec3 vLocalPos;
                varying vec3 vNormal;
                ${shader.vertexShader}
            `.replace(
                `#include <begin_vertex>`,
                `#include <begin_vertex>
                 vLocalPos = position;
                 vNormal = normal;`
            );
            
            shader.fragmentShader = `
                uniform sampler2D uTex;
                uniform vec3 uRockColor;
                uniform bool uIsFourView;
                varying vec3 vLocalPos;
                varying vec3 vNormal;
                ${shader.fragmentShader}
            `.replace(
                `#include <map_fragment>`,
                `
                #include <map_fragment>
                
                vec2 projUv;
                if (uIsFourView) {
                    // Mapping 4-View (2x2 Grid)
                    vec2 uvBase = vec2(vLocalPos.x * 0.5 + 0.5, vLocalPos.y * 0.5 + 0.5);
                    vec2 uvZ = vec2(vLocalPos.z * 0.5 + 0.5, vLocalPos.y * 0.5 + 0.5);
                    
                    if (abs(vNormal.z) > abs(vNormal.x)) {
                        if (vNormal.z > 0.0) { // Depan
                            projUv = uvBase * 0.5 + vec2(0.0, 0.5);
                        } else { // Belakang
                            projUv = uvBase * 0.5 + vec2(0.5, 0.5);
                        }
                    } else {
                        if (vNormal.x > 0.0) { // Samping Kanan
                            projUv = uvZ * 0.5 + vec2(0.0, 0.0);
                        } else { // Samping Kiri
                            projUv = vec2(1.0 - uvZ.x, uvZ.y) * 0.5 + vec2(0.5, 0.0);
                        }
                    }
                } else {
                    projUv = vec2(vLocalPos.x * 0.5 + 0.5, vLocalPos.y * 0.5 + 0.5);
                }
                
                vec4 texColor = texture2D(uTex, projUv);
                
                float dX = min(vLocalPos.x - (-0.67), 0.67 - vLocalPos.x);
                float dY = min(vLocalPos.y - (-0.87), 0.87 - vLocalPos.y);
                float dZ = min(vLocalPos.z - (-0.87), 0.87 - vLocalPos.z);
                float minDist = min(min(dX, dY), dZ);
                float blend = smoothstep(0.02, 0.12, minDist);
                
                diffuseColor = vec4(mix(uRockColor, texColor.rgb, blend), opacity);
                `
            );
        };
        
        // TEST BOX (Diagnostic)
        const testBox = new THREE.Mesh(
            new THREE.BoxGeometry(2, 2, 2),
            new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true, transparent: true, opacity: 0.2 })
        );
        testBox.name = "DEBUG_BOX";
        // scene.add(testBox); // Uncomment if everything else fails
        
        marchContext = new MarchingCubes(resolution, material, true, false, 200000);
        marchContext.position.set(0, 0, 0);
        marchContext.scale.set(1.5, 1.5, 1.5);
        marchContext.isolation = 80;
        marchContext.castShadow = false;
        marchContext.receiveShadow = false;
        
        // Wait for the heightmap image to load and generate target field
        await loadHeightmap(level.statueImg, resolution, level.isFourView);
        
        // Fill the mass with density (dirt)
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

function loadHeightmap(url, res, isFourView = false) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 512; // Ukuran tetap untuk sampling yang konsisten
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 512, 512);
            const data = ctx.getImageData(0, 0, 512, 512).data;
            const dataRes = 512;
            
            targetField = new Float32Array(res * res * res);
            
            if (isFourView) {
                // === REKONSTRUKSI 3D ORGANIK (4-View Depth Mapping) ===
                // Menggunakan kombinasi Siluet + Luminance untuk menciptakan bentuk yang membulat
                const half = 256;
                
                const getPixelData = (view, px, py) => {
                    let qx = 0, qy = 0;
                    if (view === 'front')  { qx = 0;    qy = 0;    }
                    if (view === 'back')   { qx = half;  qy = 0;    }
                    if (view === 'right')  { qx = 0;     qy = half; }
                    if (view === 'left')   { qx = half;  qy = half; }
                    
                    const ix = Math.min(Math.floor(px * (half - 1)), half - 1);
                    const iy = Math.min(Math.floor(py * (half - 1)), half - 1);
                    const pixelIdx = ((qy + iy) * dataRes + (qx + ix)) * 4;
                    
                    const r = data[pixelIdx], g = data[pixelIdx+1], b = data[pixelIdx+2], a = data[pixelIdx+3];
                    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
                    return { a, lum };
                };

                for (let gy = 0; gy < res; gy++) {
                    const ny = gy / (res - 1);
                    const imgY = 1.0 - ny;

                    for (let gx = 0; gx < res; gx++) {
                        const nx = gx / (res - 1); 
                        const pF = getPixelData('front', nx, imgY);
                        const pB = getPixelData('back', nx, imgY); 
                        
                        const dF = (pF.a > 20 && pF.lum < 0.92) ? (0.1 + (1.0 - pF.lum) * 0.9) : 0;
                        const dB = (pB.a > 20 && pB.lum < 0.92) ? (0.1 + (1.0 - pB.lum) * 0.9) : 0;

                        if (dF === 0 && dB === 0) continue;

                        for (let gz = 0; gz < res; gz++) {
                            const nz = gz / (res - 1); 
                            
                            const pR = getPixelData('right', 1.0 - nz, imgY);
                            const pL = getPixelData('left', nz, imgY);
                            
                            const dR = (pR.a > 20 && pR.lum < 0.92) ? (0.1 + (1.0 - pR.lum) * 0.9) : 0;
                            const dL = (pL.a > 20 && pL.lum < 0.92) ? (0.1 + (1.0 - pL.lum) * 0.9) : 0;

                            if (dR === 0 && dL === 0) continue;

                            // Intersection of 4 Volumes
                            const isInsideFront = (1.0 - nz) <= dF; 
                            const isInsideBack  = nz <= dB;
                            const isInsideRight = (1.0 - nx) <= dR;
                            const isInsideLeft  = nx <= dL;

                            if (isInsideFront && isInsideBack && isInsideRight && isInsideLeft) {
                                const idx = gx + gy * res + gz * res * res;
                                targetField[idx] = 200;
                            }
                        }
                    }
                }
            } else {
                // Logika Single-View Relief (seperti sebelumnya)
                const minZ = Math.floor(res * 0.05); 
                const maxZ = Math.floor(res * 0.95); 
                const depthRange = maxZ - minZ;
                
                for (let x = 0; x < res; x++) {
                    for (let y = 0; y < res; y++) {
                        const lx = x / res;
                        const ly = y / res;
                        const idxImg = (Math.floor((1 - ly) * (dataRes - 1)) * dataRes + Math.floor(lx * (dataRes - 1))) * 4;
                        
                        const r = data[idxImg], g = data[idxImg+1], b = data[idxImg+2], a = data[idxImg+3];
                        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255.0;
                        
                        let brightness = 0;
                        if (a > 10 && lum < 0.9) { 
                            brightness = 0.3 + (1.0 - lum) * 0.7; 
                            const wave = Math.sin(x * 0.1) * Math.cos(y * 0.1) * 0.05;
                            brightness += wave;
                            brightness = Math.max(0.1, Math.min(1.0, brightness));
                        }
                        
                        const centerZ = res / 2;
                        const halfThickness = brightness > 0 ? (brightness * (res * 0.4)) : 0;
                        const startZ = Math.floor(centerZ - halfThickness);
                        const endZ = Math.ceil(centerZ + halfThickness);
                        
                        for (let z = 0; z < res; z++) {
                            const idx = x + y * res + z * res * res;
                            if (z >= startZ && z <= endZ && brightness > 0) {
                                targetField[idx] = 200; 
                            } else {
                                targetField[idx] = 0;
                            }
                        }
                    }
                }
            }
            
            smoothField(targetField, res);
            resolve();
        };
        img.onerror = () => {
            console.error("Failed to load heightmap image:", url);
            targetField = new Float32Array(res * res * res);
            resolve();
        };
    });
}

function smoothField(field, res) {
    const temp = new Float32Array(field.length);
    // Simple 3D Box Blur to remove spikes
    for (let z = 1; z < res - 1; z++) {
        const zResRes = z * res * res;
        for (let y = 1; y < res - 1; y++) {
            const yRes = y * res;
            for (let x = 1; x < res - 1; x++) {
                const idx = x + yRes + zResRes;
                
                // 3x3x3 neighborhood average
                let sum = 0;
                for (let dz = -1; dz <= 1; dz++) {
                    const dzOff = (z + dz) * res * res;
                    for (let dy = -1; dy <= 1; dy++) {
                        const dyOff = (y + dy) * res;
                        for (let dx = -1; dx <= 1; dx++) {
                            sum += field[x + dx + dyOff + dzOff];
                        }
                    }
                }
                temp[idx] = sum / 27;
            }
        }
    }
    field.set(temp);
}

function fillMass(mc) {
    const res = mc.resolution;
    mc.reset(); 
    
    // Separate padding for each axis to perfectly fit the taller statue proportions
    const paddingX = Math.floor(res * 0.15);
    const paddingY = Math.floor(res * 0.05); // Taller box to prevent head/base from sticking out
    const paddingZ = Math.floor(res * 0.05);
    
    for (let x = 0; x < res; x++) {
        for (let y = 0; y < res; y++) {
            for (let z = 0; z < res; z++) {
                let val = 0;
                
                // Solid rectangular slab of stone
                if (x >= paddingX && x < res - paddingX && 
                    y >= paddingY && y < res - paddingY && 
                    z >= paddingZ && z < res - paddingZ) {
                    val = 100;
                }
                
                const idx = x + y * res + z * res * res;
                // Ensure dirt fully covers the hidden statue (threshold > 30 to cover blurred details near boundaries)
                if (targetField && targetField[idx] > 30) {
                    val = Math.max(val, 100);
                }
                
                mc.field[idx] = val;
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
        // Move interactive light to cursor
        if (scene.pointLight) {
            scene.pointLight.position.copy(intersects[0].point);
            scene.pointLight.position.add(intersects[0].face.normal.multiplyScalar(0.2));
        }
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
                    
                    const currentRadius = baseRadius; // Remove jitter for more accurate carving
                    const distSq = dx*dx + dy*dy + dz*dz;
                    
                    if (distSq < currentRadius * currentRadius) {
                        const idx = x + y * res + z * res * res;
                        if (mc.field[idx] > 10) {
                            let targetDensity = targetField ? targetField[idx] : 0;
                            let newVal = mc.field[idx] - strength; 
                            
                            // Prevent carving into the hidden statue
                            if (targetDensity >= 80 && newVal < 80) {
                                newVal = 80;
                            }
                            
                            if (newVal < 0) newVal = 0;
                            
                            if (mc.field[idx] !== newVal) {
                                mc.field[idx] = newVal;
                                changed = true;
                            }
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

function destroyEverything() {
    if (!targetField || !marchContext) return;
    
    saveState();
    
    // Create epic destruction effect
    const res = marchContext.resolution;
    const level = levels[currentLevelIndex];
    
    // Spawn lots of particles
    for (let i = 0; i < 150; i++) {
        const randomPos = new THREE.Vector3(
            (Math.random() - 0.5) * 2.5,
            (Math.random() - 0.5) * 2.5,
            (Math.random() - 0.5) * 2.5
        );
        particles.push(new Fragment3D(randomPos, level.color, 0.15));
    }
    
    // We only reduce density, never increase it (so we don't 'grow' stone back)
    for (let i = 0; i < marchContext.field.length; i++) {
        if (targetField[i] < marchContext.field[i]) {
            marchContext.field[i] = targetField[i];
        }
    }
    
    marchContext.update();
    
    // Shake camera
    camera.position.x += (Math.random() - 0.5) * 0.5;
    camera.position.y += (Math.random() - 0.5) * 0.5;
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
    
    // Pulse rim light slightly
    const time = Date.now() * 0.001;
    scene.children.forEach(child => {
        if (child.isDirectionalLight && child.color.b > 0.8) {
            child.intensity = 0.5 + Math.sin(time) * 0.1;
        }
    });

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
        if (!particles[i].update()) {
            particles.splice(i, 1);
        }
    }

    renderer.render(scene, camera);
}

init();
