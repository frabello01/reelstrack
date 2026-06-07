import { supabase } from './supabase';

const BASE = import.meta.env.VITE_API_URL || '';

// ============================================================
// REQUEST HELPER
// ============================================================
// Every API call now attaches the current Supabase session JWT as a
// Bearer token. The backend's auth middleware verifies it on each request.
// If no session exists, the request goes out without an Authorization
// header — backend will respond 401 and the caller can react.
async function request(path, options = {}) {
  const t0 = Date.now();

  // Grab the current session for its access_token. This is cached by the
  // Supabase SDK in localStorage so the call is effectively free.
  const { data: { session } } = await supabase.auth.getSession();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch (err) {
    console.error(`[api] NETWORK FAIL ${path}:`, err.message);
    throw err;
  }
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    let msg;
    if (typeof err.error === 'string') {
      msg = err.error;
    } else if (err.error && typeof err.error === 'object') {
      msg = err.error.message || err.error.detail || JSON.stringify(err.error);
    } else {
      msg = `HTTP ${res.status}`;
    }
    if (err.details) {
      const detailStr = typeof err.details === 'string'
        ? err.details
        : (err.details.message || err.details.detail || JSON.stringify(err.details));
      msg += ` — ${detailStr}`;
    }
    console.error(`[api] HTTP ${res.status} ${path} (${elapsed}ms):`, err);
    throw new Error(msg);
  }
  const data = await res.json();
  if (Array.isArray(data) && data.length === 0 && !path.includes('/active') && !path.includes('/jobs')) {
    console.warn(`[api] EMPTY ARRAY from ${path} (${elapsed}ms)`);
  }
  return data;
}

