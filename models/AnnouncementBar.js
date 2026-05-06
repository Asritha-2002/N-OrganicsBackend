const mongoose = require("mongoose");

const announcementBarSchema = new mongoose.Schema(
  {
    // ─── Styling ─────────────────────────────────────────────────────
    backgroundColor: {
      type: String,
      default: "#457358",
      trim: true,
    },

    textColor: {
      type: String,
      default: "#ffffff",
      trim: true,
    },

    // ─── Content ─────────────────────────────────────────────────────
    sentences: {
      type: [String],
      validate: {
        validator: (arr) => arr.length > 0,
        message: "At least one sentence is required",
      },
    },

    logo: {
      url:     { type: String, default: null },
      altText: { type: String, default: ""   },
    },

    // ─── Control ─────────────────────────────────────────────────────
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const AnnouncementBar = mongoose.model("AnnouncementBar", announcementBarSchema);

module.exports = AnnouncementBar;