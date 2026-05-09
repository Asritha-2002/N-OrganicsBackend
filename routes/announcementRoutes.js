const express = require('express');
const multer = require('multer');
const AnnouncementBar = require('../models/AnnouncementBar');
const { auth, adminAuth } = require('../middleware/auth');
const { uploadImageToCloudinary } = require('../config/cloudinary');

const router = express.Router();

// Memory storage — no local disk, straight to Cloudinary
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post(
  '/admin/announcement-bar',
  auth,
  adminAuth,
  upload.single('logo'), // matches name="logo" in your form
  async (req, res) => {
    try {
      const data = { ...req.body };

      // ── sentences comes as JSON string from FormData ──
      // e.g. JSON.stringify(["Free shipping", "New arrivals"])
      if (typeof data.sentences === 'string') {
        data.sentences = JSON.parse(data.sentences);
      }

      // ── isActive boolean ──
      data.isActive = data.isActive === 'true' || data.isActive === true;

      // ── Logo upload to Cloudinary ──
      if (req.file) {
        const uploadResult = await uploadImageToCloudinary(req.file.buffer);
        data.logo = {
          url:     uploadResult.url,
          altText: data.logoAltText || '',
        };
      }
      // logo is optional — schema defaults to null if not provided
      delete data.logoAltText; // cleanup, already moved into logo object

      const bar = new AnnouncementBar(data);
      await bar.save();

      res.status(201).json(bar);
    } catch (error) {
      console.error('Error creating announcement bar:', error);
      res.status(400).json({ message: error.message });
    }
  }
);

router.get(
  '/admin/announcement-bar',
  async (req, res) => {
    try {
      const bars = await AnnouncementBar.find().sort({ createdAt: -1 });
      res.status(200).json(bars);
    } catch (error) {
      console.error('Error fetching announcement bars:', error);
      res.status(500).json({ message: error.message });
    }
  }
);

router.put(
  "/admin/announcement-bar/:id",
  auth,
  adminAuth,
  upload.single("logo"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const bar = await AnnouncementBar.findById(id);
      if (!bar) {
        return res.status(404).json({ message: "Announcement bar not found" });
      }

      const data = { ...req.body };

      if (typeof data.sentences === "string") {
        data.sentences = JSON.parse(data.sentences);
      }

      if (data.isActive !== undefined) {
        data.isActive = data.isActive === "true" || data.isActive === true;
      }

      let logoData = bar.logo;

      if (req.file) {
        const uploaded = await uploadImageToCloudinary(req.file.buffer);

        if (bar.logo?.public_id) {
          await deleteImageFromCloudinary(bar.logo.public_id);
        }

        logoData = {
          url: uploaded.url,
          public_id: uploaded.public_id,
          altText: data.logoAltText || "",
        };
      } else if (data.logoAltText !== undefined && bar.logo) {
        logoData = {
          ...bar.logo,
          altText: data.logoAltText,
        };
      }

      delete data.logoAltText;

      const updatedBar = await AnnouncementBar.findByIdAndUpdate(
        id,
        {
          ...data,
          logo: logoData,
        },
        { new: true, runValidators: true }
      );

      return res.status(200).json(updatedBar);
    } catch (error) {
      console.error("Error updating announcement bar:", error);
      return res.status(500).json({ message: error.message });
    }
  }
);
module.exports = router;