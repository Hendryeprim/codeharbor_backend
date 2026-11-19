/* ==========================================
   INITIALIZE LUCIDE ICONS
   ========================================== */
document.addEventListener("DOMContentLoaded", () => {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
});

/* ==========================================
   STARFIELD MOUSE PARALLAX
   ========================================== */
const layer1 = document.getElementById("star-layer-1");
const layer2 = document.getElementById("star-layer-2");
const layer3 = document.getElementById("star-layer-3");

let targetX = 0, targetY = 0;
let currentX = 0, currentY = 0;

window.addEventListener("mousemove", (e) => {
  const centerX = window.innerWidth / 2;
  const centerY = window.innerHeight / 2;
  targetX = (e.clientX - centerX) / centerX;
  targetY = (e.clientY - centerY) / centerY;
});

function animateStarfield() {
  // Smooth lerp for butter-smooth movement
  currentX += (targetX - currentX) * 0.05;
  currentY += (targetY - currentY) * 0.05;

  if (layer1) layer1.style.transform = `translate(${currentX * 5}px, ${currentY * 5}px)`;
  if (layer2) layer2.style.transform = `translate(${currentX * 12}px, ${currentY * 12}px)`;
  if (layer3) layer3.style.transform = `translate(${currentX * 22}px, ${currentY * 22}px)`;

  requestAnimationFrame(animateStarfield);
}
animateStarfield();
/* ==========================================
   THE KEY TO MY HEART LOGIC
   ========================================== */
window.unlockHeart = function() {
  const container = document.getElementById("lock-container");
  const instruction = document.getElementById("lock-instruction");
  const result = document.getElementById("unlock-result");
  const glow = document.getElementById("lock-glow");
  
  if (!container || container.classList.contains("unlocked")) return;

  // Step 1: Insert Key
  container.classList.add("unlocking");
  instruction.innerHTML = "Unlocking your heart...";
  
  // Step 2: Turn Key
  setTimeout(() => {
    container.classList.add("turning");
  }, 600);

  // Step 3: Unlock and show Heart!
  setTimeout(() => {
    container.classList.add("unlocked");
    glow.style.opacity = "0"; // hide the yellow glow
    
    setTimeout(() => {
      instruction.classList.add("hidden");
      result.classList.remove("hidden");
      
      if (window.confetti) {
        confetti({
          particleCount: 60,
          spread: 70,
          origin: { y: 0.6 },
          colors: ['#ff0055', '#9d4edd', '#ffd700']
        });
      }
    }, 600);
  }, 1200);
};

/* ==========================================
   GIFT MODALS LOGIC
   ========================================== */
window.openGiftModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
    // Trigger confetti on open for extra magic!
    if (window.confetti) {
      confetti({
        particleCount: 40,
        spread: 50,
        origin: { y: 0.6 },
        colors: ['#ff0055', '#9d4edd', '#ffffff']
      });
    }
  }
};

window.closeGiftModal = function(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
    
    // Automatically pause custom audio player when closing Gift 2
    if (modalId === 'gift-modal-2') {
      const giftAudio = document.getElementById("gift-audio");
      const iconPlay = document.getElementById("icon-play");
      const iconPause = document.getElementById("icon-pause");
      if (giftAudio) {
        giftAudio.pause();
        if (iconPlay && iconPause) {
          iconPlay.classList.remove("hidden");
          iconPause.classList.add("hidden");
        }
      }
    }
  }
};

/* ==========================================
   CUSTOM AUDIO PLAYER LOGIC
   ========================================== */
