const User = require('../users/user.model');

// ====== Admin gameplay privileges (Unlimited Resources / Instant Build) ======
// Single source of truth for "does this user get admin-only gameplay
// privileges". Looked up strictly by the authenticated user's `role` field
// (User.role === 'admin') - never by username, email, or any other
// hardcoded identifier. Every service that needs to grant an admin
// privilege (castle, defense, repair, ...) calls this instead of
// re-implementing its own role check, so the rule lives in exactly one
// place.
//
// Accepts either a userId (string/ObjectId) - in which case it looks the
// user up - or an already-loaded user/req.user document (has `.role`
// directly), to avoid a redundant query when the caller already has it.
async function isAdmin(userIdOrUser) {
  if (!userIdOrUser) return false;

  // Already a loaded user document (e.g. req.user from auth.middleware).
  if (typeof userIdOrUser === 'object' && 'role' in userIdOrUser) {
    return userIdOrUser.role === 'admin';
  }

  const user = await User.findById(userIdOrUser).select('role');
  return user?.role === 'admin';
}

module.exports = { isAdmin };
