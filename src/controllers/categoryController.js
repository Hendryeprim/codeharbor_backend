import prisma from '../database/prisma.js';
import { getCache, setCache } from '../utils/cache.js';

export const getCategories = async (req, res, next) => {
  try {
    const cacheKey = 'categories_all';
    const cached = getCache(cacheKey);
    if (cached) {
      return res.status(200).json(cached);
    }

    const categories = await prisma.category.findMany({
      where: { status: 'ACTIVE' },
      include: {
        _count: {
          select: {
            products: {
              where: { status: 'PUBLISHED' },
            },
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    const formatted = categories.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      icon: c.icon,
      productCount: c._count.products,
      createdAt: c.createdAt,
    }));

    const responsePayload = {
      success: true,
      categories: formatted,
    };
    setCache(cacheKey, responsePayload, 60);

    res.status(200).json(responsePayload);
  } catch (error) {
    next(error);
  }
};
