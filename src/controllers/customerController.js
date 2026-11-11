import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import bcrypt from 'bcryptjs';
import prisma from '../database/prisma.js';
import { PRIVATE_STORAGE_DIR } from '../middleware/upload.js';
import {
  TEMP_BUILDS_DIR,
  downloadGithubZipToFile,
  fetchGithubArchiveResponse,
  mergeGithubZips,
  parseGithubStorageKey,
} from '../services/previewService.js';

export const getProfile = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        phone: true,
        company: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({ success: true, user });
  } catch (error) {
    next(error);
  }
};

export const updateProfile = async (req, res, next) => {
  try {
    const { name, phone, company, currentPassword, newPassword } = req.body;

    const dataToUpdate = {};
    if (name) dataToUpdate.name = name.trim();
    if (phone !== undefined) dataToUpdate.phone = phone ? phone.trim() : null;
    if (company !== undefined) dataToUpdate.company = company ? company.trim() : null;

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required to change password.',
        });
      }

      const currentUser = await prisma.user.findUnique({
        where: { id: req.user.id },
      });

      const isMatch = await bcrypt.compare(currentPassword, currentUser.passwordHash);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Incorrect current password.',
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'New password must be at least 6 characters.',
        });
      }

      dataToUpdate.passwordHash = await bcrypt.hash(newPassword, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: dataToUpdate,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        phone: true,
        company: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully.',
      user: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyProjects = async (req, res, next) => {
  try {
    // Find all products that the user has downloaded or has permission for
    const downloads = await prisma.download.findMany({
      where: { userId: req.user.id },
      distinct: ['productId'],
      include: {
        product: {
          include: {
            category: true,
            technologies: {
              include: { technology: true },
            },
            files: {
              select: {
                id: true,
                originalName: true,
                version: true,
                fileSize: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    // Also get all available free products
    const freeProducts = await prisma.product.findMany({
      where: {
        status: 'PUBLISHED',
        isFree: true,
        downloadAllowed: true,
      },
      include: {
        category: true,
        technologies: {
          include: { technology: true },
        },
        files: {
          select: {
            id: true,
            originalName: true,
            version: true,
            fileSize: true,
            createdAt: true,
          },
        },
      },
    });

    const downloadedProductIds = new Set(downloads.map((d) => d.productId));
    const accessibleProjects = [
      ...downloads.map((d) => ({
        ...d.product,
        price: Number(d.product.price),
        viewPrice: Number(d.product.viewPrice || 0),
        isViewFree: d.product.isViewFree ?? true,
        technologies: d.product.technologies.map((t) => t.technology),
        files: d.product.files.map((f) => ({ ...f, fileSize: Number(f.fileSize) })),
        downloadedAt: d.downloadedAt,
        accessType: 'DOWNLOADED',
      })),
      ...freeProducts
        .filter((p) => !downloadedProductIds.has(p.id))
        .map((p) => ({
          ...p,
          price: Number(p.price),
          viewPrice: Number(p.viewPrice || 0),
          isViewFree: p.isViewFree ?? true,
          technologies: p.technologies.map((t) => t.technology),
          files: p.files.map((f) => ({ ...f, fileSize: Number(f.fileSize) })),
          accessType: 'AVAILABLE_FREE',
        })),
    ];

    res.status(200).json({
      success: true,
      projects: accessibleProjects,
    });
  } catch (error) {
    next(error);
  }
};

export const getMyOrders = async (req, res, next) => {
  try {
    // In current phase, payment is postponed
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        items: {
          include: { product: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.status(200).json({
      success: true,
      orders,
      notice: 'Online purchasing is currently in "Coming Soon" phase. No financial transactions are charged.',
    });
  } catch (error) {
    next(error);
  }
};

export const getMyDownloads = async (req, res, next) => {
  try {
    const downloads = await prisma.download.findMany({
      where: { userId: req.user.id },
      include: {
        product: {
          select: { id: true, title: true, slug: true, thumbnail: true },
        },
        productFile: {
          select: { id: true, originalName: true, version: true, fileSize: true },
        },
      },
      orderBy: { downloadedAt: 'desc' },
    });

    const formatted = downloads.map((d) => ({
      id: d.id,
      product: d.product,
      file: {
        ...d.productFile,
        fileSize: Number(d.productFile.fileSize),
      },
      downloadedAt: d.downloadedAt,
    }));

    res.status(200).json({
      success: true,
      downloads: formatted,
    });
  } catch (error) {
    next(error);
  }
};

export const downloadFreeProduct = async (req, res, next) => {
  try {
    const { fileId } = req.params;

    const file = await prisma.productFile.findUnique({
      where: { id: fileId },
      include: {
        product: true,
      },
    });

    if (!file) {
      return res.status(404).json({
        success: false,
        message: 'Requested project file does not exist.',
      });
    }

    // STRICT CHECK: Is this product authorized for free download or is user ADMIN?
    const isAuthorized =
      req.user.role === 'ADMIN' ||
      (file.product.status === 'PUBLISHED' && file.product.isFree && file.product.downloadAllowed);

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        message: 'This source-code file is restricted. Purchasing for paid products is currently Coming Soon.',
      });
    }

    // Support zero-storage GitHub source downloads directly streamed through backend
    const githubMeta = parseGithubStorageKey(file.privateStorageKey);
    if (githubMeta) {
      if (githubMeta.mode === 'dual') {
        const suffix = `dl_${file.productId}_${Date.now()}`;
        const tempFe = path.join(TEMP_BUILDS_DIR, `fe_${suffix}.zip`);
        const tempBe = path.join(TEMP_BUILDS_DIR, `be_${suffix}.zip`);
        const tempFull = path.join(TEMP_BUILDS_DIR, `full_${suffix}.zip`);

        try {
          await Promise.all([
            downloadGithubZipToFile(
              `https://github.com/${githubMeta.frontend.owner}/${githubMeta.frontend.repo}/tree/${githubMeta.frontend.branch}`,
              tempFe
            ),
            downloadGithubZipToFile(
              `https://github.com/${githubMeta.backend.owner}/${githubMeta.backend.repo}/tree/${githubMeta.backend.branch}`,
              tempBe
            ),
          ]);

          mergeGithubZips(tempFe, tempBe, tempFull);

          await prisma.download.create({
            data: {
              userId: req.user.id,
              productId: file.productId,
              productFileId: file.id,
              ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
              userAgent: req.headers['user-agent'] || null,
            },
          });

          res.setHeader(
            'Content-Disposition',
            `attachment; filename="${encodeURIComponent(file.originalName || `${githubMeta.frontend.repo}-fullstack.zip`)}"`
          );
          res.setHeader('Content-Type', 'application/zip');

          await pipeline(fs.createReadStream(tempFull), res);
        } finally {
          for (const p of [tempFe, tempBe, tempFull]) {
            try {
              if (fs.existsSync(p)) fs.rmSync(p, { force: true });
            } catch (_) {}
          }
        }
        return;
      }

      const { response } = await fetchGithubArchiveResponse(
        githubMeta.owner,
        githubMeta.repo,
        githubMeta.branch
      );

      await prisma.download.create({
        data: {
          userId: req.user.id,
          productId: file.productId,
          productFileId: file.id,
          ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
          userAgent: req.headers['user-agent'] || null,
        },
      });

      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(file.originalName || `${githubMeta.repo}.zip`)}"`
      );
      res.setHeader('Content-Type', 'application/zip');

      await pipeline(Readable.fromWeb(response.body), res);
      return;
    }

    // Path traversal prevention: resolve path inside PRIVATE_STORAGE_DIR
    const safeFilename = path.basename(file.privateStorageKey);
    const absoluteFilePath = path.join(PRIVATE_STORAGE_DIR, safeFilename);

    if (!fs.existsSync(absoluteFilePath)) {
      return res.status(404).json({
        success: false,
        message: 'Project archive file not found on server.',
      });
    }

    // Record download event in database
    await prisma.download.create({
      data: {
        userId: req.user.id,
        productId: file.productId,
        productFileId: file.id,
        ipAddress: req.ip || req.headers['x-forwarded-for'] || null,
        userAgent: req.headers['user-agent'] || null,
      },
    });

    // Set secure download headers
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);
    res.setHeader('Content-Type', file.fileType || 'application/octet-stream');

    const fileStream = fs.createReadStream(absoluteFilePath);
    fileStream.pipe(res);
  } catch (error) {
    next(error);
  }
};

