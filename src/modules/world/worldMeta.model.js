const mongoose = require('mongoose');

// ====== NEW: single-document collection tracking whether the world has
// already been initialized. Always the same _id ('world') so the whole
// collection ever holds exactly one document - reading/writing it is one
// findOne/findOneAndUpdate, no extra queries. This is what lets server
// startup print "World already initialized." vs "Generating world..."
// without scanning every region. ======
const worldMetaSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'world' },
    // 'generating' | 'ready' | 'failed'
    status: { type: String, default: 'failed', index: true },
    initialized_radius_regions: { type: Number, default: 0 },
    total_npc_castles_created: { type: Number, default: 0 },
    total_world_objects_created: { type: Number, default: 0 },
    started_at: { type: Date, default: null },
    finished_at: { type: Date, default: null },
    last_error: { type: String, default: null },
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

module.exports = mongoose.model('WorldMeta', worldMetaSchema);
