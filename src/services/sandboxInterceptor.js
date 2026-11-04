/**
 * Generates an isolated in-browser client-side mock interceptor for Full-stack
 * and API-dependent web previews. This allows customers to test features
 * like Registration, Login, Dashboard Analytics, and Forms directly
 * in the live preview iframe without requiring an external database server.
 */
export const getSandboxInterceptorScript = () => {
  return `<script id="coderharbor-preview-sandbox">
(function() {
  const origFetch = window.fetch;
  const storage = window.localStorage;

  // Initialize demo data for preview
  if (!storage.getItem('coderharbor_demo_reports')) {
    storage.setItem('coderharbor_demo_reports', JSON.stringify([
      { id: 'rpt_101', medicine: 'Amoxicillin 500mg', report_date: '2026-10-25', symptoms: 'Mild skin rash, redness', symptom_category: 'Dermatological', category_confidence: 0.94, category_source: 'AI suggestion', status: 'reviewed', created_at: new Date('2026-10-25').toISOString(), description: 'Developed mild red rash after 3 days of dosage.' },
      { id: 'rpt_102', medicine: 'Paracetamol 650mg', report_date: '2026-10-28', symptoms: 'Nausea and slight dizziness', symptom_category: 'Gastrointestinal', category_confidence: 0.88, category_source: 'AI suggestion', status: 'pending', created_at: new Date('2026-10-28').toISOString(), description: 'Nausea after taking on empty stomach.' },
      { id: 'rpt_103', medicine: 'Cetirizine 10mg', report_date: '2026-11-01', symptoms: 'Excessive drowsiness', symptom_category: 'Neurological', category_confidence: 0.98, category_source: 'Human reviewed', status: 'reviewed', created_at: new Date('2026-11-01').toISOString(), description: 'Patient felt extreme sleepiness within 1 hour.' }
    ]));
  }

  window.fetch = async function(url, options = {}) {
    const urlStr = String(url);
    const method = (options.method || 'GET').toUpperCase();

    // 1. CSRF Token
    if (urlStr.includes('/api/csrf')) {
      return new Response(JSON.stringify({ csrfToken: 'preview-sandbox-csrf-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. Register
    if (urlStr.includes('/api/register')) {
      let body = {};
      try { body = options.body ? JSON.parse(options.body) : {}; } catch (e) {}
      const user = { username: body.username || 'DemoUser', email: body.email || 'user@example.com', is_admin: false, role: 'member' };
      storage.setItem('coderharbor_preview_user', JSON.stringify(user));
      return new Response(JSON.stringify({ success: true, message: 'Account created successfully. Sign in to continue.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. Login
    if (urlStr.includes('/api/login')) {
      let body = {};
      try { body = options.body ? JSON.parse(options.body) : {}; } catch (e) {}
      const username = body.username || 'DemoUser';
      const user = { username, email: body.email || 'user@example.com', is_admin: false, role: 'member' };
      storage.setItem('coderharbor_preview_user', JSON.stringify(user));

      setTimeout(() => {
        const landing = document.getElementById('landing');
        const dashboard = document.getElementById('dashboard');
        const authModal = document.getElementById('auth-modal');
        if (landing) landing.style.display = 'none';
        if (dashboard) dashboard.classList.add('active');
        if (authModal) authModal.classList.remove('open');
        const userAvatar = document.getElementById('user-avatar');
        const topUser = document.getElementById('top-username');
        if (userAvatar) userAvatar.textContent = username.slice(0, 1).toUpperCase();
        if (topUser) topUser.textContent = username;
      }, 50);

      return new Response(JSON.stringify({
        success: true,
        user,
        dashboard_url: window.location.pathname + '#overview'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. Me / Current User
    if (urlStr.includes('/api/me')) {
      const user = JSON.parse(storage.getItem('coderharbor_preview_user') || '{"username":"DemoUser","email":"user@example.com","is_admin":false,"role":"member"}');
      return new Response(JSON.stringify(user), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5. Analytics Overview
    if (urlStr.includes('/api/analytics/overview')) {
      const reports = JSON.parse(storage.getItem('coderharbor_demo_reports') || '[]');
      return new Response(JSON.stringify({
        total_reports: reports.length,
        awaiting_review: reports.filter(r => r.status === 'pending').length,
        reviewed: reports.filter(r => r.status === 'reviewed').length,
        most_reported_category: 'Dermatological',
        status_distribution: [
          { name: 'Reviewed', count: reports.filter(r => r.status === 'reviewed').length },
          { name: 'Awaiting review', count: reports.filter(r => r.status === 'pending').length }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 6. Analytics Monthly
    if (urlStr.includes('/api/analytics/monthly')) {
      return new Response(JSON.stringify({
        results: [
          { name: 'May', count: 4 },
          { name: 'Jun', count: 7 },
          { name: 'Jul', count: 12 },
          { name: 'Aug', count: 9 },
          { name: 'Sep', count: 15 },
          { name: 'Oct', count: 18 }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 7. Analytics Symptoms
    if (urlStr.includes('/api/analytics/symptoms')) {
      return new Response(JSON.stringify({
        results: [
          { name: 'Dermatological', count: 14 },
          { name: 'Gastrointestinal', count: 9 },
          { name: 'Neurological', count: 6 },
          { name: 'Respiratory', count: 4 }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 8. Analytics Medicines
    if (urlStr.includes('/api/analytics/medicines')) {
      return new Response(JSON.stringify({
        results: [
          { name: 'Amoxicillin', count: 12 },
          { name: 'Paracetamol', count: 8 },
          { name: 'Cetirizine', count: 6 },
          { name: 'Ibuprofen', count: 4 }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 9. Medicines List
    if (urlStr.includes('/api/medicines')) {
      return new Response(JSON.stringify({
        results: [
          { name: 'Amoxicillin 500mg' },
          { name: 'Paracetamol 650mg' },
          { name: 'Cetirizine 10mg' },
          { name: 'Ibuprofen 400mg' },
          { name: 'Metformin 500mg' },
          { name: 'Atorvastatin 20mg' }
        ]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 10. Reports List / Detail / Submit
    if (urlStr.includes('/api/reports')) {
      const reports = JSON.parse(storage.getItem('coderharbor_demo_reports') || '[]');
      const detailMatch = urlStr.match(/\\/api\\/reports\\/([^\\/\\?]+)/);
      if (detailMatch && !urlStr.includes('/export') && !urlStr.includes('review')) {
        const rId = detailMatch[1];
        const found = reports.find(r => r.id === rId) || reports[0];
        return new Response(JSON.stringify({ report: found }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (method === 'POST') {
        let body = {};
        try { body = options.body ? JSON.parse(options.body) : {}; } catch (e) {}
        const newReport = {
          id: 'rpt_' + Math.random().toString(36).substring(2, 9),
          medicine: body.medicine_name || 'Generic Medicine',
          report_date: body.report_date || new Date().toISOString().split('T')[0],
          symptoms: body.symptoms || 'Reported symptoms',
          symptom_category: 'AI Auto-Triaged',
          category_confidence: 0.93,
          category_source: 'AI suggestion',
          status: 'pending',
          created_at: new Date().toISOString(),
          description: body.description || ''
        };
        reports.unshift(newReport);
        storage.setItem('coderharbor_demo_reports', JSON.stringify(reports));
        return new Response(JSON.stringify({ success: true, report: newReport }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({
        results: reports,
        pages: 1,
        page: 1,
        count: reports.length
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 11. AI Classification
    if (urlStr.includes('/api/ai/classify')) {
      return new Response(JSON.stringify({
        predicted_category: 'Dermatological Reaction',
        confidence: 0.94,
        disclaimer: 'AI model suggests mild cutaneous adverse event. Verified against simulated pharma safety ontology.'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 12. Logout
    if (urlStr.includes('/api/logout')) {
      storage.removeItem('coderharbor_preview_user');
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return origFetch.apply(this, arguments);
  };
})();
</script>`;
};

