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
  '/admin/banners',
  auth,
  adminAuth,
  upload.single('image'), // Matches the name="image" file input
  async (req, res) => {
    try {
      const bannerData = { ...req.body };

      // Parse JSON elements and arrays
      if (bannerData.appliesTo === 'products' && typeof bannerData.productIds === 'string') {
        bannerData.productIds = bannerData.productIds.split(',').map((id) => new mongoose.Types.ObjectId(id.trim()));
      } else {
        bannerData.productIds = [];
      }

      if (bannerData.appliesTo === 'category' && typeof bannerData.categoryIds === 'string') {
        bannerData.categoryIds = bannerData.categoryIds.split(',').map((id) => new mongoose.Types.ObjectId(id.trim()));
      } else {
        bannerData.categoryIds = [];
      }

      // Convert number strings to proper types
      bannerData.discount = Number(bannerData.discount);
      bannerData.perUserLimit = Number(bannerData.perUserLimit);
      if (bannerData.maxUses) bannerData.maxUses = Number(bannerData.maxUses);
      
      // Convert boolean string from FormData (sent as "true" / "false") to boolean
      bannerData.isActive = bannerData.isActive === 'true' || bannerData.isActive === true;

      // Handle Image Upload
      if (req.file) {
        const uploadResult = await uploadImageToCloudinary(req.file.buffer);
        bannerData.image = {
          url: uploadResult.url,
          public_id: uploadResult.public_id,
        };
      } else {
        return res.status(400).json({ message: 'Banner image is required' });
      }

      const newBanner = new Banner(bannerData);
      await newBanner.save();

      res.status(201).json(newBanner);
    } catch (error) {
      console.error('Error creating banner:', error);
      res.status(400).json({ message: error.message });
    }
  }
);

router.put(
  '/admin/banners/:id',
  auth,
  adminAuth,
  upload.single('image'),
  async (req, res) => {
    try {
      const banner = await Banner.findById(req.params.id);
      if (!banner) {
        return res.status(404).json({ message: 'Banner not found' });
      }

      const updateData = { ...req.body };

      // Normalize appliesTo options and target IDs
      if (updateData.appliesTo === 'products' && typeof updateData.productIds === 'string') {
        updateData.productIds = updateData.productIds
          .split(',')
          .map((id) => new mongoose.Types.ObjectId(id.trim()));
      } else {
        updateData.productIds = [];
      }

      if (updateData.appliesTo === 'category' && typeof updateData.categoryIds === 'string') {
        updateData.categoryIds = updateData.categoryIds
          .split(',')
          .map((id) => new mongoose.Types.ObjectId(id.trim()));
      } else {
        updateData.categoryIds = [];
      }

      // Type castings
      updateData.discount = Number(updateData.discount);
      updateData.perUserLimit = Number(updateData.perUserLimit);
      if (updateData.maxUses) updateData.maxUses = Number(updateData.maxUses);
      updateData.isActive = updateData.isActive === 'true' || updateData.isActive === true;

      // 🔥 IMAGE HANDLING FIX
      if (req.file) {
        // New image uploaded
        const uploadResult = await uploadImageToCloudinary(req.file.buffer);

        // Optional: delete old image
        // await cloudinary.uploader.destroy(banner.image.public_id);

        updateData.image = {
          url: uploadResult.url,
          public_id: uploadResult.public_id,
        };
      } else {
        // ✅ No new image → keep old image
        updateData.image = banner.image;
      }

      const updatedBanner = await Banner.findByIdAndUpdate(
        req.params.id,
        { $set: updateData },
        { new: true, runValidators: true }
      );

      res.json(updatedBanner);
    } catch (error) {
      console.error('Error updating banner:', error);
      res.status(400).json({ message: error.message });
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