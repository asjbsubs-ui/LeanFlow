// ── Lean Triage — shared pure-logic rules module ──────────────────────
// No DOM dependency. Designed to be lifted into LeanOffice/LeanStudio later
// as-is; for now loaded via <script src="triage-rules.js"> in index.html.

(function(){
  const DAY_MS = 86400000;

  // Eisenhower quadrant → urgency/importance, mirrors leanflow-mcp's qMap.
  const QUADRANT_MAP = {
    q1: ['urgent',     'important'],
    q2: ['not-urgent', 'important'],
    q3: ['urgent',     'not-important'],
    q4: ['not-urgent', 'not-important'],
  };
  const DEFAULT_TASK_QUADRANT = 'q2';

  const AMBER_DAYS = 3;
  const RED_DAYS = 7;
  const BACKLOG_EXPIRE_DAYS = 30;

  function ageDays(dateStr, nowMs){
    if(!dateStr) return 0;
    const created = new Date(dateStr + 'T12:00:00').getTime();
    const now = nowMs || Date.now();
    return Math.max(0, Math.floor((now - created) / DAY_MS));
  }

  // 'normal' | 'amber' | 'red'
  function ageBucket(dateStr, nowMs){
    const d = ageDays(dateStr, nowMs);
    if(d >= RED_DAYS) return 'red';
    if(d >= AMBER_DAYS) return 'amber';
    return 'normal';
  }

  function bucketColorVar(bucket){
    return bucket === 'red' ? 'var(--red)' : bucket === 'amber' ? 'var(--yellow)' : 'var(--text-muted)';
  }

  // {count, oldestAgeDays} across open notes, for sidebar/header badges.
  function inboxStats(openNotes, nowMs){
    const count = openNotes.length;
    const oldestAgeDays = count ? Math.max(...openNotes.map(n => ageDays(n.created, nowMs))) : 0;
    return { count, oldestAgeDays };
  }

  function quadrantToFields(quadrant){
    const [urgency, importance] = QUADRANT_MAP[quadrant] || QUADRANT_MAP[DEFAULT_TASK_QUADRANT];
    return { urgency, importance };
  }

  // note: {status, backlog_at}
  function isBacklogExpiring(note, nowMs){
    if(note.status !== 'scheduled' || !note.backlog_at) return false;
    const now = nowMs || Date.now();
    return (now - note.backlog_at) >= BACKLOG_EXPIRE_DAYS * DAY_MS;
  }

  function backlogAgeDays(note, nowMs){
    if(!note.backlog_at) return 0;
    const now = nowMs || Date.now();
    return Math.max(0, Math.floor((now - note.backlog_at) / DAY_MS));
  }

  // Oldest-created-first comparator for the triage stack / inbox list.
  function oldestFirst(a, b){
    return (a.ts || 0) - (b.ts || 0);
  }

  // URL detection for the Extract triage exit — a note only offers Extract
  // when its text matches this.
  const URL_RE = /https?:\/\/\S+/;
  function hasUrl(text){
    return URL_RE.test(text || '');
  }
  function extractUrl(text){
    const m = (text || '').match(URL_RE);
    return m ? m[0] : '';
  }

  const TriageRules = {
    AMBER_DAYS, RED_DAYS, BACKLOG_EXPIRE_DAYS,
    QUADRANT_MAP, DEFAULT_TASK_QUADRANT,
    ageDays, ageBucket, bucketColorVar,
    inboxStats, quadrantToFields,
    isBacklogExpiring, backlogAgeDays,
    oldestFirst,
    hasUrl, extractUrl,
  };

  if(typeof module !== 'undefined' && module.exports) module.exports = TriageRules;
  else if(typeof window !== 'undefined') window.TriageRules = TriageRules;
})();
