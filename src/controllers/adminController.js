import path from 'path';
import fs from 'fs';
import prisma from '../database/prisma.js';
import { createSlug } from '../utils/slug.js';
import { clearCachePattern } from '../utils/cache.js';
import {
  processProjectZip,
  processGithubRepo,
  rebuildProjectPreview,
  toggleProjectPreview,
} from '../services/previewService.js';
import { PRIVATE_STORAGE_DIR } from '../middleware/upload.js';

export const getDashboardStats = async (req, res, next) => {
  try {
    const [
      totalPublished,
      totalDraft,
      totalArchived,
      totalCategories,
      totalTechnologies,
      totalCustomers,
      recentProjects,
      recentCustomers,
      recentTickets,
    ] = await Promise.all([
      prisma.product.count({ where: { status: 'PUBLISHED' } }),
      prisma.product.count({ where: { status: 'DRAFT' } }),
      prisma.product.count({ where: { status: 'ARCHIVED' } }),
      prisma.category.count(),
      prisma.technology.count(),
      prisma.user.count({ where: { role: 'CUSTOMER' } }),
      prisma.product.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { category: { select: { name: true } } },
      }),
      prisma.user.findMany({
        where: { role: 'CUSTOMER' },
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.supportTicket.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' },
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);

    res.status(200).json({
      success: true,
      stats: {
        totalPublished,
        totalDraft,
        totalArchived,
        totalProjects: totalPublished + totalDraft + totalArchived,
        totalCategories,
        totalTechnologies,
        totalCustomers,
      },
      recentProjects,
      recentCustomers,
      recentTickets,
    });
  } catch (error) {
    next(error);
  }
};

// Admin Products CRUD
export const getAdminProducts = async (req, res, next) => {
  try {
    const { status, category, search } = req.query;

    const where = {};
    if (status) where.status = status;
    if (category) where.categoryId = category;
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { shortDescription: { contains: search, mode: 'insensitive' } },
      ];
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        category: true,
        technologies: {
          include: { technology: true },
        },
        files: true,
        _count: {
          select: { downloads: true },
        },
      },
    });

    const formatted = products.map((p) => ({
      ...p,
      price: Number(p.price),
      viewPrice: Number(p.viewPrice || 0),
      isViewFree: p.isViewFree ?? true,
      technologies: p.technologies.map((t) => t.technology),
      files: p.files.map((f) => ({ ...f, fileSize: Number(f.fileSize) })),
    }));

    res.status(200).json({
      success: true,
      products: formatted,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminProductById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        technologies: {
          include: { technology: true },
        },
        images: {
          orderBy: { displayOrder: 'asc' },
        },
        files: true,
      },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    res.status(200).json({
      success: true,
      product: {
        ...product,
        price: Number(product.price),
        viewPrice: Number(product.viewPrice || 0),
        isViewFree: product.isViewFree ?? true,
        technologies: product.technologies.map((t) => t.technology),
        files: product.files.map((f) => ({ ...f, fileSize: Number(f.fileSize) })),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const {
      title,
      shortDescription,
      fullDescription,
      categoryId,
      thumbnail,
      demoUrl,
      productType = 'FULL_APPLICATION',
      price = 0,
      isFree = false,
      viewPrice = 0,
      isViewFree = true,
      isFeatured = false,
      status = 'PUBLISHED',
      licenseText,
      supportInformation,
      installationRequirements,
      deliverables,
      documentationAvailable = true,
      downloadAllowed = false,
      technologyIds = [],
      images = [],
    } = req.body;

    if (!title || !shortDescription || !fullDescription || !categoryId) {
      return res.status(400).json({
        success: false,
        message: 'Title, short description, full description, and category are required.',
      });
    }

    let slug = createSlug(title);
    const existing = await prisma.product.findUnique({ where: { slug } });
    if (existing) {
      slug = `${slug}-${Date.now().toString().slice(-4)}`;
    }

    const product = await prisma.product.create({
      data: {
        title: title.trim(),
        slug,
        shortDescription: shortDescription.trim(),
        fullDescription: fullDescription.trim(),
        categoryId,
        thumbnail: thumbnail || null,
        demoUrl: demoUrl || null,
        productType,
        price: parseFloat(price) || 0,
        isFree: Boolean(isFree),
        viewPrice: parseFloat(viewPrice) || 0,
        isViewFree: Boolean(isViewFree),
        isFeatured: Boolean(isFeatured),
        status,
        licenseText: licenseText || null,
        supportInformation: supportInformation || null,
        installationRequirements: installationRequirements || null,
        deliverables: deliverables || null,
        documentationAvailable: Boolean(documentationAvailable),
        downloadAllowed: Boolean(downloadAllowed),
        technologies: {
          create: (technologyIds || [])
            .map((t) => (typeof t === 'object' && t !== null ? t.id || t.technologyId : t))
            .filter((techId) => typeof techId === 'string' && techId.trim().length > 0)
            .map((techId) => ({
              technologyId: techId,
            })),
        },
        images: {
          create: images.map((img, index) => ({
            imageUrl: img.imageUrl,
            altText: img.altText || `${title} screenshot ${index + 1}`,
            displayOrder: index,
          })),
        },
      },
      include: {
        category: true,
        technologies: { include: { technology: true } },
      },
    });

    clearCachePattern('product');
    res.status(201).json({
      success: true,
      message: 'Project created successfully.',
      product: {
        ...product,
        price: Number(product.price),
        viewPrice: Number(product.viewPrice || 0),
        isViewFree: product.isViewFree ?? true,
        technologies: product.technologies.map((t) => t.technology),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      title,
      shortDescription,
      fullDescription,
      categoryId,
      thumbnail,
      demoUrl,
      productType,
      price,
      isFree,
      viewPrice,
      isViewFree,
      isFeatured,
      status,
      licenseText,
      supportInformation,
      installationRequirements,
      deliverables,
      documentationAvailable,
      downloadAllowed,
      technologyIds,
      images,
    } = req.body;

    const currentProduct = await prisma.product.findUnique({ where: { id } });
    if (!currentProduct) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const data = {};
    if (title) {
      const trimmedTitle = title.trim();
      data.title = trimmedTitle;
      if (trimmedTitle !== currentProduct.title) {
        let slug = createSlug(trimmedTitle);
        const existingSlug = await prisma.product.findUnique({ where: { slug } });
        if (existingSlug && existingSlug.id !== id) {
          slug = `${slug}-${Date.now().toString().slice(-4)}`;
        }
        data.slug = slug;
      }
    }
    if (shortDescription !== undefined) data.shortDescription = shortDescription.trim();
    if (fullDescription !== undefined) data.fullDescription = fullDescription.trim();
    if (categoryId) data.categoryId = categoryId;
    if (thumbnail !== undefined) data.thumbnail = thumbnail;
    if (demoUrl !== undefined) data.demoUrl = demoUrl;
    if (productType !== undefined) data.productType = productType;
    if (price !== undefined) data.price = parseFloat(price) || 0;
    if (isFree !== undefined) data.isFree = Boolean(isFree);
    if (viewPrice !== undefined) data.viewPrice = parseFloat(viewPrice) || 0;
    if (isViewFree !== undefined) data.isViewFree = Boolean(isViewFree);
    if (isFeatured !== undefined) data.isFeatured = Boolean(isFeatured);
    if (status !== undefined) data.status = status;
    if (licenseText !== undefined) data.licenseText = licenseText;
    if (supportInformation !== undefined) data.supportInformation = supportInformation;
    if (installationRequirements !== undefined) data.installationRequirements = installationRequirements;
    if (deliverables !== undefined) data.deliverables = deliverables;
    if (documentationAvailable !== undefined) data.documentationAvailable = Boolean(documentationAvailable);
    if (downloadAllowed !== undefined) data.downloadAllowed = Boolean(downloadAllowed);

    // Update technologies if provided
    if (Array.isArray(technologyIds)) {
      const validTechIds = Array.from(
        new Set(
          technologyIds
            .map((t) => (typeof t === 'object' && t !== null ? t.id || t.technologyId : t))
            .filter((tId) => typeof tId === 'string' && tId.trim().length > 0)
        )
      );

      await prisma.productTechnology.deleteMany({ where: { productId: id } });
      if (validTechIds.length > 0) {
        data.technologies = {
          create: validTechIds.map((tId) => ({ technologyId: tId })),
        };
      }
    }

    // Update images if provided
    if (Array.isArray(images)) {
      await prisma.productImage.deleteMany({ where: { productId: id } });
      data.images = {
        create: images.map((img, idx) => ({
          imageUrl: img.imageUrl,
          altText: img.altText || `${data.title || 'Project'} screenshot ${idx + 1}`,
          displayOrder: idx,
        })),
      };
    }

    const updated = await prisma.product.update({
      where: { id },
      data,
      include: {
        category: true,
        technologies: { include: { technology: true } },
        images: true,
        files: true,
      },
    });

    clearCachePattern('product');
    res.status(200).json({
      success: true,
      message: 'Project updated successfully.',
      product: {
        ...updated,
        price: Number(updated.price),
        viewPrice: Number(updated.viewPrice || 0),
        isViewFree: updated.isViewFree ?? true,
        technologies: updated.technologies.map((t) => t.technology),
        files: updated.files.map((f) => ({ ...f, fileSize: Number(f.fileSize) })),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.product.delete({ where: { id } });
    clearCachePattern('product');
    res.status(200).json({ success: true, message: 'Project deleted successfully.' });
  } catch (error) {
    next(error);
  }
};

// Admin Categories
export const getAdminCategories = async (req, res, next) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { products: true } },
      },
    });
    res.status(200).json({ success: true, categories });
  } catch (error) {
    next(error);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const { name, description, icon, status = 'ACTIVE' } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Category name is required.' });

    let slug = createSlug(name);
    const existing = await prisma.category.findUnique({ where: { slug } });
    if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;

    const category = await prisma.category.create({
      data: { name: name.trim(), slug, description, icon, status },
    });
    clearCachePattern('categor');
    res.status(201).json({ success: true, message: 'Category created.', category });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, icon, status } = req.body;

    const data = {};
    if (name) {
      const trimmedName = name.trim();
      data.name = trimmedName;
      let slug = createSlug(trimmedName);
      const existingCat = await prisma.category.findUnique({ where: { slug } });
      if (existingCat && existingCat.id !== id) {
        slug = `${slug}-${Date.now().toString().slice(-4)}`;
      }
      data.slug = slug;
    }
    if (description !== undefined) data.description = description;
    if (icon !== undefined) data.icon = icon;
    if (status !== undefined) data.status = status;

    const updated = await prisma.category.update({ where: { id }, data });
    clearCachePattern('categor');
    res.status(200).json({ success: true, message: 'Category updated.', category: updated });
  } catch (error) {
    next(error);
  }
};

