import express from 'express';

const router = express.Router();

// Mock CSRF Token
const handleCsrf = (req, res) => {
  res.status(200).json({
    csrfToken: 'coderharbor-preview-sandbox-csrf-token',
    success: true,
  });
};
router.get('/csrf', handleCsrf);
router.get('/csrf/', handleCsrf);

// Mock Register
const handleRegister = (req, res) => {
  const { username = 'DemoUser', email = 'user@example.com' } = req.body || {};
  res.status(200).json({
    success: true,
    message: 'Account created successfully in preview sandbox. Sign in to continue.',
    user: { username, email, role: 'member', is_admin: false },
  });
};
router.post('/register', handleRegister);
router.post('/register/', handleRegister);

// Mock Login
const handleLogin = (req, res) => {
  const { username = 'DemoUser', email = 'user@example.com' } = req.body || {};
  res.status(200).json({
    success: true,
    token: 'preview-sandbox-auth-token',
    user: { username, email, role: 'member', is_admin: false },
    dashboard_url: req.headers.referer || '#overview',
  });
};
router.post('/login', handleLogin);
router.post('/login/', handleLogin);

// Mock Current User
const handleMe = (req, res) => {
  res.status(200).json({
    username: 'DemoUser',
    email: 'user@example.com',
    role: 'member',
    is_admin: false,
  });
};
router.get('/me', handleMe);
router.get('/me/', handleMe);

// Mock Logout
const handleLogout = (req, res) => {
  res.status(200).json({ success: true, message: 'Logged out of sandbox.' });
};
router.post('/logout', handleLogout);
router.post('/logout/', handleLogout);

// Mock Analytics
router.get('/analytics/overview', (req, res) => {
  res.status(200).json({
    total_reports: 3,
    awaiting_review: 1,
    reviewed: 2,
    most_reported_category: 'Dermatological',
    status_distribution: [
      { name: 'Reviewed', count: 2 },
      { name: 'Awaiting review', count: 1 },
    ],
  });
});
router.get('/analytics/overview/', (req, res) => {
  res.status(200).json({
    total_reports: 3,
    awaiting_review: 1,
    reviewed: 2,
    most_reported_category: 'Dermatological',
    status_distribution: [
      { name: 'Reviewed', count: 2 },
      { name: 'Awaiting review', count: 1 },
    ],
  });
});

router.get(['/analytics/monthly', '/analytics/monthly/'], (req, res) => {
  res.status(200).json({
    results: [
      { name: 'May', count: 4 },
      { name: 'Jun', count: 7 },
      { name: 'Jul', count: 12 },
      { name: 'Aug', count: 9 },
      { name: 'Sep', count: 15 },
      { name: 'Oct', count: 18 },
    ],
  });
});

router.get(['/analytics/symptoms', '/analytics/symptoms/'], (req, res) => {
  res.status(200).json({
    results: [
      { name: 'Dermatological', count: 14 },
      { name: 'Gastrointestinal', count: 9 },
      { name: 'Neurological', count: 6 },
      { name: 'Respiratory', count: 4 },
    ],
  });
});

router.get(['/analytics/medicines', '/analytics/medicines/'], (req, res) => {
  res.status(200).json({
    results: [
      { name: 'Amoxicillin', count: 12 },
      { name: 'Paracetamol', count: 8 },
      { name: 'Cetirizine', count: 6 },
      { name: 'Ibuprofen', count: 4 },
    ],
  });
});

router.get(['/medicines', '/medicines/'], (req, res) => {
  res.status(200).json({
    results: [
      { name: 'Amoxicillin 500mg' },
      { name: 'Paracetamol 650mg' },
      { name: 'Cetirizine 10mg' },
      { name: 'Ibuprofen 400mg' },
      { name: 'Metformin 500mg' },
      { name: 'Atorvastatin 20mg' },
    ],
  });
});

const demoReports = [
  {
    id: 'rpt_101',
    medicine: 'Amoxicillin 500mg',
    report_date: '2026-10-25',
    symptoms: 'Mild skin rash, redness',
    symptom_category: 'Dermatological',
    category_confidence: 0.94,
    category_source: 'AI suggestion',
    status: 'reviewed',
    created_at: new Date('2026-10-25').toISOString(),
    description: 'Developed mild red rash after 3 days of dosage.',
  },
  {
    id: 'rpt_102',
    medicine: 'Paracetamol 650mg',
    report_date: '2026-10-28',
    symptoms: 'Nausea and slight dizziness',
    symptom_category: 'Gastrointestinal',
    category_confidence: 0.88,
    category_source: 'AI suggestion',
    status: 'pending',
    created_at: new Date('2026-10-28').toISOString(),
    description: 'Nausea after taking on empty stomach.',
  },
];

router.get(['/reports', '/reports/'], (req, res) => {
  res.status(200).json({
    results: demoReports,
    count: demoReports.length,
    reports: demoReports,
  });
});

router.post(['/reports', '/reports/'], (req, res) => {
  const newReport = {
    id: 'rpt_' + Math.random().toString(36).substring(2, 9),
    medicine: req.body?.medicine || req.body?.medicine_name || 'Generic Medicine',
    report_date: req.body?.report_date || new Date().toISOString().split('T')[0],
    symptoms: req.body?.symptoms || 'Reported symptoms',
    symptom_category: 'Dermatological',
    category_confidence: 0.94,
    category_source: 'AI suggestion',
    status: 'pending',
    created_at: new Date().toISOString(),
    description: req.body?.description || '',
  };
  res.status(201).json({ success: true, report: newReport });
});

router.post(['/ai/classify', '/ai/classify/'], (req, res) => {
  res.status(200).json({
    predicted_category: 'Dermatological',
    confidence: 0.94,
    disclaimer: 'AI classification model preview running in demo sandbox mode.',
  });
});

export default router;

