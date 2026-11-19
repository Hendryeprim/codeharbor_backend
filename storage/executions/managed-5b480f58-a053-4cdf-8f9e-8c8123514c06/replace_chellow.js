const fs = require('fs');

function replaceInFile(filename) {
    let content = fs.readFileSync(filename, 'utf8');
    // case insensitive replacement of chello to chellow
    content = content.replace(/chello/gi, 'chellow');
    
    // Update cache buster in index.html to v=6
    if (filename === 'index.html') {
        content = content.replace(/<script src="script\.js\?v=5"><\/script>/, '<script src="script.js?v=6"></script>');
    }
    
    fs.writeFileSync(filename, content, 'utf8');
}

replaceInFile('index.html');
replaceInFile('script.js');
console.log('Replaced all occurrences of chello with chellow and updated cache buster.');
