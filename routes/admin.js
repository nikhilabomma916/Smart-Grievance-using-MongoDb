const bcrypt = require("bcryptjs");
const express = require("express");
const mongoose = require("mongoose");
const AuditLog = require("../models/AuditLog");
const Department = require("../models/Department");
const Grievance = require("../models/Grievance");
const GrievanceHistory = require("../models/GrievanceHistory");
const User = require("../models/User");
const { requireSuperAdmin } = require("../middleware/auth");

const router = express.Router();
const statuses = ["Pending", "Assigned", "In Progress", "Resolved", "Rejected"];
const priorities = ["Low", "Medium", "High", "Urgent"];
const closedStatuses = ["Resolved", "Rejected"];
const statusTransitions = new Map([
  ["Pending", new Set(["Assigned", "In Progress", "Rejected"])],
  ["Assigned", new Set(["In Progress", "Resolved", "Rejected"])],
  ["In Progress", new Set(["Resolved", "Rejected"])]
]);
const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{10,128}$/;
const recommendedDepartments = [
  { name: "Roads and Infrastructure", aliases: ["Roads Department", "Roads and Public Works"] },
  { name: "Sanitation", aliases: ["Sanitation Department", "Garbage and Sanitation"] },
  { name: "Water Supply", aliases: ["Water Department"] },
  { name: "Electricity", aliases: ["Electricity Department"] },
  { name: "Public Health", aliases: ["Public Health Department"] },
  { name: "Parks and Forestry", aliases: ["Forestry Department", "Parks Department"] },
  { name: "Pollution Control", aliases: ["Pollution Control Department"] }
];

router.use(requireSuperAdmin);

function sendError(res, status, message) {
  return res.status(status).json({ success: false, error: message });
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pagination(query) {
  const page = Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(query.limit, 10) || 25));
  return { page, limit, skip: (page - 1) * limit };
}

function dateRange(query, res) {
  const filter = {};
  if (query.from) {
    const from = new Date(`${query.from}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.from) || Number.isNaN(from.getTime()) || from.toISOString().slice(0, 10) !== query.from) {
      sendError(res, 400, "The start date must use YYYY-MM-DD.");
      return null;
    }
    filter.$gte = from;
  }
  if (query.to) {
    const to = new Date(`${query.to}T23:59:59.999Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(query.to) || Number.isNaN(to.getTime()) || to.toISOString().slice(0, 10) !== query.to) {
      sendError(res, 400, "The end date must use YYYY-MM-DD.");
      return null;
    }
    filter.$lte = to;
  }
  if (filter.$gte && filter.$lte && filter.$gte > filter.$lte) {
    sendError(res, 400, "The start date must not be after the end date.");
    return null;
  }
  return Object.keys(filter).length ? filter : null;
}

