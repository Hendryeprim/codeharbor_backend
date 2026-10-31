import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = 'http://localhost:5050/api';

test('CoderHarbor API - Health check returns healthy and Coming Soon status', async () => {
  const res = await fetch(`${BASE_URL}/health`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'healthy');
  assert.equal(data.purchasingStatus, 'Coming Soon');
});

test('CoderHarbor API - Public products endpoint returns list with technologies', async () => {
  const res = await fetch(`${BASE_URL}/products`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(Array.isArray(data.products));
  assert.ok(data.products.length > 0);
  // Verify privateStorageKey is not leaked
  const first = data.products[0];
  assert.equal(first.privateStorageKey, undefined);
});

test('CoderHarbor API - Customer and Admin Login', async () => {
  // Admin login
  const adminRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@coderharbor.com', password: 'Admin@12345' }),
  });
  assert.equal(adminRes.status, 200);
  const adminData = await adminRes.json();
  assert.equal(adminData.user.role, 'ADMIN');
  assert.ok(adminData.token);

  // Customer login
  const custRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alex@example.com', password: 'Customer@12345' }),
  });
  assert.equal(custRes.status, 200);
  const custData = await custRes.json();
  assert.equal(custData.user.role, 'CUSTOMER');
  assert.ok(custData.token);
});

test('CoderHarbor API - Security: Customer cannot access admin dashboard', async () => {
  // Log in as customer
  const custRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'alex@example.com', password: 'Customer@12345' }),
  });
  const custData = await custRes.json();

  const adminRouteRes = await fetch(`${BASE_URL}/admin/dashboard`, {
    headers: { Authorization: `Bearer ${custData.token}` },
  });
  assert.equal(adminRouteRes.status, 403);
});

test('CoderHarbor API - AI Copilot: Match project and blueprint generation', async () => {
  // AI Matcher
  const matchRes = await fetch(`${BASE_URL}/ai/match-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'I need an enterprise billing and invoicing platform with PDF invoices' }),
  });
  assert.equal(matchRes.status, 200);
  const matchData = await matchRes.json();
  assert.equal(matchData.success, true);
  assert.ok(matchData.aiInsight);
  assert.ok(Array.isArray(matchData.matches));

  // AI Blueprint
  const bpRes = await fetch(`${BASE_URL}/ai/generate-blueprint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idea: 'Multi-tenant ERP with role based auth' }),
  });
  assert.equal(bpRes.status, 200);
  const bpData = await bpRes.json();
  assert.equal(bpData.success, true);
  assert.ok(bpData.blueprint.architectureStyle);
  assert.ok(Array.isArray(bpData.blueprint.layers));
});
