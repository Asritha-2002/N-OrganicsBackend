const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const Banner = require('../models/Banner');
const { auth, adminAuth } = require('../middleware/auth'); // Adjust your paths
const { uploadImageToCloudinary } = require('../config/cloudinary'); // Adjust your paths

const router = express.Router();

// Store file in memory buffer for Cloudinary uploading
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post(
  "/admin/banners",
  auth,
  adminAuth,
  upload.single("image"),
  async (req, res) => {
    try {
      const bannerData = { ...req.body };

      const normalizeStringArray = (input) => {
        if (!input) return [];

        if (Array.isArray(input)) {
          return input
            .map((item) => String(item).trim())
            .filter(Boolean);
        }

        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);

            if (Array.isArray(parsed)) {
              return parsed
                .map((item) => String(item).trim())
                .filter(Boolean);
            }
          } catch (err) {}

          return input
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        }

        return [];
      };

      if (!["all", "products", "category"].includes(bannerData.appliesTo)) {
        bannerData.appliesTo = "all";
      }

      if (bannerData.appliesTo === "products") {
        bannerData.productIds = normalizeStringArray(bannerData.productIds);
        bannerData.categoryIds = [];
      } else if (bannerData.appliesTo === "category") {
        bannerData.categoryIds = normalizeStringArray(bannerData.categoryIds);
        bannerData.productIds = [];
      } else {
        bannerData.productIds = [];
        bannerData.categoryIds = [];
      }

      if (
        bannerData.appliesTo === "products" &&
        bannerData.productIds.length === 0
      ) {
        return res.status(400).json({
          message: "productIds cannot be empty when appliesTo is 'products'",
        });
      }

      if (
        bannerData.appliesTo === "category" &&
        bannerData.categoryIds.length === 0
      ) {
        return res.status(400).json({
          message: "categoryIds cannot be empty when appliesTo is 'category'",
        });
      }

      bannerData.discount = Number(bannerData.discount);
      if (Number.isNaN(bannerData.discount)) {
        return res.status(400).json({ message: "Discount must be a valid number" });
      }

      bannerData.perUserLimit = Number(bannerData.perUserLimit);
      if (Number.isNaN(bannerData.perUserLimit)) {
        return res.status(400).json({ message: "perUserLimit must be a valid number" });
      }

      if (
        bannerData.maxUses === "" ||
        bannerData.maxUses === null ||
        bannerData.maxUses === undefined
      ) {
        bannerData.maxUses = null;
      } else {
        bannerData.maxUses = Number(bannerData.maxUses);
        if (Number.isNaN(bannerData.maxUses)) {
          return res.status(400).json({ message: "maxUses must be a valid number" });
        }
      }

      if (bannerData.priority !== undefined) {
        bannerData.priority = Number(bannerData.priority);
        if (Number.isNaN(bannerData.priority)) {
          return res.status(400).json({ message: "priority must be a valid number" });
        }
      }

      bannerData.isActive =
        bannerData.isActive === "true" || bannerData.isActive === true;

      if (bannerData.startDate) {
        const startDate = new Date(bannerData.startDate);
        if (Number.isNaN(startDate.getTime())) {
          return res.status(400).json({ message: "Invalid startDate" });
        }
        bannerData.startDate = startDate;
      }

      if (bannerData.endDate) {
        const endDate = new Date(bannerData.endDate);
        if (Number.isNaN(endDate.getTime())) {
          return res.status(400).json({ message: "Invalid endDate" });
        }
        bannerData.endDate = endDate;
      }

      if (bannerData.endDate <= bannerData.startDate) {
        return res.status(400).json({ message: "endDate must be after startDate" });
      }

      if (
        bannerData.discountType === "percentage" &&
        bannerData.discount > 100
      ) {
        return res.status(400).json({
          message: "Percentage discount cannot exceed 100",
        });
      }

      if (req.file) {
        const uploadResult = await uploadImageToCloudinary(req.file.buffer);

        bannerData.image = {
          url: uploadResult.url,
          altText: req.body.altText || "",
        };
      } else {
        return res.status(400).json({ message: "Banner image is required" });
      }

      const newBanner = new Banner(bannerData);
      await newBanner.save();

      return res.status(201).json({
        success: true,
        message: "Banner created successfully",
        data: newBanner,
      });
    } catch (error) {
      console.error("Error creating banner:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to create banner",
      });
    }
  }
);

