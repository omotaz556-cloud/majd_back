const allianceHelpService = require('./allianceHelp.service');

async function requestHelp(req, res) {
  try {
    const { id } = req.params;
    const { help_type: helpType, castle_id: castleId, target_id: targetId } = req.body || {};
    const helpRequest = await allianceHelpService.requestHelp(req.user._id, id, {
      helpType,
      castleId,
      targetId,
    });
    return res.status(201).json({ help_request: helpRequest });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function listOpenHelpRequests(req, res) {
  try {
    const { id } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const skip = Math.max(parseInt(req.query.skip, 10) || 0, 0);
    const helpRequests = await allianceHelpService.listOpenHelpRequests(req.user._id, id, { limit, skip });
    return res.json({ help_requests: helpRequests });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function getHelpRequest(req, res) {
  try {
    const { id, helpId } = req.params;
    const helpRequest = await allianceHelpService.getHelpRequest(req.user._id, id, helpId);
    return res.json({ help_request: helpRequest });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function giveHelp(req, res) {
  try {
    const { id, helpId } = req.params;
    const helpRequest = await allianceHelpService.giveHelp(req.user._id, id, helpId);
    return res.json({ help_request: helpRequest, remaining_seconds: helpRequest.remaining_seconds });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

async function cancelHelpRequest(req, res) {
  try {
    const { id, helpId } = req.params;
    const result = await allianceHelpService.cancelHelpRequest(req.user._id, id, helpId);
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}

module.exports = {
  requestHelp,
  listOpenHelpRequests,
  getHelpRequest,
  giveHelp,
  cancelHelpRequest,
};
