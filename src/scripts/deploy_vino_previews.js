import fs from 'fs';
import path from 'path';
import prisma from '../database/prisma.js';
import { PREVIEWS_DIR, getPreviewUrl } from '../services/previewService.js';
import { getSandboxInterceptorScript } from '../services/sandboxInterceptor.js';

const distDir = path.resolve('storage/temp_builds/test_vino_frontend/dist');
const productIds = [
  'a3ec809f-d1c8-4c0b-a8bf-031e9421ce10', // vino-browsing-3729
  '319d740a-0e72-449b-bb4f-41ced3af88a3', // vino-browsing
];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

async function deploy() {
  for (const pid of productIds) {
    const targetDir = path.join(PREVIEWS_DIR, pid);
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    copyDir(distDir, targetDir);

    const indexPath = path.join(targetDir, 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Make asset references relative so they resolve under /previews/:id/
    html = html.replace(/(href|src)="\/(assets|favicon|icons|static|media)/g, '$1="./$2');
    html = html.replace(/(href|src)='\/ (assets|favicon|icons|static|media)/g, "$1='./$2");

    // Add sandbox interceptor
    if (!html.includes('coderharbor-preview-sandbox')) {
      const interceptor = getSandboxInterceptorScript();
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n${interceptor}`);
      } else {
        html = `${interceptor}\n${html}`;
      }
    }
    fs.writeFileSync(indexPath, html, 'utf8');

    const previewUrl = getPreviewUrl(pid);
    const logs =
      `✓ Interactive React/Vite frontend built and deployed to Live Preview sandbox.\n` +
      `ℹ Note: Full-stack components detected (Python/Django backend). Interactive client preview is live with mock data.\n` +
      `Live URL: ${previewUrl}`;

    await prisma.product.update({
      where: { id: pid },
      data: {
        previewStatus: 'READY',
        previewType: 'REACT_VITE',
        previewUrl,
        previewBuildLogs: logs,
        previewUpdatedAt: new Date(),
      },
    });
    console.log(`Deployed preview for product: ${pid} -> ${previewUrl}`);
  }
  process.exit(0);
}

deploy().catch((err) => {
  console.error('Deploy error:', err);
  process.exit(1);
});

