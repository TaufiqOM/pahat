const levels = [
    {
        name: "Shiva Lingam",
        statueImg: "assets/lingga.png",
        textureImg: "assets/stone_raw.png",
        chipColor: "#888888",
        brushSize: 40,
        winThreshold: 85
    },
    {
        name: "Lord Ganesha",
        statueImg: "assets/ganesha.png",
        textureImg: "assets/stone_raw.png",
        chipColor: "#aaaaaa",
        brushSize: 35,
        winThreshold: 88
    },
    {
        name: "Garuda",
        statueImg: "assets/garuda.png",
        textureImg: "assets/wood_raw.png",
        chipColor: "#5d3a1a",
        brushSize: 30,
        winThreshold: 92
    }
];

let currentLevelIndex = 0;
let isDrawing = false;
let progress = 0;
let canvas, ctx, cursorTool;
let particles = [];
let isGameActive = false;

// Particle Class
class Fragment {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.size = Math.random() * 4 + 2;
        this.color = color;
        this.vx = (Math.random() - 0.5) * 10;
        this.vy = (Math.random() - 0.5) * 10 - 2;
        this.gravity = 0.5;
        this.life = 1.0;
        this.decay = Math.random() * 0.05 + 0.02;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += this.gravity;
        this.life -= this.decay;
    }

    draw(ctx) {
        ctx.save();
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = this.color;
        ctx.globalAlpha = this.life;
        ctx.beginPath();
        // Jagged particle shape
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.size, this.y + this.size/2);
        ctx.lineTo(this.x + this.size/2, this.y + this.size);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('game-canvas');
    ctx = canvas.getContext('2d', { willReadFrequently: true });
    cursorTool = document.getElementById('cursor-tool');

    ctx.clear = function() {
        this.save();
        this.setTransform(1, 0, 0, 1, 0, 0);
        this.clearRect(0, 0, canvas.width, canvas.height);
        this.restore();
    };

    initListeners();
    animate();
});

function initListeners() {
    document.getElementById('btn-start').addEventListener('click', startGame);
    document.getElementById('btn-next').addEventListener('click', nextLevel);

    canvas.addEventListener('mousedown', startCarving);
    window.addEventListener('mousemove', (e) => {
        updateCursor(e);
        if (isDrawing) carve(e);
    });
    window.addEventListener('mouseup', stopCarving);

    // Touch Support
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        startCarving(touch);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        updateCursor(touch);
        if (isDrawing) carve(touch);
    }, { passive: false });

    window.addEventListener('touchend', stopCarving);
}

function updateCursor(e) {
    const rect = canvas.getBoundingClientRect();
    const wrapperRect = document.getElementById('canvas-wrapper').getBoundingClientRect();
    cursorTool.style.left = `${e.clientX - wrapperRect.left}px`;
    cursorTool.style.top = `${e.clientY - wrapperRect.top}px`;
}

function animate() {
    // We can't clear the main canvas for particles because it's the texture layer.
    // Instead, we use the main loop to draw particles ON TOP of the texture.
    // BUT 'destination-out' is active on the main ctx for carving.
    // SOLUTION: Use a separate overlay for particles or handle state carefully.
    // For simplicity, we'll draw particles on top using 'source-over'.
    
    if (particles.length > 0) {
        // Redraw only if there are particles
        // Actually, for carving we want the texture to persist.
        // We will draw particles and then they'll be "carved" out too if we're not careful.
        // Let's just manage them in a simple way.
        particles.forEach((p, index) => {
            p.update();
            if (p.life <= 0) {
                particles.splice(index, 1);
            } else {
                p.draw(ctx);
            }
        });
    }

    requestAnimationFrame(animate);
}

function startGame() {
    document.getElementById('overlay-instructions').classList.remove('active');
    isGameActive = true;
    currentLevelIndex = 0;
    loadLevel(currentLevelIndex);
}

function loadLevel(index) {
    const level = levels[index];
    document.getElementById('current-level-num').textContent = index + 1;
    document.getElementById('current-statue-name').textContent = level.name;
    canvas.style.backgroundImage = `url('${level.statueImg}')`;
    
    resizeCanvas();
    progress = 0;
    updateProgressBar();
    cursorTool.style.display = 'block';
}

function resizeCanvas() {
    const wrapper = document.getElementById('canvas-wrapper');
    const rect = wrapper.getBoundingClientRect();
    const size = Math.min(rect.width, rect.height) * 0.95;
    if (size <= 0) return;
    canvas.width = size;
    canvas.height = size;
    drawTexture();
}

function drawTexture() {
    const level = levels[currentLevelIndex];
    if (!level) return;
    const img = new Image();
    img.src = level.textureImg;
    img.onload = () => {
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'destination-out';
    };
}

function startCarving(e) {
    if (!isGameActive) return;
    isDrawing = true;
    carve(e);
}

function stopCarving() {
    isDrawing = false;
    calculateProgress();
}

function carve(e) {
    if (!isDrawing) return;
    
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x < 0 || x > canvas.width || y < 0 || y > canvas.height) return;

    const level = levels[currentLevelIndex];
    const radius = level.brushSize;
    
    // Depth Shadow Simulation
    // We draw a slightly larger, semi-transparent black shape with source-over 
    // to create a "burnt/shadowed" edge before cutting the hole.
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    drawJaggedShape(ctx, x, y, radius * 1.1);

    // Jagged Chisel Mark (The actual cut)
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'white'; // Color doesn't matter for destination-out
    drawJaggedShape(ctx, x, y, radius);

    // Particles (Chips)
    if (Math.random() > 0.2) {
        const count = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < count; i++) {
            particles.push(new Fragment(x, y, level.chipColor || '#ccc'));
        }
    }

    // Feedback
    document.getElementById('canvas-wrapper').classList.add('shaking');
    setTimeout(() => {
        document.getElementById('canvas-wrapper').classList.remove('shaking');
    }, 50);

    if (Math.random() > 0.98) calculateProgress();
}

function drawJaggedShape(context, x, y, radius) {
    context.beginPath();
    const sides = 6 + Math.floor(Math.random() * 4);
    for (let i = 0; i < sides; i++) {
        const angle = (i / sides) * Math.PI * 2;
        const r = radius * (0.85 + Math.random() * 0.3);
        const px = x + Math.cos(angle) * r;
        const py = y + Math.sin(angle) * r;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
    }
    context.closePath();
    context.fill();
}

function calculateProgress() {
    if (!ctx) return;
    try {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        let opaquePixels = 0;
        const step = 64; 
        for (let i = 3; i < data.length; i += step) {
            if (data[i] > 10) opaquePixels++;
        }
        const totalSampledPixels = data.length / step;
        progress = Math.min(Math.round(100 - (opaquePixels / totalSampledPixels * 100)), 100);
        updateProgressBar();
        if (progress >= levels[currentLevelIndex].winThreshold) levelComplete();
    } catch(e) {}
}

function updateProgressBar() {
    document.getElementById('progress-fill').style.width = `${progress}%`;
    document.getElementById('progress-text').textContent = `${progress}%`;
}

function levelComplete() {
    isDrawing = false;
    isGameActive = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const level = levels[currentLevelIndex];
    document.getElementById('success-preview').style.backgroundImage = `url('${level.statueImg}')`;
    document.getElementById('overlay-success').classList.add('active');
}

function nextLevel() {
    document.getElementById('overlay-success').classList.remove('active');
    currentLevelIndex++;
    if (currentLevelIndex < levels.length) {
        isGameActive = true;
        loadLevel(currentLevelIndex);
    } else {
        document.getElementById('overlay-win').classList.add('active');
    }
}
