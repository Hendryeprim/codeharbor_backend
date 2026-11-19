const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');

// Replace Reena with chello BUT NOT inside function calls or IDs
// A safer way is to specifically target the exact text
html = html.replace(/My Dearest Reena/g, 'My Dearest chello');
html = html.replace(/My beautiful Reena/g, 'My beautiful chello');
html = html.replace(/typed-reena-body/g, 'typed-reena-body'); // keep original ID
html = html.replace(/openReenaEnvelope/g, 'openReenaEnvelope'); // keep original function

// Replace 💜 with 💙
html = html.replace(/💜/g, '💙');

// Replace script.js with script.js?v=4
html = html.replace(/<script src="script\.js[^"]*"><\/script>/, '<script src="script.js?v=4"></script>');

// Replace style.css with style.css?v=3
html = html.replace(/<link rel="stylesheet" href="style\.css[^"]*">/, '<link rel="stylesheet" href="style.css?v=3">');

fs.writeFileSync('index.html', html, 'utf8');
console.log('Successfully updated index.html safely with chello, blue heart, and cache busters.');
