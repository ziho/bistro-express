import type { DB } from '../db/connection.js';
import type { VenueTagAliases } from '../../shared/tagManagement.js';

export function readVenueTagAliases(db: DB): VenueTagAliases {
  const rows = db.prepare('SELECT old_tag, target_tag FROM venue_tag_aliases ORDER BY old_tag').all() as { old_tag: string; target_tag: string }[];
  return Object.fromEntries(rows.map((r) => [r.old_tag, r.target_tag]));
}
