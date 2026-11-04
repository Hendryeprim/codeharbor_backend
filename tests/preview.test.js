import test from 'node:test';
import assert from 'node:assert';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { validateAndInspectZip, processProjectZip } from '../src/services/previewService.js';
import prisma from '../src/database/prisma.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempTestDir = path.resolve(__dirname, 'temp_test');

test.before(() => {
  fs.mkdirSync(tempTestDir, { recursive: true });
});

test.after(() => {
  if (fs.existsSync(tempTestDir)) {
    fs.rmSync(tempTestDir, { recursive: true, force: true });
  }
});

test('Preview Engine - Detects static HTML project and prevents path traversal', async (t) => {
  // 1. Create a safe static HTML zip
  const safeZipPath = path.join(tempTestDir, 'safe_html.zip');
  const safeZip = new AdmZip();
  safeZip.addFile('index.html', Buffer.from('<!DOCTYPE html><html><body><h1>CoderHarbor Preview</h1></body></html>', 'utf8'));
  safeZip.addFile('style.css', Buffer.from('body { color: cyan; }', 'utf8'));
  safeZip.writeZip(safeZipPath);

  const inspection = validateAndInspectZip(safeZipPath);
  assert.strictEqual(inspection.isValid, true);
  assert.strictEqual(inspection.type, 'STATIC_HTML');
  assert.strictEqual(inspection.fileCount, 2);

  // 2. Test path traversal detection
  const maliciousZipPath = path.join(tempTestDir, 'traversal.zip');
  const malZip = new AdmZip();
  malZip.addFile('file.txt', Buffer.from('test', 'utf8'));
  malZip.getEntries()[0].entryName = '../../etc/passwd';
  fs.writeFileSync(maliciousZipPath, malZip.toBuffer());

  assert.throws(
    () => {
      validateAndInspectZip(maliciousZipPath);
    },
    /Security violation: Detected illegal path traversal entry/
  );
});

test('Preview Engine - Detects React/Vite and Fullstack projects accurately', async (t) => {
  // 1. React/Vite project
  const viteZipPath = path.join(tempTestDir, 'vite_project.zip');
  const viteZip = new AdmZip();
  const pkgJson = JSON.stringify({
    name: 'test-vite-app',
    dependencies: { react: '^18.2.0' },
    devDependencies: { vite: '^5.0.0' },
    scripts: { build: 'vite build' },
  });
  viteZip.addFile('package.json', Buffer.from(pkgJson, 'utf8'));
  viteZip.addFile('index.html', Buffer.from('<!DOCTYPE html><html><body><div id="root"></div></body></html>', 'utf8'));
  viteZip.writeZip(viteZipPath);

  const viteInspect = validateAndInspectZip(viteZipPath);
  assert.strictEqual(viteInspect.type, 'REACT_VITE');

  // 2. Fullstack project
  const fullstackZipPath = path.join(tempTestDir, 'fullstack_project.zip');
  const fullstackZip = new AdmZip();
  const fullstackPkg = JSON.stringify({
    name: 'test-fullstack-app',
    dependencies: { react: '^18.2.0', express: '^4.19.0', pg: '^8.11.0' },
    scripts: { build: 'vite build' },
  });
  fullstackZip.addFile('package.json', Buffer.from(fullstackPkg, 'utf8'));
  fullstackZip.addFile('server.js', Buffer.from('const express = require("express");', 'utf8'));
  fullstackZip.writeZip(fullstackZipPath);

  const fullstackInspect = validateAndInspectZip(fullstackZipPath);
  assert.strictEqual(fullstackInspect.type, 'FULLSTACK');
});

test('Preview Engine - End-to-end static HTML preview generation & deployment', async (t) => {
  // Find or create test product
  let product = await prisma.product.findFirst({ where: { status: 'PUBLISHED' } });
  assert.ok(product, 'Test requires at least one product in database');

  const staticZipPath = path.join(tempTestDir, 'test_deploy.zip');
  const zip = new AdmZip();
  zip.addFile('index.html', Buffer.from('<!DOCTYPE html><html><head><title>Live Test</title></head><body><h1>Deployed Preview</h1></body></html>', 'utf8'));
  zip.writeZip(staticZipPath);

  const result = await processProjectZip(product.id, staticZipPath, 'test_deploy.zip');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.status, 'READY');
  assert.ok(result.previewUrl.includes(`/previews/${product.id}/`));

  // Verify in database
  const updatedProduct = await prisma.product.findUnique({ where: { id: product.id } });
  assert.strictEqual(updatedProduct.previewStatus, 'READY');
  assert.strictEqual(updatedProduct.previewType, 'STATIC_HTML');
  assert.ok(updatedProduct.previewUrl);
});
