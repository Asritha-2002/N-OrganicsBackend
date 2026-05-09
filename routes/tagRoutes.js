const express = require("express");
const multer = require("multer");
const Tag = require("../models/Tag");
const { auth, adminAuth } = require("../middleware/auth");
const { uploadImageToCloudinary } = require("../config/cloudinary");

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.put(
  "/admin/tags/:key",
  auth,
  adminAuth,
  upload.single("image"),
  async (req, res) => {
    try {
      const { key } = req.params;

      const allowedKeys = ["bestseller", "new", "limited", "combo"];

      if (!allowedKeys.includes(key)) {
        return res.status(400).json({ message: "Invalid tag key" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "Tag image is required" });
      }

      const uploadResult = await uploadImageToCloudinary(req.file.buffer);

      const updatedTag = await Tag.findOneAndUpdate(
        { key },
        {
          key,
          image: {
            url: uploadResult.url,
            public_id: uploadResult.public_id,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            size: req.file.size,
            width: uploadResult.width || 0,
            height: uploadResult.height || 0,
            alt: req.body.alt || `${key} tag image`,
          },
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
        }
      );

      res.status(200).json({
        message: "Tag image saved successfully",
        data: updatedTag,
      });
    } catch (error) {
      console.error("Error saving tag image:", error);
      res.status(400).json({ message: error.message });
    }
  }
);

router.get("/admin/tags", async (req, res) => {
  try {
    const tags = await Tag.find().sort({ key: 1 });

    const formatted = {
      bestseller: null,
      new: null,
      limited: null,
      combo: null,
    };

    tags.forEach((tag) => {
      formatted[tag.key] = tag.image || null;
    });

    res.status(200).json({
      message: "Tags fetched successfully",
      data: formatted,
    });
  } catch (error) {
    console.error("Error fetching tags:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;