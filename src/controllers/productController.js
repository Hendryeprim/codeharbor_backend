import prisma from '../database/prisma.js';
import { getCache, setCache } from '../utils/cache.js';

export const normalizePreviewUrl = (url, productId, req = null) => {
  if (!url) return null;
  const host = req?.headers?.host || (req?.get ? req.get('host') : '') || '';
  const isLocalHost = host.startsWith('localhost') || host.startsWith('127.0.0.1');

  // If running in purely local dev environment, keep localhost
  if (process.env.IS_LOCAL_DEV === 'true' && isLocalHost) {
    return url;
  }

  // In production (aaPanel, coderharbor.com) or whenever accessed through a non-local client:
  // Convert any localhost / 127.0.0.1 or port 5050 url to the canonical public preview endpoint
  if (url.includes('localhost') || url.includes('127.0.0.1') || url.includes(':5050')) {
    return `https://api.coderharbor.com/previews/${productId}/`;
  }

  return url;
};

export const getProducts = async (req, res, next) => {
  try {
    const cacheKey = `products_${req.originalUrl}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }
    const {
      search,
      category,
      technology,
      productType,
      isFree,
      minPrice,
      maxPrice,
      sortBy = 'newest',
      page = 1,
      limit = 12,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const take = Math.min(50, Math.max(1, parseInt(limit, 10) || 12));
    const skip = (pageNum - 1) * take;

    const where = {
      status: 'PUBLISHED',
    };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { shortDescription: { contains: search, mode: 'insensitive' } },
        { fullDescription: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.category = {
        slug: category,
      };
    }

    if (technology) {
      where.technologies = {
        some: {
          technology: {
            slug: technology,
          },
        },
      };
    }

    if (productType) {
      where.productType = productType;
    }

    if (isFree !== undefined && isFree !== '') {
      where.isFree = isFree === 'true';
    }

    if (minPrice || maxPrice) {
      where.price = {};
      if (minPrice) where.price.gte = parseFloat(minPrice);
      if (maxPrice) where.price.lte = parseFloat(maxPrice);
    }

    let orderBy = { createdAt: 'desc' };
    if (sortBy === 'price-low') {
      orderBy = { price: 'asc' };
    } else if (sortBy === 'price-high') {
      orderBy = { price: 'desc' };
    } else if (sortBy === 'title') {
      orderBy = { title: 'asc' };
    } else if (sortBy === 'popular') {
      orderBy = { viewCount: 'desc' };
    }

    const [products, totalCount] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          category: {
            select: { id: true, name: true, slug: true },
          },
          technologies: {
            include: {
              technology: {
                select: { id: true, name: true, slug: true, icon: true },
              },
            },
          },
          _count: {
            select: { files: true, downloads: true },
          },
        },
      }),
      prisma.product.count({ where }),
    ]);

    const formattedProducts = products.map((p) => ({
      ...p,
      price: Number(p.price),
      viewPrice: Number(p.viewPrice || 0),
      isViewFree: p.isViewFree ?? true,
      previewUrl: normalizePreviewUrl(p.previewUrl, p.id, req),
      technologies: p.technologies.map((t) => t.technology),
    }));

    const responsePayload = {
      success: true,
      products: formattedProducts,
      pagination: {
        page: pageNum,
        limit: take,
        totalCount,
        totalPages: Math.ceil(totalCount / take),
      },
    };

    setCache(cacheKey, responsePayload, 30);
    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const cacheKey = 'products_featured';
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }
    const products = await prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        isFeatured: true,
      },
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: {
        category: {
          select: { id: true, name: true, slug: true },
        },
        technologies: {
          include: {
            technology: {
              select: { id: true, name: true, slug: true, icon: true },
            },
          },
        },
      },
    });

    const formattedProducts = products.map((p) => ({
      ...p,
      price: Number(p.price),
      viewPrice: Number(p.viewPrice || 0),
      isViewFree: p.isViewFree ?? true,
      previewUrl: normalizePreviewUrl(p.previewUrl, p.id, req),
      technologies: p.technologies.map((t) => t.technology),
    }));

    const responsePayload = {
      success: true,
      products: formattedProducts,
    };
    setCache(cacheKey, responsePayload, 30);
    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
};

export const getProductBySlug = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const cacheKey = `product_${slug}`;
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: {
          select: { id: true, name: true, slug: true, description: true },
        },
        technologies: {
          include: {
            technology: {
              select: { id: true, name: true, slug: true, icon: true },
            },
          },
        },
        images: {
          orderBy: { displayOrder: 'asc' },
        },
        files: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            originalName: true,
            fileSize: true,
            fileType: true,
            version: true,
            createdAt: true,
            // Notice: privateStorageKey is explicitly omitted for security!
          },
        },
        _count: {
          select: { downloads: true },
        },
      },
    });

    if (!product || (product.status !== 'PUBLISHED' && (!req.user || req.user.role !== 'ADMIN'))) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    // Increment view count asynchronously
    prisma.product.update({
      where: { id: product.id },
      data: { viewCount: { increment: 1 } },
    }).catch((err) => console.error('Error incrementing view count:', err));

    const formattedProduct = {
      ...product,
      price: Number(product.price),
      viewPrice: Number(product.viewPrice || 0),
      isViewFree: product.isViewFree ?? true,
      previewUrl: normalizePreviewUrl(product.previewUrl, product.id, req),
      technologies: product.technologies.map((t) => t.technology),
      files: product.files.map((f) => ({
        ...f,
        fileSize: f.fileSize ? Number(f.fileSize) : 0,
      })),
    };

    const responsePayload = {
      success: true,
      product: formattedProduct,
    };
    setCache(cacheKey, responsePayload, 60);

    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
};

