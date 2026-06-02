/*
 * Activity-log humanizer.
 *
 * The autoLogMiddleware stores raw (method, path, action) tuples — too
 * cryptic for a human reading the log ("PATCH /api/guides/e44ba…"). This
 * file turns them into one-line English sentences like
 * "edited a guide" or "synced Infloww tracking links".
 *
 * Matching is first-rule-wins. If nothing matches we fall back to the
 * generic `${action}` (created/updated/deleted) so the worst case is the
 * same as today.
 *
 * Adding a new route: append a rule. The rules are intentionally hand-
 * maintained instead of auto-generated so we control the wording.
 */

const RULES = [
  // ----- Landings -----
  { m: 'POST',   re: /^\/api\/landings\/?$/,                              text: 'created a landing page' },
  { m: 'PATCH',  re: /^\/api\/landings\/[^/]+$/,                          text: 'updated a landing page' },
  { m: 'DELETE', re: /^\/api\/landings\/[^/]+$/,                          text: 'deleted a landing page' },
  { m: 'POST',   re: /^\/api\/landings\/[^/]+\/avatar$/,                  text: 'uploaded a landing avatar' },
  { m: 'POST',   re: /^\/api\/landings\/[^/]+\/background$/,              text: 'uploaded a landing background' },
  { m: 'POST',   re: /^\/api\/landings\/[^/]+\/links$/,                   text: 'added a link to a landing' },
  { m: 'POST',   re: /^\/api\/landings\/[^/]+\/links\/reorder$/,          text: 'reordered landing links' },
  { m: 'PATCH',  re: /^\/api\/landings\/links\/[^/]+$/,                   text: 'edited a landing link' },
  { m: 'DELETE', re: /^\/api\/landings\/links\/[^/]+$/,                   text: 'removed a landing link' },

  // ----- Infloww -----
  { m: 'POST',   re: /^\/api\/infloww\/sync$/,                            text: 'synced Infloww tracking links' },
  { m: 'POST',   re: /^\/api\/infloww\/bind$/,                            text: 'bound a landing link to an Infloww link' },
  { m: 'PATCH',  re: /^\/api\/infloww\/links\/[^/]+$/,                    text: 'edited an Infloww tracking link' },

  // ----- To-Do Lists -----
  { m: 'POST',   re: /^\/api\/todos\/?$/,                                 text: 'created a to-do list' },
  { m: 'PATCH',  re: /^\/api\/todos\/[^/]+$/,                             text: 'edited a to-do list' },
  { m: 'DELETE', re: /^\/api\/todos\/[^/]+$/,                             text: 'deleted a to-do list' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/reels$/,                      text: 'added a reel to a to-do list' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/reels\/by-link$/,             text: 'added a reel by link to a to-do list' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/reels\/upload\/init$/,        text: 'started a video upload' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/reels\/upload\/finalize$/,    text: 'finalized a video upload' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/reels\/[^/]+\/move$/,         text: 'moved a reel to another to-do list' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/reels\/[^/]+\/copy$/,         text: 'copied a reel to another to-do list' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/reels\/[^/]+\/backup$/,       text: 'retried a reel video backup' },
  { m: 'DELETE', re: /^\/api\/todos\/[^/]+\/reels\/[^/]+$/,               text: 'removed a reel from a to-do list' },
  { m: 'PATCH',  re: /^\/api\/todos\/[^/]+\/reels\/[^/]+\/note$/,         text: 'edited a reel note' },
  { m: 'PATCH',  re: /^\/api\/todos\/[^/]+\/reels\/[^/]+\/priority$/,     text: 'changed a reel priority' },
  { m: 'PATCH',  re: /^\/api\/todos\/[^/]+\/reels\/[^/]+\/hidden$/,       text: 'toggled a reel hidden state' },
  { m: 'PATCH',  re: /^\/api\/todos\/[^/]+\/reels\/[^/]+$/,               text: 'toggled a reel done state' },
  { m: 'POST',   re: /^\/api\/todos\/[^/]+\/cover-image$/,                text: 'uploaded a to-do cover image' },
  { m: 'DELETE', re: /^\/api\/todos\/[^/]+\/cover-image$/,                text: 'removed a to-do cover image' },

  // ----- Creator Lists / Creators / Fetch -----
  { m: 'POST',   re: /^\/api\/lists\/?$/,                                 text: 'created a creator list' },
  { m: 'PATCH',  re: /^\/api\/lists\/[^/]+$/,                             text: 'edited a creator list' },
  { m: 'DELETE', re: /^\/api\/lists\/[^/]+$/,                             text: 'deleted a creator list' },
  { m: 'POST',   re: /^\/api\/lists\/[^/]+\/creators$/,                   text: 'added a creator to a list' },
  { m: 'DELETE', re: /^\/api\/lists\/[^/]+\/creators\/[^/]+$/,            text: 'removed a creator from a list' },
  { m: 'POST',   re: /^\/api\/creators\/?$/,                              text: 'added a creator' },
  { m: 'DELETE', re: /^\/api\/creators\/[^/]+$/,                          text: 'deleted a creator' },
  { m: 'POST',   re: /^\/api\/fetch\/run$/,                               text: 'triggered a reel-fetch run' },
  { m: 'POST',   re: /^\/api\/fetch\/creator\/[^/]+$/,                    text: 'fetched a single creator' },

  // ----- Reels (dashboard) -----
  { m: 'PATCH',  re: /^\/api\/reels\/[^/]+\/seen$/,                       text: 'marked a reel as seen/unseen' },
  { m: 'POST',   re: /^\/api\/reels\/mark-seen$/,                         text: 'bulk-marked reels as seen' },

  // ----- My Creators (talents) -----
  { m: 'POST',   re: /^\/api\/talents\/?$/,                               text: 'created a creator (My Creators)' },
  { m: 'PATCH',  re: /^\/api\/talents\/[^/]+$/,                           text: 'edited a creator (My Creators)' },
  { m: 'DELETE', re: /^\/api\/talents\/[^/]+$/,                           text: 'deleted a creator (My Creators)' },
  { m: 'POST',   re: /^\/api\/talents\/[^/]+\/profiles$/,                 text: 'added an IG profile to a creator' },
  { m: 'DELETE', re: /^\/api\/talents\/[^/]+\/profiles\/[^/]+$/,          text: 'removed an IG profile from a creator' },
  { m: 'POST',   re: /^\/api\/talents\/[^/]+\/fetch$/,                    text: "triggered a creator's IG fetch" },
  { m: 'POST',   re: /^\/api\/talents\/[^/]+\/profile-pic$/,              text: 'uploaded a creator profile picture' },
  { m: 'DELETE', re: /^\/api\/talents\/[^/]+\/profile-pic$/,              text: 'removed a creator profile picture' },

  // ----- My Accounts (IG profile) -----
  { m: 'POST',   re: /^\/api\/my-accounts\/?$/,                           text: 'added an IG profile' },
  { m: 'PATCH',  re: /^\/api\/my-accounts\/[^/]+$/,                       text: 'updated an IG profile (account info)' },
  { m: 'DELETE', re: /^\/api\/my-accounts\/[^/]+$/,                       text: 'removed an IG profile' },
  { m: 'POST',   re: /^\/api\/my-accounts\/fetch\/run$/,                  text: 'triggered an IG-profile fetch' },

  // ----- Daily Tasks -----
  { m: 'POST',   re: /^\/api\/daily-tasks\/templates$/,                   text: 'added a daily-task template' },
  { m: 'PATCH',  re: /^\/api\/daily-tasks\/templates\/[^/]+$/,            text: 'edited a daily-task template' },
  { m: 'DELETE', re: /^\/api\/daily-tasks\/templates\/[^/]+$/,            text: 'deleted a daily-task template' },
  { m: 'PATCH',  re: /^\/api\/daily-tasks\/today\/[^/]+$/,                text: 'checked/unchecked a daily task' },
  { m: 'PATCH',  re: /^\/api\/daily-tasks\/profiles\/[^/]+\/toggle$/,     text: 'toggled daily-task generation for a profile' },

  // ----- Guides V2 -----
  { m: 'POST',   re: /^\/api\/guides-v2\/categories$/,                    text: 'created a guides category' },
  { m: 'PATCH',  re: /^\/api\/guides-v2\/categories\/[^/]+$/,             text: 'edited a guides category' },
  { m: 'DELETE', re: /^\/api\/guides-v2\/categories\/[^/]+$/,             text: 'deleted a guides category' },
  { m: 'POST',   re: /^\/api\/guides-v2\/categories\/reorder$/,           text: 'reordered guide categories' },
  { m: 'POST',   re: /^\/api\/guides-v2\/items\/(guide|lesson)$/,         text: 'created a guide item' },
  { m: 'POST',   re: /^\/api\/guides-v2\/items\/[^/]+\/[^/]+\/move$/,     text: 'moved a guide item' },
  { m: 'POST',   re: /^\/api\/guides-v2\/items\/[^/]+\/[^/]+\/pin$/,      text: 'pinned/unpinned a guide item' },
  { m: 'POST',   re: /^\/api\/guides-v2\/items\/reorder$/,                text: 'reordered guide items' },

  // ----- Guides (legacy) / Lessons -----
  { m: 'POST',   re: /^\/api\/guides\/?$/,                                text: 'created a guide' },
  { m: 'PATCH',  re: /^\/api\/guides\/[^/]+$/,                            text: 'edited a guide' },
  { m: 'DELETE', re: /^\/api\/guides\/[^/]+$/,                            text: 'deleted a guide' },
  { m: 'POST',   re: /^\/api\/guides\/[^/]+\/image$/,                     text: 'uploaded a guide image' },
  { m: 'POST',   re: /^\/api\/lessons\/?$/,                               text: 'created a lesson' },
  { m: 'PATCH',  re: /^\/api\/lessons\/[^/]+$/,                           text: 'edited a lesson' },
  { m: 'DELETE', re: /^\/api\/lessons\/[^/]+$/,                           text: 'deleted a lesson' },
  { m: 'POST',   re: /^\/api\/lessons\/[^/]+\/thumbnail$/,                text: 'uploaded a lesson thumbnail' },
  { m: 'POST',   re: /^\/api\/guide-completions$/,                        text: 'marked a guide complete' },
  { m: 'DELETE', re: /^\/api\/guide-completions/,                         text: 'unmarked a guide complete' },

  // ----- Tools (converter / image cleaner / batch) -----
  { m: 'POST',   re: /^\/api\/converter\/fetch-reel$/,                    text: 'fetched a reel via the Reel Converter' },
  { m: 'POST',   re: /^\/api\/converter\/convert-to-mp3$/,                text: 'converted a reel to MP3' },
  { m: 'POST',   re: /^\/api\/image-cleaner\/clean$/,                     text: 'cleaned an image' },

  // ----- Studio / Higgsfield -----
  { m: 'POST',   re: /^\/api\/studio\/characters$/,                       text: 'created a studio character' },
  { m: 'PATCH',  re: /^\/api\/studio\/characters\/[^/]+$/,                text: 'edited a studio character' },
  { m: 'DELETE', re: /^\/api\/studio\/characters\/[^/]+$/,                text: 'deleted a studio character' },
  { m: 'POST',   re: /^\/api\/studio\/preview-prompt$/,                   text: 'previewed a Studio prompt' },
  { m: 'POST',   re: /^\/api\/studio\/generate$/,                         text: 'generated a Studio image' },
  { m: 'DELETE', re: /^\/api\/studio\/generations\/[^/]+$/,               text: 'deleted a Studio generation' },
  { m: 'POST',   re: /^\/api\/studio\/generations\/[^/]+\/clean$/,        text: 'cleaned a Studio generation' },

  // ----- Team -----
  { m: 'POST',   re: /^\/api\/team\/invites$/,                            text: 'sent a team invite' },
  { m: 'DELETE', re: /^\/api\/team\/invites\/[^/]+$/,                     text: 'revoked a team invite' },
  { m: 'PATCH',  re: /^\/api\/team\/members\/[^/]+$/,                     text: 'updated a team member' },
  { m: 'DELETE', re: /^\/api\/team\/members\/[^/]+$/,                     text: 'deactivated a team member' },

  // ----- Settings -----
  { m: 'PATCH',  re: /^\/api\/settings\/?$/,                              text: 'updated agency settings' },
  { m: 'POST',   re: /^\/api\/settings\/logo$/,                           text: 'uploaded the agency logo' },
  { m: 'DELETE', re: /^\/api\/settings\/logo$/,                           text: 'removed the agency logo' },
  { m: 'POST',   re: /^\/api\/settings\/discord\/test$/,                  text: 'tested the Discord webhook' },

  // ----- Explore Creators (suggestions) -----
  { m: 'POST',   re: /^\/api\/suggestions\/lists\/[^/]+\/scan$/,          text: 'started an Explore-Creators scan' },
  { m: 'PATCH',  re: /^\/api\/suggestions\/[^/]+$/,                       text: 'hid/unhid a suggested profile' },
  { m: 'DELETE', re: /^\/api\/suggestions\/[^/]+$/,                       text: 'deleted a suggested profile' },
  { m: 'POST',   re: /^\/api\/suggestions\/[^/]+\/add-to-list$/,          text: 'added a suggested profile to a list' },
];