function grievanceFilter(query, res) {
  const filter = {};
  const dateFilter = dateRange(query, res);
  if (res.headersSent) return null;
  if (dateFilter) filter.createdAt = dateFilter;
  for (const [key, allowed] of [["status", statuses], ["priority", priorities]]) {
    if (query[key] && !allowed.includes(query[key])) {
      sendError(res, 400, `Select a valid ${key}.`);
      return null;
    }
    if (query[key]) {
      filter[key] = key === "priority" && query[key] === "Medium"
        ? { $in: ["Medium", null] }
        : query[key];
    }
  }
  for (const key of ["department", "category"]) {
    if (query[key]) filter[key] = cleanString(query[key]).slice(0, 100);
  }
  if (query.escalated !== undefined && query.escalated !== "") {
    if (!["true", "false"].includes(query.escalated)) {
      sendError(res, 400, "Escalated must be true or false.");
      return null;
    }
    filter.isEscalated = query.escalated === "true";
  }
  if (query.overdue !== undefined && query.overdue !== "") {
    if (!["true", "false"].includes(query.overdue)) {
      sendError(res, 400, "Overdue must be true or false.");
      return null;
    }
    filter.$and = filter.$and || [];
    if (query.overdue === "true") {
      filter.$and.push({ slaDeadline: { $lt: new Date() } }, { status: { $nin: closedStatuses } });
    } else {
      filter.$and.push({
        $or: [
          { slaDeadline: { $gte: new Date() } },
          { slaDeadline: { $exists: false } },
          { status: { $in: closedStatuses } }
        ]
      });
    }
  }
  if (query.search) {
    const search = escapeRegex(cleanString(query.search).slice(0, 100));
    if (search) {
      filter.$or = [
        { complaintId: { $regex: search, $options: "i" } },
        { citizenName: { $regex: search, $options: "i" } },
        { title: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }
  }
  return filter;
}

async function departmentNames() {
  const [configured, grievanceDepartments, officerDepartments] = await Promise.all([
    Department.find().select("name description isActive").sort({ name: 1 }).lean(),
    Grievance.distinct("department"),
    User.distinct("department", { role: "officer" })
  ]);
  const names = new Map();
  for (const item of configured) names.set(item.name.toLocaleLowerCase(), item);
  for (const name of [...grievanceDepartments, ...officerDepartments]) {
    if (typeof name === "string" && name.trim() && !names.has(name.toLocaleLowerCase())) {
      names.set(name.toLocaleLowerCase(), {
        _id: null,
        name: name.trim(),
        description: "",
        isActive: name !== "Unassigned",
        legacy: true
      });
    }
  }
  return [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function writeAudit(req, { action, targetType, targetId, details = {} }) {
  return AuditLog.create({
    actorId: req.auth.userId || req.auth.email,
    actorName: req.auth.name,
    actorEmail: req.auth.email,
    action,
    targetType,
    targetId: String(targetId),
    details
  });
}

function safeGrievance(item) {
  return {
    ...item,
    priority: item.priority || "Medium",
    isEscalated: item.isEscalated === true,
    images: (item.images || []).map(({ imageId, mimetype, size, uploadedAt }) => ({
      imageId,
      mimetype,
      size,
      uploadedAt,
      url: `/api/grievances/${encodeURIComponent(item.complaintId)}/images/${encodeURIComponent(imageId)}`
    }))
  };
}

function resolutionHistoryStages() {
  return [
    {
      $lookup: {
        from: GrievanceHistory.collection.name,
        let: { grievanceId: "$_id" },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$grievanceId", "$$grievanceId"] },
                  { $eq: ["$newStatus", "Resolved"] }
                ]
              }
            }
          },
          { $sort: { createdAt: 1 } },
          { $limit: 1 },
          { $project: { createdAt: 1 } }
        ],
        as: "resolutionHistory"
      }
    },
    {
      $addFields: {
        resolvedAt: { $ifNull: [{ $arrayElemAt: ["$resolutionHistory.createdAt", 0] }, "$updatedAt"] }
      }
    }
  ];
}