function setupAudioPlayer(id) {
  const giftAudio = document.getElementById("gift-audio-" + id);
  const seekSlider = document.getElementById("seek-slider-" + id);
  const volSlider = document.getElementById("vol-slider-" + id);
  const currTimeDisplay = document.getElementById("curr-time-" + id);
  const totTimeDisplay = document.getElementById("tot-time-" + id);
  const iconPlay = document.getElementById("icon-play-" + id);
  const iconPause = document.getElementById("icon-pause-" + id);

  if (giftAudio) {
    const formatTime = (time) => {
      const min = Math.floor(time / 60);
      const sec = Math.floor(time % 60);
      return `${min}:${sec < 10 ? '0' : ''}${sec}`;
    };

    giftAudio.addEventListener("timeupdate", () => {
      if (!giftAudio.duration) return;
      const progress = (giftAudio.currentTime / giftAudio.duration) * 100;
      if (seekSlider) seekSlider.value = progress;
      if (currTimeDisplay) currTimeDisplay.textContent = formatTime(giftAudio.currentTime);
    });

    giftAudio.addEventListener("loadedmetadata", () => {
      if (totTimeDisplay) totTimeDisplay.textContent = formatTime(giftAudio.duration);
    });

    giftAudio.addEventListener("ended", () => {
      if (iconPlay && iconPause) {
        iconPlay.classList.remove("hidden");
        iconPause.classList.add("hidden");
      }
      closeGiftModal('gift-modal-' + id);
    });
    
    if (seekSlider) {
      seekSlider.addEventListener('input', () => {
        const time = (seekSlider.value / 100) * giftAudio.duration;
        giftAudio.currentTime = time;
      });
    }
    
    if (volSlider) {
      volSlider.addEventListener('input', () => {
        giftAudio.volume = volSlider.value / 100;
      });
    }
  }
}

window.toggleGiftAudio = (id) => {
  const giftAudio = document.getElementById("gift-audio-" + id);
  const iconPlay = document.getElementById("icon-play-" + id);
  const iconPause = document.getElementById("icon-pause-" + id);
  
  if (giftAudio) {
    if (giftAudio.paused) {
      giftAudio.play();
      if (iconPlay) iconPlay.classList.add("hidden");
      if (iconPause) iconPause.classList.remove("hidden");
    } else {
      giftAudio.pause();
      if (iconPlay) iconPlay.classList.remove("hidden");
      if (iconPause) iconPause.classList.add("hidden");
    }
  }
};

setupAudioPlayer(1);
setupAudioPlayer(2);

/* ==========================================
   PARTICLE CANVAS (BUTTERFLIES & HEARTS)
   ========================================== */
