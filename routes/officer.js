const express = require("express");
const mongoose = require("mongoose");
const Grievance = require("../models/Grievance");
const GrievanceHistory = require("../models/GrievanceHistory");
const { requireRole } = require("../middleware/auth");
const { isAuthorizedDepartment, officerGrievanceScope } = require("../middleware/grievanceAccess");

const router = express.Router();
const officerStatuses = new Set(["Assigned", "In Progress", "Resolved"]);
const allStatuses = ["Pending", "Assigned", "In Progress", "Resolved", "Rejected"];
const transitions = new Map([
  ["Pending", new Set(["Assigned", "In Progress"])],
  ["Assigned", new Set(["In Progress", "Resolved"])],
  ["In Progress", new Set(["Resolved"])]
]);

function responseError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

router.use(requireRole("officer"));

router.get("/grievances/stats", async (req, res, next) => {
  try {
    const scope = officerGrievanceScope(req.auth);
    const grouped = await Grievance.aggregate([
      { $match: scope },
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);
    const counts = Object.fromEntries(allStatuses.map((status) => [status, 0]));
    for (const row of grouped) counts[row._id] = row.count;
    return res.json({
      success: true,
      data: {
        department: req.auth.department,
        total: Object.values(counts).reduce((sum, count) => sum + count, 0),
        ...counts
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/grievances", async (req, res, next) => {
  try {
    const records = await Grievance.find(officerGrievanceScope(req.auth))
      .sort({ createdAt: -1 }).limit(500).lean();
    const histories = await GrievanceHistory.find({
      grievanceId: { $in: records.map((item) => item._id) }
    }).sort({ createdAt: 1 }).lean();
    const historyByGrievance = new Map();
    for (const history of histories) {
      const key = history.grievanceId.toString();
      if (!historyByGrievance.has(key)) historyByGrievance.set(key, []);
      historyByGrievance.get(key).push(history);
    }
    const data = records.map((record) => ({
      ...record,
      images: (record.images || []).map(({ imageId, mimetype, size, uploadedAt }) => ({
        imageId,
        mimetype,
        size,
        uploadedAt,
        url: `/api/grievances/${encodeURIComponent(record.complaintId)}/images/${encodeURIComponent(imageId)}`
      })),
      history: historyByGrievance.get(record._id.toString()) || []
    }));
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post("/grievances/:id/accept", async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return responseError(res, 400, "A valid grievance ID is required.");
  try {
    const grievance = await Grievance.findById(req.params.id);
    if (!grievance || !isAuthorizedDepartment(req.auth, grievance.department)) {
      return responseError(res, 404, "Grievance was not found in your authorized department.");
    }
    if (grievance.assignedOfficerId && req.auth.userId &&
        grievance.assignedOfficerId.toString() !== req.auth.userId) {
      return responseError(res, 409, "This grievance is already assigned to another officer.");
    }
    if (["Resolved", "Rejected"].includes(grievance.status)) {
      return responseError(res, 409, "This grievance is already closed.");
    }
    const previousStatus = grievance.status;
    grievance.status = "Assigned";
    if (req.auth.userId) {
      grievance.assignedOfficerId = req.auth.userId;
      grievance.assignedOfficerName = req.auth.name;
    }
    await grievance.save();
    if (previousStatus !== grievance.status) {
      await GrievanceHistory.create({
        grievanceId: grievance._id,
        complaintId: grievance.complaintId,
        previousStatus,
        newStatus: grievance.status,
        updatedBy: mongoose.isValidObjectId(req.auth.userId) ? req.auth.userId : null,
        updaterName: req.auth.name || req.auth.email,
        remarks: "Officer accepted the grievance."
      });
    }
    return res.json({ success: true, data: grievance });
  } catch (error) {
    return next(error);
  }
});

router.patch("/grievances/:id/status", async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return responseError(res, 400, "A valid grievance ID is required.");
  const status = typeof req.body?.status === "string" ? req.body.status.trim() : "";
  const remarks = typeof req.body?.remarks === "string" ? req.body.remarks.trim() : "";
  if (!officerStatuses.has(status)) return responseError(res, 400, "Choose Assigned, In Progress, or Resolved.");
  if (remarks.length > 2000) return responseError(res, 400, "Remarks must be no more than 2000 characters.");
  try {
    const grievance = await Grievance.findOne({
      _id: req.params.id,
      ...officerGrievanceScope(req.auth)
    });
    if (!grievance) return responseError(res, 404, "Grievance was not found in your authorized department.");
    if (["Resolved", "Rejected"].includes(grievance.status)) {
      return responseError(res, 409, "A closed grievance cannot be updated.");
    }
    if (grievance.status === status) return res.json({ success: true, data: grievance });
    if (!transitions.get(grievance.status)?.has(status)) {
      return responseError(res, 409, `Status cannot change from ${grievance.status} to ${status}.`);
    }
    if (status === "Resolved" && !remarks) {
      return responseError(res, 400, "Add resolution remarks before marking the grievance resolved.");
    }
    const previousStatus = grievance.status;
    grievance.status = status;
    grievance.officerRemarks = remarks || grievance.officerRemarks;
    if (req.auth.userId) {
      grievance.assignedOfficerId = req.auth.userId;
      grievance.assignedOfficerName = req.auth.name;
    }
    await grievance.save();
    await GrievanceHistory.create({
      grievanceId: grievance._id,
      complaintId: grievance.complaintId,
      previousStatus,
      newStatus: status,
      updatedBy: mongoose.isValidObjectId(req.auth.userId) ? req.auth.userId : null,
      updaterName: req.auth.name || req.auth.email,
      remarks
    });
    return res.json({ success: true, data: grievance });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
