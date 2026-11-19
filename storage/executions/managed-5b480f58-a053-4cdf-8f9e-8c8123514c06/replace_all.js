const fs = require('fs');

function replaceInFile(filename) {
    let content = fs.readFileSync(filename, 'utf8');
    // case insensitive replacement of reena to chello
    content = content.replace(/reena/gi, 'chello');
    
    // Update cache buster in index.html
    if (filename === 'index.html') {
        content = content.replace(/<script src="script\.js\?v=4"><\/script>/, '<script src="script.js?v=5"></script>');
    }
    
    fs.writeFileSync(filename, content, 'utf8');
}

replaceInFile('index.html');
replaceInFile('script.js');
console.log('Replaced all occurrences of reena with chello and updated cache buster.');