router.get("/overview", async (req, res, next) => {
  const filter = grievanceFilter(req.query, res);
  if (!filter) {
    if (res.headersSent) return;
  }
  try {
    const now = new Date();
    const [grouped, monthly, departments, officerCount, departmentList] = await Promise.all([
      Grievance.aggregate([
        { $match: filter || {} },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
            inProgress: { $sum: { $cond: [{ $eq: ["$status", "In Progress"] }, 1, 0] } },
            resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } },
            escalated: { $sum: { $cond: [{ $eq: ["$isEscalated", true] }, 1, 0] } },
            overdue: {
              $sum: {
                $cond: [
                  { $and: [{ $lt: ["$slaDeadline", now] }, { $not: [{ $in: ["$status", closedStatuses] }] }] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]),
      Grievance.aggregate([
        { $match: { $and: [filter || {}, { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth() - 11, 1) } }] } },
        { $group: { _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } }, count: { $sum: 1 } } },
        { $sort: { "_id.year": 1, "_id.month": 1 } }
      ]),
      Grievance.aggregate([
        { $match: filter || {} },
        {
          $group: {
            _id: "$department",
            total: { $sum: 1 },
            resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } }
          }
        },
        { $sort: { total: -1, _id: 1 } },
        { $limit: 15 }
      ]),
      User.countDocuments({ role: "officer" }),
      departmentNames()
    ]);
    const [statusRows, categoryRows] = await Promise.all([
      Grievance.aggregate([{ $match: filter || {} }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
      Grievance.aggregate([{ $match: filter || {} }, { $group: { _id: "$category", count: { $sum: 1 } } }, { $sort: { count: -1 } }])
    ]);
    const stats = grouped[0] || { total: 0, pending: 0, inProgress: 0, resolved: 0, escalated: 0, overdue: 0 };
    const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const monthMap = new Map(monthly.map((item) => [`${item._id.year}-${item._id.month}`, item.count]));
    const monthlyTrends = Array.from({ length: 12 }, (_, index) => {
      const month = new Date(start.getFullYear(), start.getMonth() + index, 1);
      return {
        year: month.getFullYear(),
        month: month.getMonth() + 1,
        label: month.toLocaleString("en", { month: "short", year: "2-digit" }),
        total: monthMap.get(`${month.getFullYear()}-${month.getMonth() + 1}`) || 0
      };
    });
    return res.json({
      success: true,
      data: {
        stats: {
          total: stats.total,
          pending: stats.pending,
          inProgress: stats.inProgress,
          resolved: stats.resolved,
          escalated: stats.escalated,
          overdue: stats.overdue,
          departments: departmentList.length,
          officers: officerCount
        },
        statusDistribution: statusRows,
        departmentDistribution: departments,
        monthlyTrends,
        departmentPerformance: departments.map((item) => ({
          ...item,
          resolutionRate: item.total ? Math.round((item.resolved / item.total) * 100) : 0
        })),
        categories: categoryRows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/grievances", async (req, res, next) => {
  const filter = grievanceFilter(req.query, res);
  if (res.headersSent) return;
  const { page, limit, skip } = pagination(req.query);
  const sortBy = ["createdAt", "updatedAt", "status", "priority", "department", "category", "citizenName", "title", "complaintId"].includes(req.query.sort)
    ? req.query.sort
    : "createdAt";
  const sortDirection = req.query.direction === "asc" ? 1 : -1;
  try {
    const [records, total] = await Promise.all([
      Grievance.find(filter).sort({ [sortBy]: sortDirection, _id: -1 }).skip(skip).limit(limit).lean(),
      Grievance.countDocuments(filter)
    ]);
    return res.json({
      success: true,
      data: { items: records.map(safeGrievance), page, limit, total, pages: Math.ceil(total / limit) }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/grievances/:id", async (req, res, next) => {
  try {
    const grievance = mongoose.isValidObjectId(req.params.id)
      ? await Grievance.findById(req.params.id).select("+adminNotes").lean()
      : await Grievance.findOne({ complaintId: req.params.id.toUpperCase() }).select("+adminNotes").lean();
    if (!grievance) return sendError(res, 404, "Grievance was not found.");
    const [history, assignmentHistory] = await Promise.all([
      GrievanceHistory.find({ grievanceId: grievance._id }).sort({ createdAt: 1 }).lean(),
      AuditLog.find({ targetType: "grievance", targetId: grievance._id.toString() })
        .sort({ createdAt: -1 }).limit(100).lean()
    ]);
    return res.json({
      success: true,
      data: { ...safeGrievance(grievance), history, assignmentHistory }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/grievances/:id", async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "A valid grievance record ID is required.");
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const allowed = new Set(["department", "assignedOfficerId", "status", "priority", "isEscalated", "note", "resolutionRemarks"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return sendError(res, 400, "The update contains unsupported fields.");
  const department = body.department === undefined ? undefined : cleanString(body.department);
  const officerId = body.assignedOfficerId === undefined ? undefined : cleanString(body.assignedOfficerId);
  const status = body.status === undefined ? undefined : cleanString(body.status);
  const priority = body.priority === undefined ? undefined : cleanString(body.priority);
  const note = body.note === undefined ? "" : cleanString(body.note);
  if (department !== undefined && (!department || department.length > 100)) return sendError(res, 400, "Enter a valid department.");
  if (officerId !== undefined && officerId && !mongoose.isValidObjectId(officerId)) return sendError(res, 400, "Select a valid officer.");
  if (status !== undefined && !statuses.includes(status)) return sendError(res, 400, "Select a valid grievance status.");
  if (priority !== undefined && !priorities.includes(priority)) return sendError(res, 400, "Select a valid priority.");
  if (body.isEscalated !== undefined && typeof body.isEscalated !== "boolean") return sendError(res, 400, "Escalation must be true or false.");
  if (note.length > 2000) return sendError(res, 400, "Administrative notes must be no more than 2000 characters.");
  try {
    const grievance = await Grievance.findById(req.params.id).select("+adminNotes");
    if (!grievance) return sendError(res, 404, "Grievance was not found.");
    const previous = {
      department: grievance.department,
      assignedOfficerId: grievance.assignedOfficerId?.toString() || null,
      assignedOfficerName: grievance.assignedOfficerName || null,
      status: grievance.status,
      priority: grievance.priority || "Medium",
      isEscalated: grievance.isEscalated === true
    };
    const nextDepartment = department ?? grievance.department;
    if (department !== undefined) {
      const names = await departmentNames();
      const selectedDepartment = names.find((item) => item.name === department);
      if (!selectedDepartment) {
        return sendError(res, 400, "Select an existing active department.");
      }
      if (!selectedDepartment.isActive && department !== grievance.department) return sendError(res, 409, "Activate this department before assigning grievances to it.");
      grievance.department = department;
    }
    if (officerId !== undefined || department !== undefined) {
      const nextOfficerId = officerId === undefined ? previous.assignedOfficerId : (officerId || null);
      if (nextOfficerId) {
        const officer = await User.findOne({ _id: nextOfficerId, role: "officer", isActive: true })
          .select("name department").lean();
        if (!officer) return sendError(res, 400, "Select an active officer account.");
        if (officer.department !== nextDepartment) return sendError(res, 400, "The assigned officer must belong to the grievance department.");
        grievance.assignedOfficerId = officer._id;
        grievance.assignedOfficerName = officer.name;
      } else {
        grievance.assignedOfficerId = null;
        grievance.assignedOfficerName = undefined;
      }
    }
    const assignmentChanged =
      previous.department !== grievance.department ||
      previous.assignedOfficerId !== (grievance.assignedOfficerId?.toString() || null);
    if (assignmentChanged && previous.status === "Pending") grievance.status = "Assigned";
    if (status !== undefined && status !== previous.status) {
      if (closedStatuses.includes(previous.status) || !statusTransitions.get(previous.status)?.has(status)) {
        return sendError(res, 409, `Status cannot change from ${previous.status} to ${status}.`);
      }
      if (status === "Resolved" && !cleanString(body.resolutionRemarks)) {
        return sendError(res, 400, "Add resolution remarks before marking the grievance resolved.");
      }
      grievance.status = status;
      if (status === "Resolved") grievance.officerRemarks = cleanString(body.resolutionRemarks);
    }
    if (priority !== undefined) grievance.priority = priority;
    if (body.isEscalated !== undefined) grievance.isEscalated = body.isEscalated;
    if (note) {
      grievance.adminNotes.push({
        authorId: null,
        authorName: req.auth.name,
        message: note
      });
    }
    await grievance.save();
    if (previous.status !== grievance.status) {
      await GrievanceHistory.create({
        grievanceId: grievance._id,
        complaintId: grievance.complaintId,
        previousStatus: previous.status,
        newStatus: grievance.status,
        updatedBy: null,
        updaterName: req.auth.name,
        remarks: status === "Resolved" ? cleanString(body.resolutionRemarks) : "Status updated by Super Admin."
      });
    }
    const changes = {};
    for (const key of ["department", "assignedOfficerId", "assignedOfficerName", "status", "priority", "isEscalated"]) {
      const oldValue = key === "assignedOfficerId" ? previous.assignedOfficerId : key === "assignedOfficerName" ? previous.assignedOfficerName : previous[key];
      const newValue = key === "assignedOfficerId" ? grievance.assignedOfficerId?.toString() || null : grievance[key];
      if (String(oldValue ?? "") !== String(newValue ?? "")) changes[key] = { from: oldValue ?? null, to: newValue ?? null };
    }
    if (note) changes.noteAdded = true;
    if (Object.keys(changes).length) {
      const action = ["department", "assignedOfficerId", "assignedOfficerName"].some((key) => Object.hasOwn(changes, key))
        ? "grievance.assignment_changed"
        : Object.hasOwn(changes, "status")
          ? "grievance.status_changed"
          : Object.hasOwn(changes, "priority")
            ? "grievance.priority_changed"
            : Object.hasOwn(changes, "isEscalated")
              ? "grievance.escalation_changed"
              : "grievance.note_added";
      await writeAudit(req, { action, targetType: "grievance", targetId: grievance._id, details: changes });
    }
    return res.json({ success: true, data: safeGrievance(grievance.toObject()) });
  } catch (error) {
    if (error.name === "ValidationError") return sendError(res, 400, "The grievance update is invalid.");
    return next(error);
  }
});

router.get("/departments", async (req, res, next) => {
  try {
    const [items, stats, officers] = await Promise.all([
      departmentNames(),
      Grievance.aggregate([
        { $group: {
          _id: "$department",
          total: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ["$status", "In Progress"] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ["$slaDeadline", new Date()] }, { $not: [{ $in: ["$status", closedStatuses] }] }] }, 1, 0] } }
        } }
      ]),
      User.aggregate([
        { $match: { role: "officer" } },
        { $group: { _id: "$department", count: { $sum: 1 } } }
      ])
    ]);
    const statsMap = new Map(stats.map((item) => [item._id, item]));
    const officerMap = new Map(officers.map((item) => [item._id, item.count]));
    const data = items.map((item) => {
      const summary = statsMap.get(item.name) || { total: 0, pending: 0, inProgress: 0, resolved: 0, overdue: 0 };
      return {
        ...item,
        officerCount: officerMap.get(item.name) || 0,
        ...summary,
        resolutionRate: summary.total ? Math.round((summary.resolved / summary.total) * 100) : 0
      };
    });
    return res.json({ success: true, data });
  } catch (error) {
    return next(error);
  }
});

router.post("/departments/recommended", async (req, res, next) => {
  try {
    const known = await departmentNames();
    const knownNames = new Set(known.map((item) => item.name.toLocaleLowerCase()));
    const added = [];
    const unchanged = [];
    for (const suggestion of recommendedDepartments) {
      if ([suggestion.name, ...suggestion.aliases].some((name) => knownNames.has(name.toLocaleLowerCase()))) {
        unchanged.push(suggestion.name);
        continue;
      }
      const department = await Department.create({
        name: suggestion.name,
        description: `${suggestion.name} service requests and departmental operations.`
      });
      await writeAudit(req, {
        action: "department.created",
        targetType: "department",
        targetId: department._id,
        details: { name: department.name, source: "recommended department setup" }
      });
      knownNames.add(department.name.toLocaleLowerCase());
      added.push(department.name);
    }
    return res.json({ success: true, data: { added, unchanged } });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, "A recommended department already exists; refresh and try again.");
    return next(error);
  }
});

router.post("/departments", async (req, res, next) => {
  const name = cleanString(req.body?.name);
  const description = cleanString(req.body?.description);
  const isActive = req.body?.isActive === undefined ? true : req.body.isActive;
  if (name.length < 2 || name.length > 100 || name.toLocaleLowerCase() === "unassigned") {
    return sendError(res, 400, "Department names must be 2–100 characters and cannot use the reserved Unassigned name.");
  }
  if (description.length > 500) return sendError(res, 400, "Department descriptions must be no more than 500 characters.");
  if (typeof isActive !== "boolean") return sendError(res, 400, "Department status must be active or inactive.");
  try {
    const known = await departmentNames();
    if (known.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      return sendError(res, 409, "A department with this name already exists.");
    }
    const department = await Department.create({ name, description, isActive });
    await writeAudit(req, { action: "department.created", targetType: "department", targetId: department._id, details: { name } });
    return res.status(201).json({ success: true, data: department });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, "A department with this name already exists.");
    return next(error);
  }
});

router.patch("/departments/by-name/:name", async (req, res, next) => {
  const oldName = cleanString(req.params.name);
  const newName = req.body?.name === undefined ? oldName : cleanString(req.body.name);
  const description = req.body?.description === undefined ? undefined : cleanString(req.body.description);
  const isActive = req.body?.isActive;
  if (newName.length < 2 || newName.length > 100) return sendError(res, 400, "Department names must be 2–100 characters.");
  if (description !== undefined && description.length > 500) return sendError(res, 400, "Department descriptions must be no more than 500 characters.");
  if (isActive !== undefined && typeof isActive !== "boolean") return sendError(res, 400, "Department status must be active or inactive.");
  try {
    const names = await departmentNames();
    const existingName = names.find((item) => item.name.toLocaleLowerCase() === oldName.toLocaleLowerCase());
    if (!existingName) return sendError(res, 404, "Department was not found.");
    if (existingName.name === "Unassigned" && (newName !== oldName || isActive !== undefined)) {
      return sendError(res, 400, "Unassigned is a system queue and cannot be renamed or activated.");
    }
    if (newName.toLocaleLowerCase() !== oldName.toLocaleLowerCase() &&
        names.some((item) => item.name.toLocaleLowerCase() === newName.toLocaleLowerCase())) {
      return sendError(res, 409, "A department with this name already exists.");
    }
    if (isActive === false && await User.exists({ role: "officer", department: oldName, isActive: true })) {
      return sendError(res, 409, "Move or deactivate this department’s officers before deactivating it.");
    }
    let department = await Department.findOne({ name: existingName.name });
    if (!department) department = new Department({ name: existingName.name });
    const changes = { name: { from: department.name, to: newName } };
    if (description !== undefined) {
      changes.description = { from: department.description || "", to: description };
      department.description = description;
    }
    if (isActive !== undefined) {
      changes.isActive = { from: department.isActive, to: isActive };
      department.isActive = isActive;
    }
    department.name = newName;
    await department.save();
    if (newName !== existingName.name) {
      await Promise.all([
        User.updateMany({ role: "officer", department: existingName.name }, { $set: { department: newName } }),
        Grievance.updateMany({ department: existingName.name }, { $set: { department: newName } })
      ]);
    }
    await writeAudit(req, { action: "department.updated", targetType: "department", targetId: department._id, details: changes });
    return res.json({ success: true, data: department });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, "A department with this name already exists.");
    if (error.name === "ValidationError") return sendError(res, 400, "The department details are invalid.");
    return next(error);
  }
});

router.get("/officers", async (req, res, next) => {
  const { page, limit, skip } = pagination(req.query);
  const filter = { role: "officer" };
  if (req.query.department) filter.department = cleanString(req.query.department).slice(0, 100);
  if (req.query.active === "true") filter.isActive = true;
  if (req.query.active === "false") filter.isActive = false;
  if (req.query.search) {
    const search = new RegExp(escapeRegex(cleanString(req.query.search).slice(0, 100)), "i");
    filter.$or = [{ name: search }, { email: search }, { department: search }];
  }
  try {
    const [users, total, workload] = await Promise.all([
      User.find(filter).select("name email department specialization isActive createdAt").sort({ name: 1 })
        .skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
      Grievance.aggregate([
        { $match: { assignedOfficerId: { $ne: null } } },
        { $group: {
          _id: "$assignedOfficerId",
          assigned: { $sum: 1 },
          pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ["$status", "In Progress"] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ["$slaDeadline", new Date()] }, { $not: [{ $in: ["$status", closedStatuses] }] }] }, 1, 0] } }
        } }
      ])
    ]);
    const workMap = new Map(workload.map((item) => [item._id.toString(), item]));
    const items = users.map((user) => ({
      ...user,
      workload: workMap.get(user._id.toString()) || { assigned: 0, pending: 0, inProgress: 0, resolved: 0, overdue: 0 }
    }));
    return res.json({ success: true, data: { items, page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
});

router.get("/officers/:id", async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "A valid officer ID is required.");
  try {
    const officer = await User.findOne({ _id: req.params.id, role: "officer" })
      .select("name email department specialization isActive createdAt").lean();
    if (!officer) return sendError(res, 404, "Officer account was not found.");
    return res.json({ success: true, data: officer });
  } catch (error) {
    return next(error);
  }
});

