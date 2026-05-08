const BASE = import.meta.env.VITE_API_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
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
  deleteTodo: (id) => request(`/api/todos/${id}`, { method: 'DELETE' }),
  addReelToTodo: (todoId, reel_id) =>
    request(`/api/todos/${todoId}/reels`, { method: 'POST', body: JSON.stringify({ reel_id }) }),
  removeReelFromTodo: (todoId, reelId) =>
    request(`/api/todos/${todoId}/reels/${reelId}`, { method: 'DELETE' }),
  toggleReelDone: (todoId, reelId, is_done) =>
    request(`/api/todos/${todoId}/reels/${reelId}`, { method: 'PATCH', body: JSON.stringify({ is_done }) }),
  updateReelNote: (todoId, reelId, note) =>
    request(`/api/todos/${todoId}/reels/${reelId}/note`, { method: 'PATCH', body: JSON.stringify({ note }) }),
  addReelToTodoByLink: (todoId, url) =>
    request(`/api/todos/${todoId}/reels/by-link`, { method: 'POST', body: JSON.stringify({ url }) }),

  // Public to-do list (no auth)
  getPublicTodo: (token) => request(`/api/todos/public/${token}`),
  togglePublicReelDone: (token, reelId, is_done) =>
    request(`/api/todos/public/${token}/reels/${reelId}`, { method: 'PATCH', body: JSON.stringify({ is_done }) }),
};
