const express = require("express");
const Grievance = require("../models/Grievance");

const router = express.Router();
const statuses = ["Pending", "Assigned", "In Progress", "Resolved", "Rejected"];

async function countStatuses() {
  const rows = await Grievance.aggregate([
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]);
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const row of rows) counts[row._id] = row.count;
  return { total: Object.values(counts).reduce((sum, count) => sum + count, 0), ...counts };
}

router.get("/stats", async (req, res, next) => {
  try {
    return res.json({ success: true, data: await countStatuses() });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
