const allianceMailService = require('./allianceMail.service');

// ====================== Alliance Mail ======================

async function sendMail(req, res) {
  try {
    const { id } = req.params;
    const { title, body } = req.body || {};
    const mail = await allianceMailService.sendMail(req.user._id, id, { title, body });
    return res.status(201).json({ mail });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listMail(req, res) {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const mail = await allianceMailService.listMail(req.user._id, id, { limit, skip });
    return res.json({ mail });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function getUnreadMailCount(req, res) {
  try {
    const { id } = req.params;
    const count = await allianceMailService.getUnreadMailCount(req.user._id, id);
    return res.json({ unread_count: count });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function markMailRead(req, res) {
  try {
    const { id, mailId } = req.params;
    const result = await allianceMailService.markMailRead(req.user._id, id, mailId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function markAllMailRead(req, res) {
  try {
    const { id } = req.params;
    const result = await allianceMailService.markAllMailRead(req.user._id, id);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

// ====================== Alliance Announcements ======================

async function publishAnnouncement(req, res) {
  try {
    const { id } = req.params;
    const { body } = req.body || {};
    const announcement = await allianceMailService.publishAnnouncement(req.user._id, id, { body });
    return res.status(201).json({ announcement });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function getCurrentAnnouncement(req, res) {
  try {
    const { id } = req.params;
    const announcement = await allianceMailService.getCurrentAnnouncement(req.user._id, id);
    return res.json({ announcement });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listAnnouncementHistory(req, res) {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const announcements = await allianceMailService.listAnnouncementHistory(req.user._id, id, { limit, skip });
    return res.json({ announcements });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  sendMail,
  listMail,
  getUnreadMailCount,
  markMailRead,
  markAllMailRead,
  publishAnnouncement,
  getCurrentAnnouncement,
  listAnnouncementHistory,
};
