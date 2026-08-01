// ====== Public exports for the Battle Resolution Core module ======
// Not required anywhere yet (module is standalone in this step) — this
// just gives a future consumer a single, clean import path.

'use strict';

const { resolveBattle } = require('./battleResolutionEngine');

module.exports = {
  resolveBattle,
};