export const api = {
  // Lists
  getLists: () => request('/api/lists'),
  getList: (id) => request(`/api/lists/${id}`),
  createList: (body) => request('/api/lists', { method: 'POST', body: JSON.stringify(body) }),
  updateList: (id, body) => request(`/api/lists/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteList: (id) => request(`/api/lists/${id}`, { method: 'DELETE' }),
  addCreatorToList: (listId, creator_id) =>
    request(`/api/lists/${listId}/creators`, { method: 'POST', body: JSON.stringify({ creator_id }) }),
  removeCreatorFromList: (listId, creatorId) =>
    request(`/api/lists/${listId}/creators/${creatorId}`, { method: 'DELETE' }),

  // Creators
  getCreators: () => request('/api/creators'),
  addCreator: (body) => request('/api/creators', { method: 'POST', body: JSON.stringify(body) }),
  deleteCreator: (id) => request(`/api/creators/${id}`, { method: 'DELETE' }),

  // Reels
  getReels: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/reels?${qs}`);
  },
  getStats: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/reels/stats?${qs}`);
  },
  setReelSeen: (reelId, seen) =>
    request(`/api/reels/${reelId}/seen`, { method: 'PATCH', body: JSON.stringify({ seen }) }),
  bulkMarkSeen: (reelIds) =>
    request('/api/reels/mark-seen', { method: 'POST', body: JSON.stringify({ reel_ids: reelIds }) }),

  // Fetch
  triggerFetch: (list_id) =>
    request('/api/fetch/run', { method: 'POST', body: JSON.stringify({ list_id }) }),
  triggerCreatorFetch: (creatorId) =>
    request(`/api/fetch/creator/${creatorId}`, { method: 'POST' }),
  getFetchJobs: () => request('/api/fetch/jobs'),
  getActiveFetch: () => request('/api/fetch/active'),

  // To-Do Lists
  getTodos: () => request('/api/todos'),
  getTodo: (id) => request(`/api/todos/${id}`),
  createTodo: (name) => request('/api/todos', { method: 'POST', body: JSON.stringify({ name }) }),
  renameTodo: (id, name) => request(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  updateTodoNotes: (id, { public_note, private_note }) =>
    request(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify({ public_note, private_note }) }),
  deleteTodo: (id) => request(`/api/todos/${id}`, { method: 'DELETE' }),
  addReelToTodo: (todoId, reel_id) =>
    request(`/api/todos/${todoId}/reels`, { method: 'POST', body: JSON.stringify({ reel_id }) }),
  removeReelFromTodo: (todoId, reelId) =>
    request(`/api/todos/${todoId}/reels/${reelId}`, { method: 'DELETE' }),
  toggleReelDone: (todoId, reelId, is_done) =>
    request(`/api/todos/${todoId}/reels/${reelId}`, { method: 'PATCH', body: JSON.stringify({ is_done }) }),
  updateReelNotes: (todoId, reelId, { public_note, private_note }) =>
    request(`/api/todos/${todoId}/reels/${reelId}/note`, { method: 'PATCH', body: JSON.stringify({ public_note, private_note }) }),
  updateReelPriority: (todoId, reelId, priority) =>
    request(`/api/todos/${todoId}/reels/${reelId}/priority`, { method: 'PATCH', body: JSON.stringify({ priority }) }),
  toggleReelHidden: (todoId, reelId, is_hidden) =>
    request(`/api/todos/${todoId}/reels/${reelId}/hidden`, { method: 'PATCH', body: JSON.stringify({ is_hidden }) }),
  moveReel: (sourceId, reelId, target_list_id) =>
    request(`/api/todos/${sourceId}/reels/${reelId}/move`, { method: 'POST', body: JSON.stringify({ target_list_id }) }),
  copyReel: (sourceId, reelId, target_list_id) =>
    request(`/api/todos/${sourceId}/reels/${reelId}/copy`, { method: 'POST', body: JSON.stringify({ target_list_id }) }),

  initVideoUpload: (todoId, filename, size_bytes) =>
    request(`/api/todos/${todoId}/reels/upload/init`, { method: 'POST', body: JSON.stringify({ filename, size_bytes }) }),
  finalizeVideoUpload: (todoId, payload) =>
    request(`/api/todos/${todoId}/reels/upload/finalize`, { method: 'POST', body: JSON.stringify(payload) }),
  addReelToTodoByLink: (todoId, url) =>
    request(`/api/todos/${todoId}/reels/by-link`, { method: 'POST', body: JSON.stringify({ url }) }),
  retryReelBackup: (todoId, reelId) =>
    request(`/api/todos/${todoId}/reels/${reelId}/backup`, { method: 'POST' }),

  // Public to-do list (no auth — bypasses the JWT gate on the backend)
  getPublicTodo: (token) => request(`/api/todos/public/${token}`),
  togglePublicReelDone: (token, reelId, is_done) =>
    request(`/api/todos/public/${token}/reels/${reelId}`, { method: 'PATCH', body: JSON.stringify({ is_done }) }),

  // My Accounts
  getMyAccounts: () => request('/api/my-accounts'),
  getMyAccount: (id) => request(`/api/my-accounts/${id}`),
  addMyAccount: (body) => request('/api/my-accounts', { method: 'POST', body: JSON.stringify(body) }),
  deleteMyAccount: (id) => request(`/api/my-accounts/${id}`, { method: 'DELETE' }),
  updateMyAccountInfo: (id, account_info) =>
    request(`/api/my-accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ account_info }) }),
  triggerMyAccountsFetch: (account_id) =>
    request('/api/my-accounts/fetch/run', { method: 'POST', body: JSON.stringify({ account_id }) }),

  // Talents
  getTalents: () => request('/api/talents'),
  getTalent: (id) => request(`/api/talents/${id}`),
  createTalent: (body) => request('/api/talents', { method: 'POST', body: JSON.stringify(body) }),
  updateTalent: (id, body) => request(`/api/talents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTalent: (id) => request(`/api/talents/${id}`, { method: 'DELETE' }),
  addProfileToTalent: (talentId, username) =>
    request(`/api/talents/${talentId}/profiles`, { method: 'POST', body: JSON.stringify({ username }) }),
  removeProfileFromTalent: (talentId, profileId) =>
    request(`/api/talents/${talentId}/profiles/${profileId}`, { method: 'DELETE' }),
  triggerTalentFetch: (talentId) =>
    request(`/api/talents/${talentId}/fetch`, { method: 'POST' }),
  uploadTalentProfilePic: (talentId, image_data_url) =>
    request(`/api/talents/${talentId}/profile-pic`, { method: 'POST', body: JSON.stringify({ image_data_url }) }),
  removeTalentProfilePic: (talentId) =>
    request(`/api/talents/${talentId}/profile-pic`, { method: 'DELETE' }),

  uploadTodoCover: (todoId, image_data_url) =>
    request(`/api/todos/${todoId}/cover-image`, { method: 'POST', body: JSON.stringify({ image_data_url }) }),
  removeTodoCover: (todoId) =>
    request(`/api/todos/${todoId}/cover-image`, { method: 'DELETE' }),

  fetchReelForConverter: (url) =>
    request('/api/converter/fetch-reel', { method: 'POST', body: JSON.stringify({ url }) }),
  convertReelToMp3: (url) =>
    request('/api/converter/convert-to-mp3', { method: 'POST', body: JSON.stringify({ url }) }),

  // Settings
  getSettings: () => request('/api/settings'),
  updateSettings: (display_name) =>
    request('/api/settings', { method: 'PATCH', body: JSON.stringify({ display_name }) }),
  updateSettingsFields: (patch) =>
    request('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  testDiscordWebhook: (url) =>
    request('/api/settings/discord/test', { method: 'POST', body: JSON.stringify(url ? { url } : {}) }),
  uploadAgencyLogo: (image_data_url) =>
    request('/api/settings/logo', { method: 'POST', body: JSON.stringify({ image_data_url }) }),
  removeAgencyLogo: () =>
    request('/api/settings/logo', { method: 'DELETE' }),
  getPublicAgency: () => request('/api/settings/public'),

  // Daily tasks
  getTaskTemplates: () => request('/api/daily-tasks/templates'),
  createTaskTemplate: (label) =>
    request('/api/daily-tasks/templates', { method: 'POST', body: JSON.stringify({ label }) }),
  updateTaskTemplate: (id, body) =>
    request(`/api/daily-tasks/templates/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTaskTemplate: (id) =>
    request(`/api/daily-tasks/templates/${id}`, { method: 'DELETE' }),
  getTodaysTasks: () => request('/api/daily-tasks/today'),
  toggleDailyTask: (taskId, is_done) =>
    request(`/api/daily-tasks/today/${taskId}`, { method: 'PATCH', body: JSON.stringify({ is_done }) }),
  toggleProfileDailyTasks: (profileId, enabled) =>
    request(`/api/daily-tasks/profiles/${profileId}/toggle`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),

  // Guides (legacy)
  getGuides: (search) => request(`/api/guides${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getGuide: (id) => request(`/api/guides/${id}`),
  createGuide: (body) => request('/api/guides', { method: 'POST', body: JSON.stringify(body) }),
  updateGuide: (id, body) => request(`/api/guides/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteGuide: (id) => request(`/api/guides/${id}`, { method: 'DELETE' }),
  uploadGuideImage: (id, image_data_url) =>
    request(`/api/guides/${id}/image`, { method: 'POST', body: JSON.stringify({ image_data_url }) }),

  // Lessons (legacy)
  getLessons: (search) => request(`/api/lessons${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  getLesson: (id) => request(`/api/lessons/${id}`),
  createLesson: (body) => request('/api/lessons', { method: 'POST', body: JSON.stringify(body) }),
  updateLesson: (id, body) => request(`/api/lessons/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLesson: (id) => request(`/api/lessons/${id}`, { method: 'DELETE' }),
  uploadLessonThumbnail: (id, image_data_url) =>
    request(`/api/lessons/${id}/thumbnail`, { method: 'POST', body: JSON.stringify({ image_data_url }) }),

  // Guides V2
  getGuideCategories: () => request('/api/guides-v2/categories'),
  createGuideCategory: (body) =>
    request('/api/guides-v2/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateGuideCategory: (id, body) =>
    request(`/api/guides-v2/categories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteGuideCategory: (id) =>
    request(`/api/guides-v2/categories/${id}`, { method: 'DELETE' }),
  reorderGuideCategories: (ordered_ids) =>
    request('/api/guides-v2/categories/reorder', { method: 'POST', body: JSON.stringify({ ordered_ids }) }),
  getGuideItems: (categoryId) =>
    request(`/api/guides-v2/items${categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : ''}`),
  createGuideItem: (type, category_id) =>
    request(`/api/guides-v2/items/${type}`, {
      method: 'POST',
      body: JSON.stringify({ category_id: category_id || null }),
    }),
  moveGuideItem: (type, id, category_id) =>
    request(`/api/guides-v2/items/${type}/${id}/move`, { method: 'POST', body: JSON.stringify({ category_id }) }),
  toggleGuideItemPin: (type, id, is_pinned) =>
    request(`/api/guides-v2/items/${type}/${id}/pin`, { method: 'POST', body: JSON.stringify({ is_pinned }) }),
  reorderGuideItems: (ordered) =>
    request('/api/guides-v2/items/reorder', { method: 'POST', body: JSON.stringify({ ordered }) }),

  // AI Image Cleaner
  getImageCleanerModels: () => request('/api/image-cleaner/models'),
  cleanImage: (body) =>
    request('/api/image-cleaner/clean', { method: 'POST', body: JSON.stringify(body) }),

  // Higgsfield Characters — local registry
  getHiggsfieldStatus: () => request('/api/higgsfield/status'),
  getHiggsfieldCharacters: () => request('/api/higgsfield/characters'),
  addHiggsfieldCharacter: (body) =>
    request('/api/higgsfield/characters', { method: 'POST', body: JSON.stringify(body) }),
  updateHiggsfieldCharacter: (id, body) =>
    request(`/api/higgsfield/characters/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteHiggsfieldCharacter: (id) =>
    request(`/api/higgsfield/characters/${id}`, { method: 'DELETE' }),

  // Higgsfield Characters — real API
  getHiggsfieldApiCharacters: () => request('/api/higgsfield/api-characters'),
  getHiggsfieldCharacterStatus: (id) => request(`/api/higgsfield/api-characters/${id}`),
  trainHiggsfieldCharacter: (body) =>
    request('/api/higgsfield/train-character', { method: 'POST', body: JSON.stringify(body) }),

  getHiggsfieldStyles: () => request('/api/higgsfield/styles'),
  generateCharacterImage: (body) =>
    request('/api/higgsfield/generate', { method: 'POST', body: JSON.stringify(body) }),
  getCharacterGenerations: (soul_id) => {
    const q = soul_id ? `?soul_id=${encodeURIComponent(soul_id)}` : '';
    return request(`/api/higgsfield/generations${q}`);
  },
  deleteCharacterGeneration: (id) =>
    request(`/api/higgsfield/generations/${id}`, { method: 'DELETE' }),
  cleanCharacterGeneration: (id, body) =>
    request(`/api/higgsfield/generations/${id}/clean`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),

  // Studio
  getStudioStatus: () => request('/api/studio/status'),
  getStudioCharacters: () => request('/api/studio/characters'),
  createStudioCharacter: (body) =>
    request('/api/studio/characters', { method: 'POST', body: JSON.stringify(body) }),
  updateStudioCharacter: (id, body) =>
    request(`/api/studio/characters/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteStudioCharacter: (id) =>
    request(`/api/studio/characters/${id}`, { method: 'DELETE' }),
  previewStudioPrompt: (body) =>
    request('/api/studio/preview-prompt', { method: 'POST', body: JSON.stringify(body) }),
  generateStudioImage: (body) =>
    request('/api/studio/generate', { method: 'POST', body: JSON.stringify(body) }),
  getStudioGenerations: (characterId) =>
    request(`/api/studio/generations${characterId ? `?character_id=${encodeURIComponent(characterId)}` : ''}`),
  deleteStudioGeneration: (id) =>
    request(`/api/studio/generations/${id}`, { method: 'DELETE' }),
  cleanStudioGeneration: (id, body) =>
    request(`/api/studio/generations/${id}/clean`, {
      method: 'POST',
      body: JSON.stringify(body || {}),
    }),

  // Video Studio (xai/grok-imagine-video via Replicate)
  getVideoStudioStatus: () => request('/api/video-studio/status'),
  generateVideoStudio: (body) =>
    request('/api/video-studio/generate', { method: 'POST', body: JSON.stringify(body) }),
  getVideoStudioGenerations: (limit = 30) =>
    request(`/api/video-studio/generations?limit=${limit}`),
  deleteVideoStudioGeneration: (id) =>
    request(`/api/video-studio/generations/${id}`, { method: 'DELETE' }),

  // Team
  getMe: () => request('/api/team/me'),
  getTeamMembers: () => request('/api/team/members'),
  getTeamInvites: () => request('/api/team/invites'),
  createTeamInvite: (body) =>
    request('/api/team/invites', { method: 'POST', body: JSON.stringify(body) }),
  revokeTeamInvite: (id) =>
    request(`/api/team/invites/${id}`, { method: 'DELETE' }),
  updateTeamMember: (id, body) =>
    request(`/api/team/members/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deactivateTeamMember: (id) =>
    request(`/api/team/members/${id}`, { method: 'DELETE' }),

  // Invite acceptance (public, no auth)
  checkInvite: (token) => request(`/api/invites/${token}`),
  acceptInvite: (token, password) =>
    request(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // Activity log (admin only)
  getActivityLog: (params = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    }
    const q = qs.toString();
    return request(`/api/activity-log${q ? `?${q}` : ''}`);
  },
  getActivityLogSections: () => request('/api/activity-log/sections'),
  getActivityLogUsers: () => request('/api/activity-log/users'),

  // Guide completions (per-user)
  getMyGuideCompletions: () => request('/api/guide-completions/mine'),
  getGuideCompletionsForItem: (item_type, item_id) => {
    const qs = new URLSearchParams({ item_type, item_id }).toString();
    return request(`/api/guide-completions?${qs}`);
  },
  getGuideCompletionsMatrix: (categoryId) => {
    const qs = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : '';
    return request(`/api/guide-completions/matrix${qs}`);
  },
  markGuideComplete: (item_type, item_id) =>
    request('/api/guide-completions', {
      method: 'POST',
      body: JSON.stringify({ item_type, item_id }),
    }),
  unmarkGuideComplete: (item_type, item_id) => {
    const qs = new URLSearchParams({ item_type, item_id }).toString();
    return request(`/api/guide-completions?${qs}`, { method: 'DELETE' });
  },

  // Infloww
  getInflowwLinks: (talent_id) =>
    request(`/api/infloww/links${talent_id ? `?talent_id=${encodeURIComponent(talent_id)}` : ''}`),
  getInflowwLinkSnapshots: (id, days = 30) =>
    request(`/api/infloww/links/${encodeURIComponent(id)}/snapshots?days=${days}`),
  triggerInflowwSync: (talent_id) =>
    request('/api/infloww/sync', { method: 'POST', body: JSON.stringify(talent_id ? { talent_id } : {}) }),
  bindInflowwLink: (landing_link_id, infloww_link_id) =>
    request('/api/infloww/bind', { method: 'POST', body: JSON.stringify({ landing_link_id, infloww_link_id: infloww_link_id || null }) }),
  setInflowwLinkHidden: (infloww_link_id, hidden) =>
    request(`/api/infloww/links/${encodeURIComponent(infloww_link_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ hidden }),
    }),
  renameInflowwLink: (infloww_link_id, local_name) =>
    request(`/api/infloww/links/${encodeURIComponent(infloww_link_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ local_name: local_name || null }),
    }),
  getInflowwSources: (talent_id, period) =>
    request(`/api/infloww/sources?talent_id=${encodeURIComponent(talent_id)}&period=${encodeURIComponent(period)}`),

  // Landings (Linktree-style pages) — admin
  getLandings: () => request('/api/landings'),
  getLanding: (id) => request(`/api/landings/${id}`),
  createLanding: (body) =>
    request('/api/landings', { method: 'POST', body: JSON.stringify(body) }),
  updateLanding: (id, body) =>
    request(`/api/landings/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLanding: (id) => request(`/api/landings/${id}`, { method: 'DELETE' }),
  uploadLandingAvatar: (id, image_data_url) =>
    request(`/api/landings/${id}/avatar`, { method: 'POST', body: JSON.stringify({ image_data_url }) }),
  uploadLandingBackground: (id, image_data_url) =>
    request(`/api/landings/${id}/background`, { method: 'POST', body: JSON.stringify({ image_data_url }) }),
  createLandingLink: (landingId, body) =>
    request(`/api/landings/${landingId}/links`, { method: 'POST', body: JSON.stringify(body) }),
  updateLandingLink: (linkId, body) =>
    request(`/api/landings/links/${linkId}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteLandingLink: (linkId) =>
    request(`/api/landings/links/${linkId}`, { method: 'DELETE' }),
  reorderLandingLinks: (landingId, ordered_ids) =>
    request(`/api/landings/${landingId}/links/reorder`, { method: 'POST', body: JSON.stringify({ ordered_ids }) }),
  getLandingAnalytics: (id, days = 30) =>
    request(`/api/landings/${id}/analytics?days=${days}`),

  // Landings — public (no auth)
  getPublicLanding: (host, slug) =>
    request(`/api/landings/public/lookup?host=${encodeURIComponent(host)}&slug=${encodeURIComponent(slug)}`),
  recordLandingClick: (linkId, payload) =>
    request(`/api/landings/public/click/${linkId}`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  recordLandingView: (landingId, payload) =>
    request(`/api/landings/public/view/${landingId}`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    }),
  getLandingsOverview: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
    const q = qs.toString();
    return request(`/api/landings/analytics/overview${q ? `?${q}` : ''}`);
  },

  // Explore Creators (suggestion scans)
  getSuggestions: (listId) => request(`/api/suggestions/lists/${listId}`),
  triggerSuggestionScan: (listId) =>
    request(`/api/suggestions/lists/${listId}/scan`, { method: 'POST' }),
  getActiveSuggestionScan: (listId) =>
    request(`/api/suggestions/lists/${listId}/active`),
  getSuggestionJobs: (listId) =>
    request(`/api/suggestions/lists/${listId}/jobs`),
  setSuggestionHidden: (id, hidden) =>
    request(`/api/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ hidden }) }),
  addSuggestionToList: (id, list_id) =>
    request(`/api/suggestions/${id}/add-to-list`, {
      method: 'POST',
      body: JSON.stringify(list_id ? { list_id } : {}),
    }),
  deleteSuggestion: (id) =>
    request(`/api/suggestions/${id}`, { method: 'DELETE' }),
};
