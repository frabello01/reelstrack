const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch (err) {
    // Network failure (CORS, offline, server down)
    console.error(`[api] NETWORK FAIL ${path}:`, err.message);
    throw err;
  }
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    console.error(`[api] HTTP ${res.status} ${path} (${elapsed}ms):`, err.error);
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  const data = await res.json();
  // Debug: log empty responses so we can spot when the backend returns [] mysteriously
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
  moveReel: (sourceId, reelId, target_list_id) =>
    request(`/api/todos/${sourceId}/reels/${reelId}/move`, { method: 'POST', body: JSON.stringify({ target_list_id }) }),
  copyReel: (sourceId, reelId, target_list_id) =>
    request(`/api/todos/${sourceId}/reels/${reelId}/copy`, { method: 'POST', body: JSON.stringify({ target_list_id }) }),

  // Direct video upload (initiates a signed Supabase Storage URL, finalize after upload)
  initVideoUpload: (todoId, filename, size_bytes) =>
    request(`/api/todos/${todoId}/reels/upload/init`, { method: 'POST', body: JSON.stringify({ filename, size_bytes }) }),
  finalizeVideoUpload: (todoId, payload) =>
    request(`/api/todos/${todoId}/reels/upload/finalize`, { method: 'POST', body: JSON.stringify(payload) }),
  addReelToTodoByLink: (todoId, url) =>
    request(`/api/todos/${todoId}/reels/by-link`, { method: 'POST', body: JSON.stringify({ url }) }),
  retryReelBackup: (todoId, reelId) =>
    request(`/api/todos/${todoId}/reels/${reelId}/backup`, { method: 'POST' }),

  // Public to-do list (no auth)
  getPublicTodo: (token) => request(`/api/todos/public/${token}`),
  togglePublicReelDone: (token, reelId, is_done) =>
    request(`/api/todos/public/${token}/reels/${reelId}`, { method: 'PATCH', body: JSON.stringify({ is_done }) }),

  // My Accounts (accounts I manage) — kept for the per-profile detail page
  getMyAccounts: () => request('/api/my-accounts'),
  getMyAccount: (id) => request(`/api/my-accounts/${id}`),
  addMyAccount: (body) => request('/api/my-accounts', { method: 'POST', body: JSON.stringify(body) }),
  deleteMyAccount: (id) => request(`/api/my-accounts/${id}`, { method: 'DELETE' }),
  updateMyAccountInfo: (id, account_info) =>
    request(`/api/my-accounts/${id}`, { method: 'PATCH', body: JSON.stringify({ account_info }) }),
  triggerMyAccountsFetch: (account_id) =>
    request('/api/my-accounts/fetch/run', { method: 'POST', body: JSON.stringify({ account_id }) }),

  // Talents ("My Creators") — top-level entity wrapping multiple IG profiles
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

  // To-do list cover image
  uploadTodoCover: (todoId, image_data_url) =>
    request(`/api/todos/${todoId}/cover-image`, { method: 'POST', body: JSON.stringify({ image_data_url }) }),
  removeTodoCover: (todoId) =>
    request(`/api/todos/${todoId}/cover-image`, { method: 'DELETE' }),

  // Reel converter — paste IG link, get fresh video URL + metadata
  fetchReelForConverter: (url) =>
    request('/api/converter/fetch-reel', { method: 'POST', body: JSON.stringify({ url }) }),
  convertReelToMp3: (url) =>
    request('/api/converter/convert-to-mp3', { method: 'POST', body: JSON.stringify({ url }) }),

  // Agency settings (display name + logo)
  getSettings: () => request('/api/settings'),
  updateSettings: (display_name) =>
    request('/api/settings', { method: 'PATCH', body: JSON.stringify({ display_name }) }),
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
};