router.put(
  "/admin/banners/:id",
  auth,
  adminAuth,
  upload.single("image"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid banner ID" });
      }

      const banner = await Banner.findById(id);
      if (!banner) {
        return res.status(404).json({ message: "Banner not found" });
      }

      const updateData = { ...req.body };

      const normalizeStringArray = (input) => {
        if (!input) return [];

        if (Array.isArray(input)) {
          return input
            .map((item) => String(item).trim())
            .filter(Boolean);
        }

        if (typeof input === "string") {
          try {
            const parsed = JSON.parse(input);

            if (Array.isArray(parsed)) {
              return parsed
                .map((item) => String(item).trim())
                .filter(Boolean);
            }
          } catch (err) {}

          return input
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        }

        return [];
      };

      if (!["all", "products", "category"].includes(updateData.appliesTo)) {
        updateData.appliesTo = banner.appliesTo;
      }

      if (updateData.appliesTo === "products") {
        updateData.productIds = normalizeStringArray(updateData.productIds);
        updateData.categoryIds = [];
      } else if (updateData.appliesTo === "category") {
        updateData.categoryIds = normalizeStringArray(updateData.categoryIds);
        updateData.productIds = [];
      } else {
        updateData.productIds = [];
        updateData.categoryIds = [];
      }

      if (
        updateData.appliesTo === "products" &&
        updateData.productIds.length === 0
      ) {
        return res.status(400).json({
          message: "productIds cannot be empty when appliesTo is 'products'",
        });
      }

      if (
        updateData.appliesTo === "category" &&
        updateData.categoryIds.length === 0
      ) {
        return res.status(400).json({
          message: "categoryIds cannot be empty when appliesTo is 'category'",
        });
      }

      if (updateData.discount !== undefined) {
        updateData.discount = Number(updateData.discount);
        if (Number.isNaN(updateData.discount)) {
          return res.status(400).json({ message: "Discount must be a valid number" });
        }
      }

      if (updateData.perUserLimit !== undefined) {
        updateData.perUserLimit = Number(updateData.perUserLimit);
        if (Number.isNaN(updateData.perUserLimit)) {
          return res.status(400).json({ message: "perUserLimit must be a valid number" });
        }
      }

      if (updateData.priority !== undefined) {
        updateData.priority = Number(updateData.priority);
        if (Number.isNaN(updateData.priority)) {
          return res.status(400).json({ message: "priority must be a valid number" });
        }
      }

      if (
        updateData.maxUses === "" ||
        updateData.maxUses === null ||
        updateData.maxUses === undefined
      ) {
        updateData.maxUses = null;
      } else {
        updateData.maxUses = Number(updateData.maxUses);
        if (Number.isNaN(updateData.maxUses)) {
          return res.status(400).json({ message: "maxUses must be a valid number" });
        }
      }

      if (updateData.usedCount !== undefined) {
        updateData.usedCount = Number(updateData.usedCount);
        if (Number.isNaN(updateData.usedCount)) {
          return res.status(400).json({ message: "usedCount must be a valid number" });
        }
      }

      if (updateData.isActive !== undefined) {
        updateData.isActive =
          updateData.isActive === true || updateData.isActive === "true";
      }

      if (updateData.startDate !== undefined) {
        const startDate = new Date(updateData.startDate);
        if (Number.isNaN(startDate.getTime())) {
          return res.status(400).json({ message: "Invalid startDate" });
        }
        updateData.startDate = startDate;
      }

      if (updateData.endDate !== undefined) {
        const endDate = new Date(updateData.endDate);
        if (Number.isNaN(endDate.getTime())) {
          return res.status(400).json({ message: "Invalid endDate" });
        }
        updateData.endDate = endDate;
      }

      const effectiveStartDate = updateData.startDate || banner.startDate;
      const effectiveEndDate = updateData.endDate || banner.endDate;

      if (effectiveEndDate <= effectiveStartDate) {
        return res.status(400).json({ message: "endDate must be after startDate" });
      }

      const effectiveDiscountType = updateData.discountType || banner.discountType;
      const effectiveDiscount =
        updateData.discount !== undefined ? updateData.discount : banner.discount;

      if (effectiveDiscountType === "percentage" && effectiveDiscount > 100) {
        return res.status(400).json({
          message: "Percentage discount cannot exceed 100",
        });
      }

      const existingAltText = banner.image?.altText || "";

      if (req.file) {
        const uploadResult = await uploadImageToCloudinary(req.file.buffer);

        updateData.image = {
          url: uploadResult.url,
          altText: req.body.altText || existingAltText,
        };
      } else {
        updateData.image = {
          ...(banner.image?.toObject?.() || banner.image || {}),
          altText: req.body.altText || existingAltText,
        };
      }

      const updatedBanner = await Banner.findByIdAndUpdate(
        id,
        { $set: updateData },
        {
          returnDocument: "after",
          runValidators: true,
        }
      );

      return res.status(200).json({
        success: true,
        message: "Banner updated successfully",
        data: updatedBanner,
      });
    } catch (error) {
      console.error("Error updating banner:", error);
      return res.status(400).json({
        success: false,
        message: error.message || "Failed to update banner",
      });
    }
  }
);


router.get('/admin/banners', async (req, res) => {
  try {
    // Find all banners that are not deleted and sort by priority (ascending) and then by creation date
    const banners = await Banner.find()
      .sort({ priority: 1, createdAt: -1 });

    res.status(200).json(banners);
  } catch (error) {
    console.error('Error fetching banners:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error while fetching banners', 
      error: error.message 
    });
  }
});

//just updated deletedAt time
router.delete(
  '/admin/banners/:id',
  auth,
  adminAuth,
  async (req, res) => {
    try {
      const { id } = req.params;

      // Check if the banner exists
      const banner = await Banner.findById(id);
      if (!banner) {
        return res.status(404).json({ message: 'Banner not found' });
      }

      // Update deletedAt to the current timestamp
      const updatedBanner = await Banner.findByIdAndUpdate(
        id,
        { $set: { deletedAt: new Date() } },
        { returnDocument: 'after' }
      );

      return res.status(200).json({
        success: true,
        message: 'Banner deleted successfully',
        banner: updatedBanner
      });
    } catch (error) {
      console.error('Error deleting banner:', error);
      return res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;