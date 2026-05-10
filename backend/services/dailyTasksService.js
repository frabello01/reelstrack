const supabase = require('../lib/supabase');

/**
 * Returns today's date in Europe/Rome as a YYYY-MM-DD string.
 * We use the Intl API which respects DST automatically (CET/CEST).
 */
function todayInRome() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // en-CA gives YYYY-MM-DD which is what we need
  return fmt.format(new Date());
}

/**
 * Generate today's daily tasks for every eligible profile.
 * Called by the cron at midnight Rome.
 *
 * Eligibility:
 *  - profile.status === 'active'  (skip banned/inactive/private/error)
 *  - profile.daily_tasks_enabled === true  (user can opt out per-profile)
 *
 * Uses an upsert with ignoreDuplicates so re-running on the same day is safe
 * (no duplicates, no error).
 */
async function generateDailyTasks(date = todayInRome()) {
  // 1. Get all task templates
  const { data: templates, error: tplErr } = await supabase
    .from('task_templates')
    .select('id')
    .order('sort_order', { ascending: true });
  if (tplErr) {
    console.error('[daily_tasks] could not load templates:', tplErr.message);
    return { error: tplErr.message };
  }
  if (!templates || templates.length === 0) {
    console.log('[daily_tasks] no templates defined — nothing to generate');
    return { generated: 0, reason: 'no_templates' };
  }

  // 2. Get all eligible profiles (active + opted-in)
  const { data: profiles, error: profErr } = await supabase
    .from('my_accounts')
    .select('id, username')
    .eq('status', 'active')
    .eq('daily_tasks_enabled', true);
  if (profErr) {
    console.error('[daily_tasks] could not load profiles:', profErr.message);
    return { error: profErr.message };
  }
  if (!profiles || profiles.length === 0) {
    console.log('[daily_tasks] no eligible profiles — nothing to generate');
    return { generated: 0, reason: 'no_profiles' };
  }

  // 3. Build the cross-product: every profile × every template = a row
  const rows = [];
  for (const p of profiles) {
    for (const t of templates) {
      rows.push({
        account_id: p.id,
        template_id: t.id,
        task_date: date,
      });
    }
  }

  console.log(`[daily_tasks] generating ${rows.length} tasks for ${profiles.length} profiles × ${templates.length} templates on ${date}`);

  // 4. Insert with conflict handling (skip duplicates if rerun)
  const { error: insertErr } = await supabase
    .from('daily_tasks')
    .upsert(rows, { onConflict: 'account_id,template_id,task_date', ignoreDuplicates: true });

  if (insertErr) {
    console.error('[daily_tasks] insert failed:', insertErr.message);
    return { error: insertErr.message };
  }

  return { generated: rows.length, profiles: profiles.length, templates: templates.length, date };
}

/**
 * Cleanup old daily tasks. Anything older than 30 days is deleted.
 * Keeps the table small. Called by the same cron.
 */
async function cleanupOldDailyTasks() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const { error } = await supabase
    .from('daily_tasks')
    .delete()
    .lt('task_date', cutoffDate);

  if (error) {
    console.error('[daily_tasks] cleanup failed:', error.message);
  } else {
    console.log(`[daily_tasks] cleanup ran (deleted tasks before ${cutoffDate})`);
  }
}

module.exports = { generateDailyTasks, cleanupOldDailyTasks, todayInRome };
