const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
let js = fs.readFileSync('script.js', 'utf8');

// 1. Replace the gift emojis with lucide icons with proper colors
html = html.replace(
  /<div class="gift-emoji"[^>]*>🎁<\/div>/g, 
  (match, offset) => {
    if (html.lastIndexOf('Gift 1', offset) > html.lastIndexOf('Gift 2', offset)) {
      return `<div class="gift-emoji"><i data-lucide="gift" style="color: #3b82f6; width: 64px; height: 64px; margin: 0 auto; display: block;"></i></div>`;
    } else {
      return `<div class="gift-emoji"><i data-lucide="gift" style="color: #fbc02d; width: 64px; height: 64px; margin: 0 auto; display: block;"></i></div>`;
    }
  }
);

// 2. Replace gift-modal-1 content with audio player
const modal1Content = `
        <button class="close-modal" onclick="closeGiftModal('gift-modal-1')"><i data-lucide="x"></i></button>
        <div class="custom-audio-player">
          <div class="player-left">
            <div class="album-art-wrapper">
              <img src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=200&auto=format&fit=crop" alt="Album Art" class="album-art">
            </div>
            <p class="album-name">Gift 1</p>
          </div>
          <div class="player-right">
            <h3 class="track-title cursive">Para-Para</h3>
            <div class="player-timeline">
              <span class="time current-time" id="curr-time-1">0:00</span>
              <input type="range" id="seek-slider-1" class="styled-slider" value="0" max="100">
              <span class="time total-time" id="tot-time-1">0:00</span>
            </div>
            <div class="player-controls">
              <button class="ctrl-btn"><i data-lucide="skip-back" size="20"></i></button>
              <button class="play-btn" id="play-pause-btn-1" onclick="toggleGiftAudio(1)">
                <div id="icon-play-1"><i data-lucide="play" size="24" fill="currentColor"></i></div>
                <div id="icon-pause-1" class="hidden"><i data-lucide="pause" size="24" fill="currentColor"></i></div>
              </button>
              <button class="ctrl-btn"><i data-lucide="skip-forward" size="20"></i></button>
            </div>
            <div class="player-volume">
              <i data-lucide="volume-2" size="16"></i>
              <input type="range" id="vol-slider-1" class="styled-slider" value="100" max="100">
            </div>
          </div>
        </div>
        <audio id="gift-audio-1" src="Para-Para.mp3" preload="metadata"></audio>
`;

const modal2Content = `
        <button class="close-modal" onclick="closeGiftModal('gift-modal-2')"><i data-lucide="x"></i></button>
        <div class="custom-audio-player">
          <div class="player-left">
            <div class="album-art-wrapper">
              <img src="https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=200&auto=format&fit=crop" alt="Album Art" class="album-art">
            </div>
            <p class="album-name">Gift 2</p>
          </div>
          <div class="player-right">
            <h3 class="track-title cursive">Machaan Machaan</h3>
            <div class="player-timeline">
              <span class="time current-time" id="curr-time-2">0:00</span>
              <input type="range" id="seek-slider-2" class="styled-slider" value="0" max="100">
              <span class="time total-time" id="tot-time-2">0:00</span>
            </div>
            <div class="player-controls">
              <button class="ctrl-btn"><i data-lucide="skip-back" size="20"></i></button>
              <button class="play-btn" id="play-pause-btn-2" onclick="toggleGiftAudio(2)">
                <div id="icon-play-2"><i data-lucide="play" size="24" fill="currentColor"></i></div>
                <div id="icon-pause-2" class="hidden"><i data-lucide="pause" size="24" fill="currentColor"></i></div>
              </button>
              <button class="ctrl-btn"><i data-lucide="skip-forward" size="20"></i></button>
            </div>
            <div class="player-volume">
              <i data-lucide="volume-2" size="16"></i>
              <input type="range" id="vol-slider-2" class="styled-slider" value="100" max="100">
            </div>
          </div>
        </div>
        <audio id="gift-audio-2" src="Machaan Machaan.mp3" preload="metadata"></audio>
`;

html = html.replace(/<div id="gift-modal-1"[^>]*>[\s\S]*?<\/div>\s*<\/div>/, `<div id="gift-modal-1" class="gift-modal">\n      <div class="gift-modal-content glass-card">\n${modal1Content}\n      </div>\n    </div>`);
html = html.replace(/<div id="gift-modal-2"[^>]*>[\s\S]*?<\/div>\s*<\/div>/, `<div id="gift-modal-2" class="gift-modal">\n      <div class="gift-modal-content glass-card">\n${modal2Content}\n      </div>\n    </div>`);

fs.writeFileSync('index.html', html);

// 3. Update script.js logic for audio players
const jsAudioLogicRegex = /\/\* ==========================================\n   CUSTOM AUDIO PLAYER LOGIC[\s\S]*?closeGiftModal\('gift-modal-2'\);\n    \}\);\n  \}\);*\n\}/;

const newJsAudioLogic = `/* ==========================================
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
      return \`\${min}:\${sec < 10 ? '0' : ''}\${sec}\`;
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
setupAudioPlayer(2);`;

js = js.replace(jsAudioLogicRegex, newJsAudioLogic);
fs.writeFileSync('script.js', js);
console.log("Update complete");
