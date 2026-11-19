const fs = require('fs');
const readline = require('readline');

async function processLineByLine() {
  const fileStream = fs.createReadStream('C:\\Users\\praka\\.gemini\\antigravity-ide\\brain\\17f3b7d4-6c03-49cf-96e9-f36857e75ad5\\.system_generated\\logs\\transcript_full.jsonl');

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  let foundHtml = null;

  for await (const line of rl) {
    if (line.includes('SECTION 2: OUR LOVE TIMELINE')) {
       if (line.includes('<!-- ============================================\\n       MAIN APP CONTAINER\\n       ============================================ -->\\n  <main id=\\"main-content\\" class=\\"hidden\\">')) {
           // We might find a full payload!
           try {
             const json = JSON.parse(line);
             if (json.content && json.content.includes('<section id="timeline-screen"')) {
                 foundHtml = json.content;
                 console.log("Found in content!");
             } else if (json.tool_calls) {
                 for (let tc of json.tool_calls) {
                     if (tc.args && tc.args.CodeContent && tc.args.CodeContent.includes('<section id="timeline-screen"')) {
                         foundHtml = tc.args.CodeContent;
                         console.log("Found in CodeContent!");
                     }
                 }
             }
           } catch(e) {}
       }
    }
  }

  if (foundHtml) {
      fs.writeFileSync('restored_html.txt', foundHtml, 'utf8');
      console.log('Restored HTML to restored_html.txt');
  } else {
      console.log('Could not find it.');
  }
}

processLineByLine();
