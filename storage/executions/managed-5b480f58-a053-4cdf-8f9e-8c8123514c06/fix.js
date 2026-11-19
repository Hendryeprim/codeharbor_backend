const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// The content between </section> and gift-boxes-grid is: "</section>\n\r\n      <div class=\"gift-boxes-grid\">"
// Use a regex to be safe with line endings

const regex = /(<\/section>\s*)\n(\r?\n\s*<div class="gift-boxes-grid">)/;

const replacement = `$1

  <!-- ============================================
       MAIN APP CONTAINER
       ============================================ -->
  <main id="main-content" class="hidden">

    <!-- ==========================================
         SECTION 2: OUR LOVE TIMELINE
         ========================================== -->
    <section id="timeline-screen" class="screen content-section">
      <div class="section-header">
        <h2 class="section-title cursive">Our Journey</h2>
        <p class="section-subtitle">Every moment with you is magic...</p>
      </div>

      <div class="timeline">
        <div class="timeline-line"></div>
        <div class="timeline-item left">
          <div class="timeline-dot"></div>
          <div class="timeline-content glass-panel">
            <h3 class="cursive">First Met</h3>
            <p>The day my world changed forever.</p>
          </div>
        </div>
        <div class="timeline-item right">
          <div class="timeline-dot"></div>
          <div class="timeline-content glass-panel">
            <h3 class="cursive">First Date</h3>
            <p>Butterflies, laughs, and a spark.</p>
          </div>
        </div>
        <div class="timeline-item left">
          <div class="timeline-dot"></div>
          <div class="timeline-content glass-panel">
            <h3 class="cursive">Today</h3>
            <p>More in love with you than ever.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ==========================================
         SECTION 3: SPECIAL GIFTS (Replaces Cards)
         ========================================== -->
    <section id="cards-screen" class="screen content-section">
      <div class="section-header">
        <h2 class="section-title cursive">Special Gifts for You</h2>
        <p class="section-subtitle">Two small gifts, straight from my heart...</p>
      </div>

$2`;

if (regex.test(html)) {
  html = html.replace(regex, replacement);
  fs.writeFileSync('index.html', html, 'utf8');
  console.log('SUCCESS: Restored <main>, timeline, and cards header!');
} else {
  console.log('Regex did not match. Trying direct string approach...');
  
  // Find the last </section> before gift-boxes-grid
  const giftIdx = html.indexOf('gift-boxes-grid');
  const sectionEnd = html.lastIndexOf('</section>', giftIdx);
  
  if (sectionEnd !== -1 && giftIdx !== -1) {
    const endOfSectionTag = sectionEnd + '</section>'.length;
    const beforeGift = html.lastIndexOf('<div', giftIdx);
    
    const insertBlock = `
  </section>

  <!-- ============================================
       MAIN APP CONTAINER
       ============================================ -->
  <main id="main-content" class="hidden">

    <!-- ==========================================
         SECTION 2: OUR LOVE TIMELINE
         ========================================== -->
    <section id="timeline-screen" class="screen content-section">
      <div class="section-header">
        <h2 class="section-title cursive">Our Journey</h2>
        <p class="section-subtitle">Every moment with you is magic...</p>
      </div>

      <div class="timeline">
        <div class="timeline-line"></div>
        <div class="timeline-item left">
          <div class="timeline-dot"></div>
          <div class="timeline-content glass-panel">
            <h3 class="cursive">First Met</h3>
            <p>The day my world changed forever.</p>
          </div>
        </div>
        <div class="timeline-item right">
          <div class="timeline-dot"></div>
          <div class="timeline-content glass-panel">
            <h3 class="cursive">First Date</h3>
            <p>Butterflies, laughs, and a spark.</p>
          </div>
        </div>
        <div class="timeline-item left">
          <div class="timeline-dot"></div>
          <div class="timeline-content glass-panel">
            <h3 class="cursive">Today</h3>
            <p>More in love with you than ever.</p>
          </div>
        </div>
      </div>
    </section>

    <!-- ==========================================
         SECTION 3: SPECIAL GIFTS (Replaces Cards)
         ========================================== -->
    <section id="cards-screen" class="screen content-section">
      <div class="section-header">
        <h2 class="section-title cursive">Special Gifts for You</h2>
        <p class="section-subtitle">Two small gifts, straight from my heart...</p>
      </div>

      `;
    
    html = html.substring(0, sectionEnd) + insertBlock + html.substring(beforeGift);
    fs.writeFileSync('index.html', html, 'utf8');
    console.log('SUCCESS (fallback): Restored everything!');
  } else {
    console.log('COMPLETE FAILURE. sectionEnd:', sectionEnd, 'giftIdx:', giftIdx);
  }
}
