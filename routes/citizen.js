const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Grievance = require("../models/Grievance");
const GrievanceHistory = require("../models/GrievanceHistory");
const { requireRole } = require("../middleware/auth");

const router = express.Router();

router.get("/dashboard", requireRole("citizen"), async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.auth.userId)) {
    return res.status(401).json({ success: false, error: "Citizen session is no longer valid." });
  }

  try {
    const user = await User.findById(req.auth.userId).select("name email dateOfBirth role isActive");
    if (!user || user.role !== "citizen" || !user.isActive) {
      return res.status(401).json({ success: false, error: "Citizen account was not found." });
    }
    const records = await Grievance.find({ citizenId: user._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    const histories = await GrievanceHistory.find({
      grievanceId: { $in: records.map((item) => item._id) }
    }).sort({ createdAt: 1 }).lean();
    const historyByGrievance = new Map();
    for (const history of histories) {
      const key = history.grievanceId.toString();
      if (!historyByGrievance.has(key)) historyByGrievance.set(key, []);
      historyByGrievance.get(key).push(history);
    }
    const grievances = records.map((item) => ({
      ...item,
      images: (item.images || []).map(({ imageId, mimetype, size, uploadedAt }) => ({
        imageId,
        mimetype,
        size,
        uploadedAt,
        url: `/api/grievances/${encodeURIComponent(item.complaintId)}/images/${encodeURIComponent(imageId)}`
      })),
      history: historyByGrievance.get(item._id.toString()) || []
    }));
    const stats = { total: grievances.length, Pending: 0, Assigned: 0, "In Progress": 0, Resolved: 0 };
    for (const grievance of grievances) {
      if (Object.hasOwn(stats, grievance.status)) stats[grievance.status] += 1;
    }
    return res.json({
      success: true,
      data: {
        citizen: { name: user.name, email: user.email, age: user.age },
        stats,
        grievances
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