// Fallback action labels (mirror what the old LogPage already had)
const FALLBACK_ACTION = {
  create: 'created something',
  update: 'updated something',
  delete: 'deleted something',
  'mark-seen': 'marked something seen',
  'mark-complete': 'marked complete',
  'unmark-complete': 'unmarked complete',
  invite: 'sent an invite',
  move: 'moved an item',
  copy: 'copied an item',
  pin: 'pinned an item',
  reorder: 'reordered items',
  generate: 'generated content',
  clean: 'cleaned an image',
  'trigger-fetch': 'triggered a fetch',
  'upload-init': 'started an upload',
  'upload-finalize': 'finalized an upload',
};

/**
 * Returns a human description string for a log entry.
 * Always returns a non-empty string.
 */
export function humanizeLogEntry(entry) {
  if (!entry) return '';
  const method = (entry.method || '').toUpperCase();
  const path = (entry.path || '').split('?')[0]; // drop query string
  for (const rule of RULES) {
    if (rule.m === method && rule.re.test(path)) return rule.text;
  }
  // If middleware tagged an explicit target_name, use that for richer output
  if (entry.target_name && FALLBACK_ACTION[entry.action]) {
    return `${FALLBACK_ACTION[entry.action]} — ${entry.target_name}`;
  }
  return FALLBACK_ACTION[entry.action] || entry.action || 'did something';
}