const canvas = document.getElementById("particle-canvas");
if (canvas) {
    const ctx = canvas.getContext("2d", { alpha: true });
  let particles = [];
  const particleCount = 40; // Reduced for performance

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  class LoveParticle {
    constructor() {
      this.init();
      this.y = Math.random() * canvas.height;
    }

    init() {
      this.type = Math.random() < 0.5 ? 'butterfly' : 'heart';
      
      if (this.type === 'heart') {
        const hearts = ["💛", "💙"];
        this.emoji = hearts[Math.floor(Math.random() * hearts.length)];
        this.size = Math.random() * 15 + 15;
      } else {
        this.emoji = "🦋";
        this.size = Math.random() * 15 + 20;
      }

      this.x = Math.random() * canvas.width;
      this.y = canvas.height + this.size + Math.random() * 100;
      
      this.speedY = -(Math.random() * 1.0 + 0.5);
      this.speedX = Math.random() * 1 - 0.5;
      this.opacity = Math.random() * 0.5 + 0.3;
      
      this.rotation = Math.random() * Math.PI * 2;
      this.rotationSpeed = (Math.random() - 0.5) * 0.02;
      
      this.flapTime = Math.random() * 100;
      this.flapSpeed = Math.random() * 0.1 + 0.1;
    }

    draw() {
      ctx.save();
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rotation);
      ctx.globalAlpha = this.opacity;

      if (this.type === 'butterfly') {
        const flap = Math.sin(this.flapTime);
        ctx.scale(0.4 + 0.6 * Math.abs(flap), 1);
      }

      ctx.font = `${this.size}px Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.emoji, 0, 0);
      ctx.restore();
    }

    update() {
      this.y += this.speedY;
      this.x += this.speedX + Math.sin(this.flapTime * 0.5) * 0.5;
      this.rotation += this.rotationSpeed;
      this.flapTime += this.flapSpeed;
      
      if (this.y < -50 || this.x < -50 || this.x > canvas.width + 50) {
        this.init();
      }
    }
  }

  for (let i = 0; i < particleCount; i++) {
    particles.push(new LoveParticle());
  }

  let lastTime = 0;
  const fpsInterval = 1000 / 35; // Throttle to 35fps to prevent hanging

  function animateParticles(currentTime) {
    requestAnimationFrame(animateParticles);
    const elapsed = currentTime - lastTime;
    
    if (elapsed > fpsInterval) {
      lastTime = currentTime - (elapsed % fpsInterval);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].draw();
      }
    }
  }
  requestAnimationFrame(animateParticles);
}

/* ==========================================
   MOUSE TRACKING MAGICAL TRAIL (OPTIMIZED)
   ========================================== */
function createMouseTrail(x, y) {
  const trail = document.createElement("div");
  trail.className = "mouse-trail";
  trail.style.left = x + "px";
  trail.style.top = y + "px";

  const icons = ["💖", "✨", "💙", "💕"];
  trail.innerText = icons[Math.floor(Math.random() * icons.length)];
  
  document.body.appendChild(trail);

  // Use requestAnimationFrame for smoother rendering
  requestAnimationFrame(() => {
    trail.style.transform = `translate(${(Math.random() - 0.5) * 60}px, ${(Math.random() - 0.5) * 60 - 60}px) scale(0.2) rotate(${Math.random() * 90 - 45}deg)`;
    trail.style.opacity = "0";
  });

  // Cleanup
  setTimeout(() => {
    trail.remove();
  }, 800);
}

let lastTrailTime = 0;
document.addEventListener("mousemove", (e) => {
  if (Date.now() - lastTrailTime > 80) { // Throttle to 12 creations per sec to save battery
    createMouseTrail(e.pageX, e.pageY);
    lastTrailTime = Date.now();
  }
});
document.addEventListener("touchmove", (e) => {
  if (Date.now() - lastTrailTime > 80 && e.touches.length > 0) {
    createMouseTrail(e.touches[0].pageX, e.touches[0].pageY);
    lastTrailTime = Date.now();
  }
}, { passive: true });

/* ==========================================
   PAGE FLOW & NAVIGATION
   ========================================== */
const welcomeScreen = document.getElementById("welcome-screen");
const envelopeWrapper = document.querySelector(".envelope-wrapper");
const openLetterBtn = document.getElementById("open-letter-btn");
const mainContent = document.getElementById("main-content");
const bottomNav = document.getElementById("bottom-nav");

// All content sections (order matters)
const sections = [
  document.getElementById("timeline-screen"),
  document.getElementById("cards-screen"),
  document.getElementById("promise-screen"),
  document.getElementById("gallery-screen"),
  document.getElementById("proposal-screen"),
  document.getElementById("celebration-screen"),
];

const navItems = document.querySelectorAll(".nav-item");
let currentSectionIndex = 0;
let isTransitioning = false;

// Preserve original nav labels so we can append a symbol when active
navItems.forEach(item => {
  const span = item.querySelector('span');
  if (span) item.dataset.label = span.textContent.trim();
});

// Helper function to enter the main experience
function enterMainExperience() {
  if (welcomeScreen.style.display === "none") return; // already entered

  // Fade out welcome
  welcomeScreen.style.opacity = "0";
  welcomeScreen.style.transition = "opacity 0.6s ease";

  setTimeout(() => {
    welcomeScreen.classList.remove("active-screen");
    welcomeScreen.style.display = "none";

    // Show main content & first section
    mainContent.classList.remove("hidden");
    showSection(0);

    // Show bottom nav (if it exists)
    if (bottomNav) bottomNav.classList.remove("hidden");
  }, 600);
}

// 1. Click Welcome Card - flip it around
const welcomeCardWrapper = document.getElementById("welcome-card-wrapper");
if (welcomeCardWrapper) {
  welcomeCardWrapper.addEventListener("click", function() {
    if (!this.classList.contains("open")) {
      this.classList.add("open");
    }
  });
}

// 2. Open Letter button - enters the experience
if (openLetterBtn) {
  openLetterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    enterMainExperience();
  });
}

// Show a section by index with smooth transition
function showSection(index) {
  if (isTransitioning || index < 0 || index >= sections.length) return;
  if (index === currentSectionIndex && sections[index].classList.contains("active-screen")) return;

  isTransitioning = true;

  // Hide current section
  const current = sections[currentSectionIndex];
  if (current && current.classList.contains("active-screen")) {
    current.style.opacity = "0";
    current.style.transform = "translateY(-20px)";
    current.style.transition = "opacity 0.3s ease, transform 0.3s ease";

    setTimeout(() => {
      current.classList.remove("active-screen");
      current.style.opacity = "";
      current.style.transform = "";
      current.style.transition = "";

      activateSection(index);
    }, 300);
  } else {
    activateSection(index);
  }
}

// Auto-advance helper: advances to the next section after an optional delay
function autoAdvanceNext(delay = 0) {
  const nextIndex = Math.min(currentSectionIndex + 1, sections.length - 1);
  if (nextIndex === currentSectionIndex) return;
  setTimeout(() => {
    showSection(nextIndex);
  }, delay);
}

// Expose for debugging or manual triggers
window.autoAdvanceNext = autoAdvanceNext;

// Silent sequence runner: advance through sections without showing them,
// then reveal the final target section. Useful for skipping intermediate screens.
function runSilentSequenceTo(targetIndex) {
  // Ensure main experience is initialized
  if (welcomeScreen && welcomeScreen.classList.contains('active-screen')) {
    enterMainExperience();
  }

  // Keep content hidden while we move through sections
  if (mainContent) mainContent.classList.add('hidden');

  // Fast-forward indices (no UI updates or reveals)
  for (let i = 0; i <= targetIndex - 1; i++) {
    currentSectionIndex = i;
  }

  // Reveal the final target section
  if (mainContent) mainContent.classList.remove('hidden');
  showSection(targetIndex);
}

// Convenience: advance silently to the proposal screen (index 4)
window.autoSkipToProposalSilent = function() {
  runSilentSequenceTo(4);
};

// Auto-run if URL contains #silent (open http://localhost:8000/#silent)
if (typeof window !== 'undefined' && window.location && window.location.hash === '#silent') {
  // Delay slightly to allow DOM ready handlers to finish
  setTimeout(() => {
    window.autoSkipToProposalSilent();
  }, 200);
}

function activateSection(index) {
  const target = sections[index];
  target.classList.add("active-screen");
  currentSectionIndex = index;

  // Update nav active state
  navItems.forEach((item, i) => {
    const span = item.querySelector('span');
    const base = item.dataset.label || (span ? span.textContent.trim() : '');
    const active = i === index;
    item.classList.toggle("active", active);
    if (span) span.textContent = active ? `${base} »` : base;
  });

  // Re-initialize lucide icons for new section
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  // Trigger reveal animations for items in this section
  setTimeout(() => {
    triggerReveals(target);
  }, 200);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });

  setTimeout(() => {
    isTransitioning = false;
  }, 400);
}

// Trigger reveal animations for items
function triggerReveals(container) {
  const items = container.querySelectorAll(".reveal-item:not(.revealed)");
  items.forEach((item, i) => {
    setTimeout(() => {
      item.classList.add("revealed");
    }, i * 120);
  });
}

// Bottom Nav Click Handler
navItems.forEach((item, index) => {
  item.addEventListener("click", () => {
    showSection(index);
  });
});

/* ==========================================
   LOVE CARD FLIP LOGIC
   ========================================== */
document.querySelectorAll(".love-card").forEach(card => {
  card.addEventListener("click", () => {
    card.classList.toggle("flipped");
  });
});

/* ==========================================
   SCRATCH CARD LOGIC
   ========================================== */
const scratchCanvas = document.getElementById("scratch-canvas");

if (scratchCanvas) {
  const scratchCtx = scratchCanvas.getContext("2d");
  let isScratching = false;
  let scratchPercentage = 0;
  let scratchRevealed = false;

  function initScratchCard() {
    // Set canvas dimensions to match display size
    const rect = scratchCanvas.getBoundingClientRect();
    scratchCanvas.width = rect.width;
    scratchCanvas.height = rect.height;

    // Draw scratch overlay with gradient
    const gradient = scratchCtx.createLinearGradient(0, 0, scratchCanvas.width, scratchCanvas.height);
    gradient.addColorStop(0, "#4a1d8e");
    gradient.addColorStop(0.5, "#6b21a8");
    gradient.addColorStop(1, "#3d1a6e");
    scratchCtx.fillStyle = gradient;
    scratchCtx.fillRect(0, 0, scratchCanvas.width, scratchCanvas.height);

    // Add "Scratch Me!" text
    scratchCtx.fillStyle = "rgba(255, 215, 0, 0.8)";
    scratchCtx.font = "bold 24px 'Pacifico', cursive";
    scratchCtx.textAlign = "center";
    scratchCtx.textBaseline = "middle";
    scratchCtx.fillText("✨ Scratch Me! ✨", scratchCanvas.width / 2, scratchCanvas.height / 2);

    // Small sparkles
    scratchCtx.font = "16px serif";
    scratchCtx.fillText("💙", scratchCanvas.width * 0.2, scratchCanvas.height * 0.3);
    scratchCtx.fillText("💙", scratchCanvas.width * 0.8, scratchCanvas.height * 0.7);
    scratchCtx.fillText("✨", scratchCanvas.width * 0.15, scratchCanvas.height * 0.75);
    scratchCtx.fillText("✨", scratchCanvas.width * 0.85, scratchCanvas.height * 0.25);
  }

  function scratch(x, y) {
    scratchCtx.globalCompositeOperation = "destination-out";
    scratchCtx.beginPath();
    scratchCtx.arc(x, y, 22, 0, Math.PI * 2);
    scratchCtx.fill();

    // Check scratch percentage
    checkScratchProgress();
  }

  function checkScratchProgress() {
    const imageData = scratchCtx.getImageData(0, 0, scratchCanvas.width, scratchCanvas.height);
    let transparent = 0;
    const total = imageData.data.length / 4;

    for (let i = 3; i < imageData.data.length; i += 4) {
      if (imageData.data[i] === 0) transparent++;
    }

    scratchPercentage = (transparent / total) * 100;

    // If > 50% scratched, reveal fully and auto-advance once
    if (scratchPercentage > 50 && !scratchRevealed) {
      scratchRevealed = true;
      scratchCanvas.style.transition = "opacity 0.5s ease";
      scratchCanvas.style.opacity = "0";
      setTimeout(() => {
        scratchCanvas.style.display = "none";
        // Auto-advance removed based on user request.
        // User must click the Next button manually.
      }, 500);
    }
  }

  function getCanvasCoords(e) {
    const rect = scratchCanvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (scratchCanvas.width / rect.width),
      y: (clientY - rect.top) * (scratchCanvas.height / rect.height),
    };
  }

  // Mouse events
  scratchCanvas.addEventListener("mousedown", (e) => {
    isScratching = true;
    const coords = getCanvasCoords(e);
    scratch(coords.x, coords.y);
  });

  scratchCanvas.addEventListener("mousemove", (e) => {
    if (!isScratching) return;
    const coords = getCanvasCoords(e);
    scratch(coords.x, coords.y);
  });

  scratchCanvas.addEventListener("mouseup", () => { isScratching = false; });
  scratchCanvas.addEventListener("mouseleave", () => { isScratching = false; });

  // Touch events
  scratchCanvas.addEventListener("touchstart", (e) => {
    e.preventDefault();
    isScratching = true;
    const coords = getCanvasCoords(e);
    scratch(coords.x, coords.y);
  });

  scratchCanvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!isScratching) return;
    const coords = getCanvasCoords(e);
    scratch(coords.x, coords.y);
  });

  scratchCanvas.addEventListener("touchend", () => { isScratching = false; });

  // Initialize when promise section becomes visible
  const observer = new MutationObserver(() => {
    const promiseScreen = document.getElementById("promise-screen");
    if (promiseScreen && promiseScreen.classList.contains("active-screen")) {
      initScratchCard();
      observer.disconnect();
    }
  });

  observer.observe(document.getElementById("promise-screen"), {
    attributes: true,
    attributeFilter: ["class"],
  });
}

/* ==========================================
   GALLERY LIGHTBOX
   ========================================== */
const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const lightboxClose = document.getElementById("lightbox-close");

document.querySelectorAll(".gallery-item").forEach(item => {
  item.addEventListener("click", () => {
    const img = item.querySelector("img");
    if (img && lightbox && lightboxImg) {
      lightboxImg.src = img.src;
      lightboxImg.alt = img.alt;
      lightbox.classList.remove("hidden");
    }
  });
});

if (lightboxClose) {
  lightboxClose.addEventListener("click", () => {
    lightbox.classList.add("hidden");
  });
}

if (lightbox) {
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      lightbox.classList.add("hidden");
    }
  });
}

/* ==========================================
   RUNAWAY NO BUTTON LOGIC
   ========================================== */
const noBtn = document.getElementById("no-btn");
const yesBtn = document.getElementById("yes-btn");
let yesScale = 1.0;

const beggingMessages = [
  "No 😢",
  "Are you sure? 💔",
  "Think again... 🥺",
  "Don't do this! 😭",
  "Give me a chance? 🌸",
  "Click the purple one! 👉👈",
  "Error: Invalid choice! 😉",
  "Wrong button! 💙",
  "Pleaasseee? 🌹",
  "Still no? 😭",
  "I'll cry! 🥹",
  "My heart can't take this 💔"
];
let messageIndex = 0;

function moveNoButton() {
  const proposalScreen = document.getElementById("proposal-screen");
  const btnWidth = noBtn.offsetWidth;
  const btnHeight = noBtn.offsetHeight;
  const cardRect = proposalScreen.getBoundingClientRect();
  const padding = 25;

  const minX = cardRect.left + padding;
  const maxX = cardRect.left + cardRect.width - btnWidth - padding;
  const minY = cardRect.top + padding;
  const maxY = cardRect.top + cardRect.height - btnHeight - padding;

  let newX = maxX > minX ? Math.floor(Math.random() * (maxX - minX) + minX) : cardRect.left + (cardRect.width - btnWidth) / 2;
  let newY = maxY > minY ? Math.floor(Math.random() * (maxY - minY) + minY) : cardRect.top + (cardRect.height - btnHeight) / 2;

  noBtn.style.position = "fixed";
  noBtn.style.left = `${newX}px`;
  noBtn.style.top = `${newY}px`;
  noBtn.style.zIndex = "100";
  noBtn.style.transition = "left 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), top 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)";

  messageIndex = (messageIndex + 1) % beggingMessages.length;
  noBtn.innerText = beggingMessages[messageIndex];

  yesScale += 0.1;
  if (yesBtn) {
    yesBtn.style.transform = `scale(${Math.min(yesScale, 1.8)})`;
    yesBtn.style.transition = "transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)";
  }
}

noBtn.addEventListener("mouseenter", moveNoButton);
noBtn.addEventListener("touchstart", (e) => { e.preventDefault(); moveNoButton(); });
noBtn.addEventListener("click", (e) => { e.preventDefault(); moveNoButton(); });

/* ==========================================
   CELEBRATION LOGIC (YES CLICK)
   ========================================== */
const celebrationImg = document.getElementById("celebration-img");
const imageSpinner = document.getElementById("image-spinner");

yesBtn.addEventListener("click", () => {
  // Hide proposal, show celebration
  const proposalScreen = document.getElementById("proposal-screen");
  const celebrationScreen = document.getElementById("celebration-screen");

  proposalScreen.classList.remove("active-screen");
  celebrationScreen.classList.add("active-screen");

  // Hide bottom nav during celebration
  if (bottomNav) bottomNav.classList.add("hidden");

  // Load celebration image
  if (celebrationImg) {
    celebrationImg.onload = () => {
      if (imageSpinner) imageSpinner.classList.add("hidden");
      celebrationImg.classList.remove("hidden-img");
      celebrationImg.style.display = "block";
    };
    celebrationImg.src = "celebration_love.jpg";
  }

  // Fire confetti storm
  triggerConfettiStorm();

  // Typewriter effect
  const celebrationText = "Thank you for choosing me. I promise to hold your hand through every storm, laugh at all your goofy jokes, and love you more and more with each passing day. You are my home, my peace, and my greatest adventure. I can't wait to write the rest of our chapters together!";
  let textIndex = 0;
  const typedTextEl = document.getElementById("celebration-text-typed");
  const signOffEl = document.getElementById("celebration-sign-off");

  if (typedTextEl) {
    typedTextEl.innerHTML = "";
    if (signOffEl) signOffEl.style.opacity = "0";

    function typeWriter() {
      if (textIndex < celebrationText.length) {
        typedTextEl.innerHTML += celebrationText.charAt(textIndex);
        textIndex++;
        setTimeout(typeWriter, 30);
      } else {
        if (signOffEl) signOffEl.style.opacity = "1";
        // Show Instagram button with animation
        const igBtn = document.getElementById("instagram-btn");
        if (igBtn) {
          igBtn.style.animation = "fadeInUp 0.8s ease-out forwards";
        }
      }
    }

    setTimeout(typeWriter, 800);
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function triggerConfettiStorm() {
  if (typeof confetti === "undefined") return;

  const duration = 6000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 80, zIndex: 1500 };

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) return clearInterval(interval);

    const particleCount = 40 * (timeLeft / duration);

    confetti(Object.assign({}, defaults, {
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
      colors: ["#3b82f6", "#93c5fd", "#ffd700", "#facc15", "#ffffff"],
    }));
    confetti(Object.assign({}, defaults, {
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
      colors: ["#3b82f6", "#93c5fd", "#ffd700", "#facc15", "#ffffff"],
    }));
  }, 250);
}

/* ==========================================
   INSTAGRAM CLIPBOARD LOGIC
   ========================================== */
window.copyLoveMessage = function() {
  const message = "i love you 💙";
  
  if (navigator.clipboard && window.isSecureContext) {
    // navigator.clipboard requires a secure context (https or localhost)
    navigator.clipboard.writeText(message).catch(err => {
      console.log('Clipboard write failed:', err);
    });
  } else {
    // Fallback for older browsers or non-secure contexts
    let textArea = document.createElement("textarea");
    textArea.value = message;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Fallback clipboard copy failed', err);
    }
    textArea.remove();
  }
};

/* ==========================================
   chellow ENVELOPE LOGIC
   ========================================== */
let chellowEnvelopeOpened = false;

window.openchellowEnvelope = function() {
  if (chellowEnvelopeOpened) return;
  chellowEnvelopeOpened = true;

  const wrapper = document.getElementById("chellow-envelope-wrapper");
  const hint = document.getElementById("envelope-click-hint");
  const bodyEl = document.getElementById("typed-chellow-body");
  const signOff = document.getElementById("chellow-sign-off");

  if (wrapper) wrapper.classList.add("open");
  if (hint) hint.style.opacity = "0";

  const letterText = "From the very moment you entered my life, everything changed for the better. Your beautiful smile brightens my darkest days, and your love gives me a strength I never even knew I had.|You are my dream come true, my very best friend, and my soulmate. I cherish every single second we spend together. You make me want to be the best version of myself, and I can't imagine a future without you by my side.|I promise to love you unconditionally, to hold you close when you need comfort, and to celebrate with you in all of your successes—today, tomorrow, and forever.";
  
  let i = 0;
  
  // Wait 1.5s for envelope animation to finish, then start typing
  setTimeout(() => {
    function typeLetter() {
      if (i < letterText.length) {
        if (letterText.charAt(i) === '|') {
          bodyEl.innerHTML += "<br><br>";
        } else {
          bodyEl.innerHTML += letterText.charAt(i);
        }
        i++;
        setTimeout(typeLetter, 35);
      } else {
        bodyEl.classList.remove("typing-cursor");
        if (signOff) signOff.style.opacity = "1";
      }
    }
    typeLetter();
  }, 1500);
};
