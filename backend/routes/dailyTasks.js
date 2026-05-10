const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { generateDailyTasks, todayInRome } = require('../services/dailyTasksService');

// ----- Templates CRUD ----------------------------------------------

// GET all templates
router.get('/templates', async (req, res) => {
  const { data, error } = await supabase
    .from('task_templates')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

// POST create a template
router.post('/templates', async (req, res) => {
  const { label } = req.body;
  if (!label?.trim()) return res.status(400).json({ error: 'label is required' });

  // sort_order = max + 1 so new ones go at the bottom
  const { data: existing } = await supabase
    .from('task_templates')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1);
  const nextOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from('task_templates')
    .insert({ label: label.trim(), sort_order: nextOrder })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PATCH update template label or sort_order
router.patch('/templates/:id', async (req, res) => {
  const { label, sort_order } = req.body;
  const updates = {};
  if (label !== undefined) updates.label = label;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'nothing to update' });
  }

  const { data, error } = await supabase
    .from('task_templates')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE template (cascades to all daily_tasks instances)
router.delete('/templates/:id', async (req, res) => {
  const { error } = await supabase
    .from('task_templates')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ----- Today's tasks -----------------------------------------------

// GET today's tasks, grouped by talent → profile → tasks.
// Auto-generates if today's tasks don't exist yet (lazy generation, in case
// the cron didn't run e.g. dyno was sleeping at exactly midnight).
router.get('/today', async (req, res) => {
  const date = req.query.date || todayInRome();

  // Check if any tasks exist for today; if not, generate
  const { count: existingCount } = await supabase
    .from('daily_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('task_date', date);

  if (!existingCount || existingCount === 0) {
    await generateDailyTasks(date);
  }

  // Pull today's tasks with profile + talent + template info
  const { data: tasks, error } = await supabase
    .from('daily_tasks')
    .select(`
      id, is_done, done_at, task_date, template_id, account_id,
      task_templates ( id, label, sort_order ),
      my_accounts (
        id, username, profile_pic_url, status, talent_id,
        talents ( id, name )
      )
    `)
    .eq('task_date', date)
    .order('id'); // stable order
  if (error) return res.status(500).json({ error: error.message });

  // Group: talent → profile → tasks
  const byTalent = new Map();
  for (const t of tasks || []) {
    const acc = t.my_accounts;
    if (!acc) continue;
    const talent = acc.talents || { id: 'unknown', name: 'Unknown' };
    if (!byTalent.has(talent.id)) {
      byTalent.set(talent.id, { ...talent, profiles: new Map() });
    }
    const tg = byTalent.get(talent.id);
    if (!tg.profiles.has(acc.id)) {
      tg.profiles.set(acc.id, {
        id: acc.id,
        username: acc.username,
        profile_pic_url: acc.profile_pic_url,
        status: acc.status,
        tasks: [],
      });
    }
    tg.profiles.get(acc.id).tasks.push({
      id: t.id,
      template_id: t.template_id,
      label: t.task_templates?.label || '(unknown task)',
      sort_order: t.task_templates?.sort_order ?? 0,
      is_done: t.is_done,
      done_at: t.done_at,
    });
  }

  // Convert maps to arrays + sort tasks by template sort_order within each profile
  const groups = Array.from(byTalent.values()).map((tg) => ({
    id: tg.id,
    name: tg.name,
    profiles: Array.from(tg.profiles.values()).map((p) => ({
      ...p,
      tasks: p.tasks.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    })).sort((a, b) => a.username.localeCompare(b.username)),
  })).sort((a, b) => a.name.localeCompare(b.name));

  res.json({ date, groups });
});

// PATCH toggle a task done/undone
router.patch('/today/:taskId', async (req, res) => {
  const { is_done } = req.body;
  const updates = {
    is_done: !!is_done,
    done_at: is_done ? new Date().toISOString() : null,
  };
  const { data, error } = await supabase
    .from('daily_tasks')
    .update(updates)
    .eq('id', req.params.taskId)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST manually generate today's tasks (in case the cron missed)
router.post('/generate', async (req, res) => {
  const result = await generateDailyTasks();
  if (result.error) return res.status(500).json({ error: result.error });
  res.json(result);
});

// PATCH per-profile toggle: include this profile in daily tasks or not
router.patch('/profiles/:profileId/toggle', async (req, res) => {
  const { enabled } = req.body;
  const { data, error } = await supabase
    .from('my_accounts')
    .update({ daily_tasks_enabled: !!enabled })
    .eq('id', req.params.profileId)
    .select('id, daily_tasks_enabled')
    .single();
  if (error) return res.status(500).json({ error: error.message });

  // If we just turned this profile ON, generate today's tasks for it (catch-up)
  // so the user doesn't have to wait until tomorrow's cron
  if (enabled) {
    await generateDailyTasks();
  } else {
    // Turning OFF: remove today's still-pending tasks for this profile so it
    // disappears from the My Day view immediately.
    const today = todayInRome();
    await supabase
      .from('daily_tasks')
      .delete()
      .eq('account_id', req.params.profileId)
      .eq('task_date', today)
      .eq('is_done', false);
  }

  res.json(data);
});

module.exports = router;