router.post("/officers", async (req, res, next) => {
  const name = cleanString(req.body?.name);
  const email = cleanString(req.body?.email).toLowerCase();
  const department = cleanString(req.body?.department);
  const specialization = cleanString(req.body?.specialization);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (name.length < 2 || name.length > 100) return sendError(res, 400, "Officer names must be 2–100 characters.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return sendError(res, 400, "Enter a valid email address.");
  if (!passwordPattern.test(password)) return sendError(res, 400, "Use a password of 10–128 characters with uppercase, lowercase, number, and symbol.");
  if (!department || department.length > 100) return sendError(res, 400, "Select a valid department.");
  if (specialization.length > 100) return sendError(res, 400, "Specialization must be no more than 100 characters.");
  try {
    const departmentRecord = await Department.findOne({ name: department }).select("isActive").lean();
    const availableNames = await departmentNames();
    const selectedDepartment = availableNames.find((item) => item.name === department);
    if (!selectedDepartment || !selectedDepartment.isActive || departmentRecord?.isActive === false) {
      return sendError(res, 400, "Select an active department.");
    }
    if (process.env.ADMIN_EMAIL && email === process.env.ADMIN_EMAIL.trim().toLowerCase()) {
      return sendError(res, 409, "This email address is reserved for the configured Super Admin.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const officer = await User.create({ name, email, passwordHash, role: "officer", department, specialization, isActive: true });
    await writeAudit(req, { action: "officer.created", targetType: "officer", targetId: officer._id, details: { email, department } });
    return res.status(201).json({
      success: true,
      data: { _id: officer._id, name: officer.name, email: officer.email, department: officer.department, specialization: officer.specialization, isActive: officer.isActive }
    });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 409, "An account with this email address already exists.");
    if (error.name === "ValidationError") return sendError(res, 400, "The officer details are invalid.");
    return next(error);
  }
});

router.patch("/officers/:id", async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 400, "A valid officer ID is required.");
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const allowed = new Set(["name", "department", "specialization", "isActive", "password"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return sendError(res, 400, "The update contains unsupported fields.");
  try {
    const officer = await User.findOne({ _id: req.params.id, role: "officer" });
    if (!officer) return sendError(res, 404, "Officer account was not found.");
    const previous = { name: officer.name, department: officer.department, specialization: officer.specialization, isActive: officer.isActive };
    if (body.name !== undefined) {
      const name = cleanString(body.name);
      if (name.length < 2 || name.length > 100) return sendError(res, 400, "Officer names must be 2–100 characters.");
      officer.name = name;
    }
    if (body.specialization !== undefined) {
      const specialization = cleanString(body.specialization);
      if (specialization.length > 100) return sendError(res, 400, "Specialization must be no more than 100 characters.");
      officer.specialization = specialization;
    }
    if (body.department !== undefined) {
      const department = cleanString(body.department);
      const departmentRecord = await Department.findOne({ name: department }).select("isActive").lean();
      const names = await departmentNames();
      const selectedDepartment = names.find((item) => item.name === department);
      if (!selectedDepartment || !selectedDepartment.isActive || departmentRecord?.isActive === false) {
        return sendError(res, 400, "Select an active department.");
      }
      officer.department = department;
    }
    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") return sendError(res, 400, "Account status must be active or inactive.");
      officer.isActive = body.isActive;
    }
    if (body.password !== undefined) {
      if (typeof body.password !== "string" || !passwordPattern.test(body.password)) {
        return sendError(res, 400, "Use a password of 10–128 characters with uppercase, lowercase, number, and symbol.");
      }
      officer.passwordHash = await bcrypt.hash(body.password, 12);
    }
    const departmentChanged = previous.department !== officer.department;
    let unassignedGrievances = [];
    if (departmentChanged || !officer.isActive) {
      const activeFilter = { assignedOfficerId: officer._id, status: { $nin: closedStatuses } };
      unassignedGrievances = await Grievance.find(activeFilter)
        .select("_id complaintId department assignedOfficerName").lean();
      await Grievance.updateMany(activeFilter, {
        $set: { assignedOfficerId: null },
        $unset: { assignedOfficerName: "" }
      });
    }
    await officer.save();
    const changes = {};
    for (const key of ["name", "department", "specialization", "isActive"]) {
      if (previous[key] !== officer[key]) changes[key] = { from: previous[key], to: officer[key] };
    }
    if (body.password !== undefined) changes.passwordReset = true;
    if (unassignedGrievances.length) changes.openGrievancesUnassigned = unassignedGrievances.length;
    if (Object.keys(changes).length) {
      const action = departmentChanged
        ? "officer.department_changed"
        : previous.isActive !== officer.isActive
          ? officer.isActive ? "officer.activated" : "officer.deactivated"
          : "officer.updated";
      await writeAudit(req, {
        action,
        targetType: "officer",
        targetId: officer._id,
        details: changes
      });
    }
    if (unassignedGrievances.length) {
      await AuditLog.insertMany(unassignedGrievances.map((item) => ({
        actorId: req.auth.userId || req.auth.email,
        actorName: req.auth.name,
        actorEmail: req.auth.email,
        action: "grievance.assignment_changed",
        targetType: "grievance",
        targetId: item._id.toString(),
        details: {
          department: item.department,
          assignedOfficerId: { from: officer._id.toString(), to: null },
          assignedOfficerName: { from: item.assignedOfficerName || officer.name, to: null },
          reason: "Officer department changed or account deactivated."
        }
      })));
    }
    return res.json({
      success: true,
      data: { _id: officer._id, name: officer.name, email: officer.email, department: officer.department, specialization: officer.specialization, isActive: officer.isActive }
    });
  } catch (error) {
    if (error.name === "ValidationError") return sendError(res, 400, "The officer details are invalid.");
    return next(error);
  }
});

router.get("/reports", async (req, res, next) => {
  const filter = grievanceFilter(req.query, res);
  if (res.headersSent) return;
  try {
    const [departments, officers, monthly, yearly] = await Promise.all([
      Grievance.aggregate([
        { $match: filter },
        ...resolutionHistoryStages(),
        { $group: {
          _id: "$department",
          total: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ["$status", "Pending"] }, 1, 0] } },
          escalated: { $sum: { $cond: [{ $eq: ["$isEscalated", true] }, 1, 0] } },
          resolutionMillis: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, { $subtract: ["$resolvedAt", "$createdAt"] }, 0] } }
        } },
        { $sort: { total: -1, _id: 1 } }
      ]),
      Grievance.aggregate([
        { $match: { ...filter, assignedOfficerId: { $ne: null } } },
        ...resolutionHistoryStages(),
        { $group: {
          _id: "$assignedOfficerId",
          assigned: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } },
          overdue: { $sum: { $cond: [{ $and: [{ $lt: ["$slaDeadline", new Date()] }, { $not: [{ $in: ["$status", closedStatuses] }] }] }, 1, 0] } },
          resolutionMillis: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, { $subtract: ["$resolvedAt", "$createdAt"] }, 0] } }
        } },
        { $sort: { resolved: -1, assigned: -1 } },
        { $limit: 100 }
      ]),
      Grievance.aggregate([
        { $match: filter },
        { $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          total: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } }
        } },
        { $sort: { "_id.year": 1, "_id.month": 1 } }
      ]),
      Grievance.aggregate([
        { $match: filter },
        { $group: {
          _id: { year: { $year: "$createdAt" } },
          total: { $sum: 1 },
          resolved: { $sum: { $cond: [{ $eq: ["$status", "Resolved"] }, 1, 0] } }
        } },
        { $sort: { "_id.year": 1 } }
      ])
    ]);
    const officerIds = officers.map((item) => item._id);
    const officerUsers = await User.find({ _id: { $in: officerIds } }).select("name email department").lean();
    const userMap = new Map(officerUsers.map((item) => [item._id.toString(), item]));
    const [overdue, escalated] = await Promise.all([
      Grievance.find({
        $and: [
          filter || {},
          { slaDeadline: { $lt: new Date() } },
          { status: { $nin: closedStatuses } }
        ]
      }).sort({ slaDeadline: 1 }).limit(100).select("complaintId title department assignedOfficerName slaDeadline status").lean(),
      Grievance.find({ $and: [filter || {}, { isEscalated: true }] })
        .sort({ updatedAt: -1 }).limit(100).select("complaintId title department assignedOfficerName priority status").lean()
    ]);
    return res.json({
      success: true,
      data: {
        departments: departments.map((item) => ({
          ...item,
          resolutionRate: item.total ? Math.round(item.resolved / item.total * 100) : 0,
          averageResolutionDays: item.resolved ? Math.round(item.resolutionMillis / item.resolved / 86400000 * 10) / 10 : 0
        })),
        officers: officers.map((item) => ({
          ...item,
          officer: userMap.get(item._id.toString()) || null,
          resolutionRate: item.assigned ? Math.round(item.resolved / item.assigned * 100) : 0,
          averageResolutionDays: item.resolved ? Math.round(item.resolutionMillis / item.resolved / 86400000 * 10) / 10 : 0
        })),
        monthly: monthly || [],
        yearly,
        overdue,
        escalated
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/audit-logs", async (req, res, next) => {
  const { page, limit, skip } = pagination(req.query);
  const filter = {};
  if (req.query.action) filter.action = cleanString(req.query.action).slice(0, 80);
  if (req.query.targetType && ["department", "officer", "grievance", "account"].includes(req.query.targetType)) {
    filter.targetType = req.query.targetType;
  }
  try {
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter)
    ]);
    return res.json({ success: true, data: { items, page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