export const deleteCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const productCount = await prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category because it contains ${productCount} project(s). Reassign them first.`,
      });
    }
    await prisma.category.delete({ where: { id } });
    clearCachePattern('categor');
    res.status(200).json({ success: true, message: 'Category deleted.' });
  } catch (error) {
    next(error);
  }
};

// Admin Technologies
export const getAdminTechnologies = async (req, res, next) => {
  try {
    const technologies = await prisma.technology.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { products: true } } },
    });
    res.status(200).json({ success: true, technologies });
  } catch (error) {
    next(error);
  }
};

export const createTechnology = async (req, res, next) => {
  try {
    const { name, icon } = req.body;
    if (!name) return res.status(400).json({ success: false, message: 'Technology name is required.' });

    let slug = createSlug(name);
    const existing = await prisma.technology.findUnique({ where: { slug } });
    if (existing) slug = `${slug}-${Date.now().toString().slice(-4)}`;

    const tech = await prisma.technology.create({
      data: { name: name.trim(), slug, icon },
    });

    res.status(201).json({ success: true, message: 'Technology created.', technology: tech });
  } catch (error) {
    next(error);
  }
};

export const deleteTechnology = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.technology.delete({ where: { id } });
    res.status(200).json({ success: true, message: 'Technology deleted.' });
  } catch (error) {
    next(error);
  }
};

// Admin Customers
export const getAdminCustomers = async (req, res, next) => {
  try {
    const { search } = req.query;
    const where = { role: 'CUSTOMER' };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }

    const customers = await prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        phone: true,
        company: true,
        createdAt: true,
        _count: {
          select: { downloads: true, supportTickets: true },
        },
      },
    });

    res.status(200).json({ success: true, customers });
  } catch (error) {
    next(error);
  }
};

export const toggleCustomerStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['ACTIVE', 'RESTRICTED'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const customer = await prisma.user.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, email: true, status: true },
    });

    res.status(200).json({
      success: true,
      message: `Customer status updated to ${status}.`,
      customer,
    });
  } catch (error) {
    next(error);
  }
};

// Admin Orders
export const getAdminOrders = async (req, res, next) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      orders,
      notice: 'Purchasing pipeline is currently set to Coming Soon.',
    });
  } catch (error) {
    next(error);
  }
};

// Admin Uploads
export const uploadImageFile = (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'No image uploaded.' });
  }

  const relativeUrl = `/uploads/images/${req.file.filename}`;
  const baseUrl = process.env.BACKEND_PUBLIC_URL || 'https://api.coderharbor.com';
  const fullUrl = `${baseUrl.replace(/\/$/, '')}${relativeUrl}`;

  res.status(200).json({
    success: true,
    message: 'Image uploaded successfully.',
    url: relativeUrl,
    fullUrl: fullUrl,
    filename: req.file.filename,
  });
};

export const uploadProjectZip = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No project archive file uploaded.' });
    }

    const { productId, version = '1.0.0' } = req.body;

    if (!productId) {
      return res.status(400).json({ success: false, message: 'Product ID is required to associate archive.' });
    }

    const file = await prisma.productFile.create({
      data: {
        productId,
        filename: req.file.filename,
        originalName: req.file.originalname,
        privateStorageKey: req.file.filename,
        fileSize: BigInt(req.file.size),
        fileType: req.file.mimetype || 'application/zip',
        version,
      },
    });

    // Automatically trigger safe project detection, build, and preview generation
    let previewResult = null;
    try {
      previewResult = await processProjectZip(productId, req.file.path, req.file.originalname);
    } catch (err) {
      console.error('Auto preview processing error:', err.message);
    }

    clearCachePattern('product');

    res.status(201).json({
      success: true,
      message: 'Project archive uploaded and processed for live preview.',
      file: {
        ...file,
        fileSize: Number(file.fileSize),
      },
      preview: previewResult,
    });
  } catch (error) {
    next(error);
  }
};

export const importProjectGithubLink = async (req, res, next) => {
  try {
    const { productId, githubUrl, backendGithubUrl = '', githubToken = '' } = req.body;

    if (!productId || !githubUrl) {
      return res.status(400).json({
        success: false,
        message: 'Product ID and Frontend / Main GitHub repository URL are required.',
      });
    }

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { files: true },
    });

    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const result = await processGithubRepo(productId, githubUrl, {
      backendGithubUrl,
      token: githubToken,
    });

    // Remove previous local ZIP files from disk + DB to save server storage
    for (const oldFile of product.files || []) {
      if (oldFile.privateStorageKey && !oldFile.privateStorageKey.startsWith('github')) {
        try {
          const oldPath = path.join(PRIVATE_STORAGE_DIR, path.basename(oldFile.privateStorageKey));
          if (fs.existsSync(oldPath)) fs.rmSync(oldPath, { force: true });
        } catch (_) {}
      }
    }
    await prisma.productFile.deleteMany({ where: { productId } });

    const ghFile = await prisma.productFile.create({
      data: {
        productId,
        filename: result.github.displayFilename || `${result.github.owner}/${result.github.repo}@${result.github.branch}`,
        originalName: result.github.originalName || `${result.github.repo}-${result.github.branch}.zip`,
        privateStorageKey: result.github.storageKey,
        fileSize: BigInt(result.github.archiveBytes),
        fileType: 'application/vnd.github+zip',
        version: result.github.branch.slice(0, 20),
      },
    });

    clearCachePattern('product');

    res.status(201).json({
      success: true,
      message: 'GitHub repository linked! Template preview ready with zero ZIP storage.',
      file: {
        ...ghFile,
        fileSize: Number(ghFile.fileSize),
      },
      preview: result.preview,
      github: result.github,
    });
  } catch (error) {
    if (error.message?.includes('GitHub') || error.message?.includes('URL')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    next(error);
  }
};

export const rebuildProductPreview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await rebuildProjectPreview(id);
    clearCachePattern('product');
    res.status(200).json({ success: true, message: 'Preview rebuild triggered.', result });
  } catch (error) {
    next(error);
  }
};

export const toggleProductPreview = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { enable } = req.body;
    const updated = await toggleProjectPreview(id, Boolean(enable));
    clearCachePattern('product');
    res.status(200).json({ success: true, message: `Preview ${enable ? 'enabled' : 'disabled'}.`, product: updated });
  } catch (error) {
    next(error);
  }
};

export const getProductPreviewLogs = async (req, res, next) => {
  try {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        previewUrl: true,
        previewStatus: true,
        previewType: true,
        previewBuildLogs: true,
        previewUpdatedAt: true,
      },
    });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }
    res.status(200).json({ success: true, preview: product });
  } catch (error) {
    next(error);
  }
};

// Website Settings
export const getWebsiteSettings = async (req, res, next) => {
  try {
    const settings = await prisma.websiteSetting.findMany();
    const settingsMap = {};
    settings.forEach((s) => {
      settingsMap[s.key] = s.value;
    });
    res.status(200).json({ success: true, settings: settingsMap, raw: settings });
  } catch (error) {
    next(error);
  }
};

export const updateWebsiteSetting = async (req, res, next) => {
  try {
    const { key, value, description } = req.body;
    if (!key) return res.status(400).json({ success: false, message: 'Setting key is required.' });

    const setting = await prisma.websiteSetting.upsert({
      where: { key },
      update: { value: String(value), description },
      create: { key, value: String(value), description },
    });

    res.status(200).json({ success: true, message: 'Setting saved.', setting });
  } catch (error) {
    next(error);
  }
};

