import prisma from '../database/prisma.js';

export const getTechnologies = async (req, res, next) => {
  try {
    const technologies = await prisma.technology.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            products: {
              where: {
                product: { status: 'PUBLISHED' },
              },
            },
          },
        },
      },
    });

    const formatted = technologies.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      icon: t.icon,
      productCount: t._count.products,
    }));

    res.status(200).json({
      success: true,
      technologies: formatted,
    });
  } catch (error) {
    next(error);
  }
};

