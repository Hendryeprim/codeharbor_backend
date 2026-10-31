import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding CoderHarbor database...');

  // Ensure storage directories
  const privateDir = path.resolve(__dirname, '../storage/private/projects');
  const uploadDir = path.resolve(__dirname, '../storage/uploads/images');
  fs.mkdirSync(privateDir, { recursive: true });
  fs.mkdirSync(uploadDir, { recursive: true });

  // Create sample downloadable ZIP file
  const sampleZipPath = path.join(privateDir, 'pkg_coderharbor_starter_kit_demo.zip');
  if (!fs.existsSync(sampleZipPath)) {
    fs.writeFileSync(sampleZipPath, 'CoderHarbor Project Archive - Sample Source Code Package\nVersion 1.0.0\nThank you for downloading this open-source project from CoderHarbor!');
  }

  // 1. Seed Users
  const adminPassword = await bcrypt.hash('Admin@12345', 10);
  const customerPassword = await bcrypt.hash('Customer@12345', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@coderharbor.com' },
    update: {},
    create: {
      name: 'CoderHarbor Admin',
      email: 'admin@coderharbor.com',
      passwordHash: adminPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
      company: 'CoderHarbor Inc.',
    },
  });

  const customer = await prisma.user.upsert({
    where: { email: 'alex@example.com' },
    update: {},
    create: {
      name: 'Alex Morgan',
      email: 'alex@example.com',
      passwordHash: customerPassword,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      phone: '+1 (555) 234-5678',
      company: 'Apex Digital Labs',
    },
  });

  console.log(`Users seeded: Admin (${admin.email}), Customer (${customer.email})`);

  // 2. Seed Categories
  const categoriesData = [
    { name: 'Web Applications', slug: 'web-applications', description: 'Full-stack cloud ready SaaS platforms and production web suites' },
    { name: 'E-commerce', slug: 'e-commerce', description: 'Modern digital storefronts, multi-vendor marketplaces, and catalog engines' },
    { name: 'Business Management', slug: 'business-management', description: 'Operational automation, team collaboration, and workflow suites' },
    { name: 'ERP and CRM', slug: 'erp-and-crm', description: 'Enterprise resource planning and customer relationship management systems' },
    { name: 'Billing Software', slug: 'billing-software', description: 'Invoicing, recurring subscriptions, tax computation, and POS backends' },
    { name: 'Education and LMS', slug: 'education-and-lms', description: 'Learning management portals, video courses, and student tracking hubs' },
    { name: 'Job Portals', slug: 'job-portals', description: 'Talent recruitment, resume parsers, and candidate evaluation portals' },
    { name: 'Mobile Applications', slug: 'mobile-applications', description: 'Cross-platform React Native and Flutter native app templates' },
    { name: 'Portfolio Websites', slug: 'portfolio-websites', description: 'Stunning showcase templates for software engineers and digital studios' },
    { name: 'Developer Templates', slug: 'developer-templates', description: 'Modular starter kits, boilerplate architectures, and API frameworks' },
  ];

  const categories = {};
  for (const cat of categoriesData) {
    categories[cat.slug] = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    });
  }
  console.log(`Seeded ${categoriesData.length} categories.`);

  // 3. Seed Technologies
  const techData = [
    { name: 'React', slug: 'react' },
    { name: 'Node.js', slug: 'nodejs' },
    { name: 'Express.js', slug: 'express' },
    { name: 'PostgreSQL', slug: 'postgresql' },
    { name: 'Next.js', slug: 'nextjs' },
    { name: 'Tailwind CSS', slug: 'tailwind-css' },
    { name: 'TypeScript', slug: 'typescript' },
    { name: 'Docker', slug: 'docker' },
    { name: 'Redis', slug: 'redis' },
    { name: 'GraphQL', slug: 'graphql' },
    { name: 'Flutter', slug: 'flutter' },
    { name: 'Prisma ORM', slug: 'prisma' },
  ];

  const technologies = {};
  for (const tech of techData) {
    technologies[tech.slug] = await prisma.technology.upsert({
      where: { slug: tech.slug },
      update: tech,
      create: tech,
    });
  }
  console.log(`Seeded ${techData.length} technologies.`);

  // 4. Seed Website Settings
  const settingsData = [
    { key: 'site_title', value: 'CoderHarbor – Digital Project Marketplace', description: 'Platform primary title' },
    { key: 'site_tagline', value: 'Your Projects. Your Possibilities.', description: 'Brand slogan' },
    { key: 'contact_email', value: 'support@coderharbor.com', description: 'Official support inbox' },
    { key: 'contact_phone', value: '+1 (800) 555-0199', description: 'Official contact phone' },
    { key: 'contact_address', value: '742 Harbor Way, Suite 400, San Francisco, CA 94107', description: 'Headquarters physical address' },
    { key: 'purchasing_notice', value: 'Online purchasing is coming soon. Please check back later.', description: 'Notice shown for paid projects' },
  ];

  for (const set of settingsData) {
    await prisma.websiteSetting.upsert({
      where: { key: set.key },
      update: set,
      create: set,
    });
  }

  // 5. Seed Real Projects
  const projectsData = [
    {
      title: 'HarborFlow – Multi-Tenant SaaS Workspace',
      slug: 'harborflow-multi-tenant-saas-workspace',
      shortDescription: 'Production-ready enterprise SaaS starter with workspaces, RBAC, analytics, and webhook pipelines.',
      fullDescription: `### Overview
HarborFlow is a complete, production-hardened multi-tenant SaaS workspace engineered for developer-first productivity. It features robust tenant isolation, modular RBAC permissions, audit logging, and lightning-fast database interactions.

### Key Capabilities
- **Multi-Tenant Architecture**: Schema and tenant separation with zero data leakage.
- **Role-Based Authorization**: Granular roles (Owner, Admin, Member, Guest) with permission matrix.
- **Webhook Dispatch Engine**: High-throughput asynchronous event triggers with retry policies.
- **Audit Trails**: Immutable activity logs tracking every user and system event.
- **REST & GraphQL APIs**: Fully documented OpenAPI 3.0 specification included.`,
      categorySlug: 'web-applications',
      techSlugs: ['react', 'nodejs', 'express', 'postgresql', 'prisma', 'tailwind-css'],
      productType: 'FULL_APPLICATION',
      price: 149.00,
      isFree: false,
      isFeatured: true,
      status: 'PUBLISHED',
      thumbnail: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=800&q=80',
      demoUrl: 'https://demo.harborflow.example.com',
      licenseText: 'Single Commercial License: Grants buyer rights to deploy unlimited end-user instances. Resale of raw source code prohibited.',
      supportInformation: '6 months dedicated priority email and issue tracker support included with architecture advisory.',
      installationRequirements: 'Node.js 18+, PostgreSQL 14+, 2GB RAM minimum, NPM or Yarn package manager.',
      deliverables: 'Full frontend source code, backend Express API, Prisma schema with migrations, Docker compose files, comprehensive documentation PDF.',
      documentationAvailable: true,
      downloadAllowed: false,
    },
    {
      title: 'DevHarbor React Starter Kit & Design System',
      slug: 'devharbor-react-starter-kit',
      shortDescription: 'Free modern developer starter kit featuring Tailwind CSS, accessible components, and clean architecture.',
      fullDescription: `### Overview
DevHarbor Starter Kit is an open-source, beautifully structured React boilerplate tailored for modern digital applications. It comes packed with pre-built accessible UI components, dark mode presets, Lucide icons integration, and clean folder structures.

### What's Inside
- **Clean Architecture**: Decoupled presentation, hooks, and services.
- **Component Showcase**: Over 40+ accessible UI components (dialogs, tables, drawers, buttons).
- **Theme Switcher**: Instant light/dark mode with CSS variable mappings.
- **Responsive Layouts**: 100% mobile-first design crafted with Tailwind CSS.`,
      categorySlug: 'developer-templates',
      techSlugs: ['react', 'tailwind-css', 'typescript'],
      productType: 'TEMPLATE',
      price: 0.00,
      isFree: true,
      isFeatured: true,
      status: 'PUBLISHED',
      thumbnail: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=800&q=80',
      demoUrl: 'https://starterkit.coderharbor.example.com',
      licenseText: 'MIT Open-Source License: Free to use for personal and commercial applications with proper attribution.',
      supportInformation: 'Community GitHub discussion support and regular maintenance releases.',
      installationRequirements: 'Node.js 18+, modern browser supporting ES6 modules.',
      deliverables: 'Complete Vite + React 18 template repository, Tailwind CSS config, 40+ accessible UI components.',
      documentationAvailable: true,
      downloadAllowed: true, // Free project with download allowed!
      hasFile: true,
    },
    {
      title: 'OmniBill Pro – Enterprise Invoicing & Tax Platform',
      slug: 'omnibill-pro-invoicing-tax-platform',
      shortDescription: 'Full-fledged billing system with GST/VAT compliance, recurring subscriptions, and multi-currency PDF generation.',
      fullDescription: `### Overview
OmniBill Pro is an advanced billing, accounting, and recurring invoice automation platform designed for modern consulting firms, agencies, and SaaS businesses.

### Features
- **Automated Recurring Invoices**: Scheduled PDF generation and customer notifications.
- **Multi-Currency & Tax Engine**: Pre-configured support for GST, VAT, and US Sales tax.
- **Client Self-Service Portal**: Customers can log in, view unpaid invoices, and download receipts.
- **Financial Analytics**: Real-time revenue run rate, accounts receivable aging, and expense tracking.`,
      categorySlug: 'billing-software',
      techSlugs: ['nodejs', 'express', 'postgresql', 'prisma', 'react'],
      productType: 'FULL_APPLICATION',
      price: 199.00,
      isFree: false,
      isFeatured: true,
      status: 'PUBLISHED',
      thumbnail: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=800&q=80',
      demoUrl: 'https://omnibill.coderharbor.example.com',
      licenseText: 'Standard Extended License for business deployment within your organization.',
      supportInformation: '12 months priority security updates and email ticket resolution.',
      installationRequirements: 'Node.js 18+, PostgreSQL 15, Chromium for PDF rendering service.',
      deliverables: 'Node/Express API, React Admin SPA, PDF render worker microservice, database migration scripts.',
      documentationAvailable: true,
      downloadAllowed: false,
    },
    {
      title: 'EduHarbor LMS – Modern Course & Academy Portal',
      slug: 'eduharbor-lms-course-academy-portal',
      shortDescription: 'Feature-packed learning management system with video streaming, interactive quizzes, and student certificates.',
      fullDescription: `### Overview
EduHarbor LMS empowers educators, academies, and internal corporate training teams to deploy a branded digital university in minutes.

### Features
- **Video Lesson Player**: Adaptive bitrate streaming support with resume-playback.
- **Quiz & Examination Engine**: Multiple choice, code evaluation, and automated scoring.
- **Certificate Generation**: Automated SVG/PDF certificate issuance on course completion.
- **Instructor Dashboard**: Course authoring, student engagement heatmaps, and feedback.`,
      categorySlug: 'education-and-lms',
      techSlugs: ['react', 'nextjs', 'nodejs', 'postgresql', 'tailwind-css'],
      productType: 'FULL_APPLICATION',
      price: 249.00,
      isFree: false,
      isFeatured: true,
      status: 'PUBLISHED',
      thumbnail: 'https://images.unsplash.com/photo-1501504905252-473c47e087f8?auto=format&fit=crop&w=800&q=80',
      demoUrl: 'https://eduharbor.demo.example.com',
      licenseText: 'Educational Commercial License: Single institution deployment.',
      supportInformation: '6 months technical setup assistance and Discord developer channel access.',
      installationRequirements: 'Node.js 20+, PostgreSQL 15, S3-compatible object storage for video assets.',
      deliverables: 'Full Next.js frontend, Express backend, Prisma schema, Certificate templates.',
      documentationAvailable: true,
      downloadAllowed: false,
    },
    {
      title: 'CoreERP Suite – Supply Chain & Inventory Manager',
      slug: 'coreerp-suite-inventory-manager',
      shortDescription: 'Industrial-grade ERP solution for warehouse management, supplier coordination, and asset tracking.',
      fullDescription: `### Overview
CoreERP Suite delivers end-to-end supply chain visibility for manufacturing, retail, and wholesale distribution businesses.

### Features
- **Warehouse Barcode & Bin Tracking**: Real-time stock level monitoring across multiple depots.
- **Purchase Order Workflow**: Approval workflows from requisition to supplier dispatch.
- **Vendor Rating Matrix**: Historical quality and delivery timeliness evaluation.
- **Stock Alert Triggers**: Automated alerts when safety thresholds are breached.`,
      categorySlug: 'erp-and-crm',
      techSlugs: ['react', 'nodejs', 'postgresql', 'docker'],
      productType: 'FULL_APPLICATION',
      price: 389.00,
      isFree: false,
      isFeatured: false,
      status: 'PUBLISHED',
      thumbnail: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=800&q=80',
      demoUrl: 'https://coreerp.demo.example.com',
      licenseText: 'Enterprise Commercial License for on-premise or private cloud infrastructure.',
      supportInformation: 'Dedicated onboarding engineer consultation and 1 year updates.',
      installationRequirements: 'Docker and Docker Compose, 4GB RAM minimum, PostgreSQL 14+.',
      deliverables: 'Docker containers, seed datasets, complete microservices source code, Postman collection.',
      documentationAvailable: true,
      downloadAllowed: false,
    },
    {
      title: 'HarborCareer – Tech Talent & Job Portal Engine',
      slug: 'harborcareer-tech-job-portal-engine',
      shortDescription: 'Clean job board platform with applicant tracking, employer subscriptions, and resume parsing.',
      fullDescription: `### Overview
HarborCareer is a specialized job board and candidate management platform designed for niche tech communities and recruiters.

### Features
- **Employer Company Profiles**: Branded career pages with active openings.
- **Resume Search & Filter**: Filter candidates by tech stack, experience, and location.
- **Application Pipeline (Kanban)**: Drag-and-drop candidates through hiring stages.
- **Email Notification Automation**: Interview invitations and status update alerts.`,
      categorySlug: 'job-portals',
      techSlugs: ['react', 'nodejs', 'express', 'postgresql', 'tailwind-css'],
      productType: 'FULL_APPLICATION',
      price: 179.00,
      isFree: false,
      isFeatured: false,
      status: 'PUBLISHED',
      thumbnail: 'https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=800&q=80',
      demoUrl: 'https://careers.coderharbor.example.com',
      licenseText: 'Standard Single Domain Commercial License.',
      supportInformation: '6 months technical assistance and bug fix updates.',
      installationRequirements: 'Node.js 18+, PostgreSQL 14+, SMTP credentials for transactional emails.',
      deliverables: 'Frontend React app, backend API, database schema, email HTML templates.',
      documentationAvailable: true,
      downloadAllowed: false,
    },
  ];

  for (const p of projectsData) {
    const category = categories[p.categorySlug];
    if (!category) continue;

    const existing = await prisma.product.findUnique({ where: { slug: p.slug } });
    if (existing) {
      console.log(`Product already exists: ${p.title}`);
      continue;
    }

    const createdProduct = await prisma.product.create({
      data: {
        title: p.title,
        slug: p.slug,
        shortDescription: p.shortDescription,
        fullDescription: p.fullDescription,
        categoryId: category.id,
        thumbnail: p.thumbnail,
        demoUrl: p.demoUrl,
        productType: p.productType,
        price: p.price,
        isFree: p.isFree,
        isFeatured: p.isFeatured,
        status: p.status,
        licenseText: p.licenseText,
        supportInformation: p.supportInformation,
        installationRequirements: p.installationRequirements,
        deliverables: p.deliverables,
        documentationAvailable: p.documentationAvailable,
        downloadAllowed: p.downloadAllowed,
      },
    });

    // Link technologies
    for (const techSlug of p.techSlugs) {
      const tech = technologies[techSlug];
      if (tech) {
        await prisma.productTechnology.create({
          data: {
            productId: createdProduct.id,
            technologyId: tech.id,
          },
        });
      }
    }

    // Attach sample file if free downloadable
    if (p.hasFile) {
      await prisma.productFile.create({
        data: {
          productId: createdProduct.id,
          filename: 'pkg_coderharbor_starter_kit_demo.zip',
          originalName: 'DevHarbor_React_Starter_Kit_v1.0.0.zip',
          privateStorageKey: 'pkg_coderharbor_starter_kit_demo.zip',
          fileSize: BigInt(fs.statSync(sampleZipPath).size),
          fileType: 'application/zip',
          version: '1.0.0',
        },
      });
    }

    // Attach screenshots
    const sampleImages = [
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80',
      'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?auto=format&fit=crop&w=1200&q=80',
    ];

    for (let i = 0; i < sampleImages.length; i++) {
      await prisma.productImage.create({
        data: {
          productId: createdProduct.id,
          imageUrl: sampleImages[i],
          altText: `${p.title} Preview Screenshot ${i + 1}`,
          displayOrder: i,
        },
      });
    }

    console.log(`Created product: ${p.title} (${p.isFree ? 'FREE' : '$' + p.price})`);
  }

  // 6. Seed a sample support ticket from customer
  const sampleProduct = await prisma.product.findFirst({ where: { isFeatured: true } });
  await prisma.supportTicket.upsert({
    where: { ticketNumber: 'TKT-2026-1001' },
    update: {},
    create: {
      ticketNumber: 'TKT-2026-1001',
      userId: customer.id,
      productId: sampleProduct?.id,
      subject: 'Inquiry regarding Docker deployment architecture',
      message: 'Hello CoderHarbor team, I am reviewing the architecture for multi-tenant deployment. Does this support automated SSL provisioning via Traefik or Caddy?',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      messages: {
        create: [
          {
            userId: customer.id,
            message: 'Hello CoderHarbor team, I am reviewing the architecture for multi-tenant deployment. Does this support automated SSL provisioning via Traefik or Caddy?',
            isAdmin: false,
          },
          {
            userId: admin.id,
            message: 'Hello Alex! Yes, HarborFlow includes ready-to-run docker-compose profiles for both Caddy and Nginx with automated ACME TLS certificate generation out of the box.',
            isAdmin: true,
          },
        ],
      },
    },
  });

  console.log('CoderHarbor Database seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

