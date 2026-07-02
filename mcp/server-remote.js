import express from 'express';
import { randomUUID, createHash } from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
} from '@modelcontextprotocol/sdk/types.js';
import { createClient } from '@supabase/supabase-js';

// ── Config ───────────────────────────────────────────────
const PORT      = process.env.PORT || 3000;
const SB_URL    = process.env.LEANFLOW_SB_URL || 'https://eewyzqyxwwkdimonltjy.supabase.co';
const SB_KEY    = process.env.LEANFLOW_SB_KEY;
const USER_ID   = process.env.LEANFLOW_USER_ID;
const MCP_TOKEN = process.env.MCP_TOKEN;

if (!SB_KEY)    console.warn('Warning: LEANFLOW_SB_KEY not set');
if (!USER_ID)   console.warn('Warning: LEANFLOW_USER_ID not set');
if (!MCP_TOKEN) console.warn('Warning: MCP_TOKEN not set — /mcp unprotected');

const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// ── Storage keys ─────────────────────────────────────────
const K = {
  tasks:     'ahq_tasks',
  habits:    'ahq_habits',
  habitLog:  'ahq_habit_log',
  goals:     'ahq_goals',
  journal:   'ahq_journal',
  meetings:  'ahq_meetings',
  knowledge: 'ahq_knowledge',
  notes:     'ahq_notes',
  quotes:    'ahq_quotes',
};

async function getData(key) {
  const { data, error } = await sb
    .from('leanhq_sync')
    .select('value')
    .eq('user_id', USER_ID)
    .eq('key', key)
    .single();
  if (error && error.code !== 'PGRST116') throw new Error(error.message);
  return data?.value || [];
}

async function setData(key, value) {
  const { error } = await sb
    .from('leanhq_sync')
    .upsert(
      { user_id: USER_ID, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
  if (error) throw new Error(error.message);
}

function today() { return new Date().toISOString().slice(0, 10); }
function uid()   { return randomUUID().replace(/-/g, '').slice(0, 16); }

// ── Tool definitions ─────────────────────────────────────
const TOOLS = [
  {
    name: 'lf_get_tasks',
    description: 'Get LeanFlow tasks. Optional filters: status (todo/done), overdue, due_today, business.',
    inputSchema: {
      type: 'object',
      properties: {
        status:    { type: 'string', enum: ['todo', 'done'] },
        overdue:   { type: 'boolean' },
        due_today: { type: 'boolean' },
        business:  { type: 'string' },
        limit:     { type: 'number' },
      },
    },
  },
  {
    name: 'lf_add_task',
    description: 'Add a task to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:     { type: 'string' },
        due:       { type: 'string', description: 'YYYY-MM-DD' },
        business:  { type: 'string', description: 'StreamLean, LeanFlow, Personal…' },
        dept:      { type: 'string', description: 'Marketing, Development, Operations…' },
        urgent:    { type: 'boolean' },
        important: { type: 'boolean' },
        notes:     { type: 'string' },
      },
    },
  },
  {
    name: 'lf_complete_task',
    description: 'Mark a task as done by id or exact title.',
    inputSchema: {
      type: 'object',
      properties: {
        id:    { type: 'string' },
        title: { type: 'string' },
      },
    },
  },
  {
    name: 'lf_get_habits',
    description: 'Get all habits and whether they are completed today.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'lf_log_habit',
    description: 'Log a habit as completed for today.',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD (defaults to today)' },
      },
    },
  },
  {
    name: 'lf_get_goals',
    description: 'Get LeanFlow goals.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'done', 'paused'] },
      },
    },
  },
  {
    name: 'lf_add_goal',
    description: 'Add a goal to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:    { type: 'string' },
        category: { type: 'string' },
        deadline: { type: 'string', description: 'YYYY-MM-DD' },
        why:      { type: 'string' },
      },
    },
  },
  {
    name: 'lf_get_notes',
    description: 'Get capture notes/ideas from LeanFlow.',
    inputSchema: {
      type: 'object',
      properties: {
        status:   { type: 'string', enum: ['open', 'scheduled', 'done', 'rejected'] },
        category: { type: 'string' },
        limit:    { type: 'number' },
      },
    },
  },
  {
    name: 'lf_add_note',
    description: 'Add a capture note or idea to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:     { type: 'string' },
        category: { type: 'string' },
        source:   { type: 'string' },
      },
    },
  },
  {
    name: 'lf_complete_note',
    description: 'Mark a capture note as done. Use note id or an exact text match.',
    inputSchema: {
      type: 'object',
      properties: {
        id:   { type: 'string' },
        text: { type: 'string' },
      },
    },
  },
  {
    name: 'lf_add_lesson',
    description: 'Add a lesson to Growth → Lessons in LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:  { type: 'string' },
        notes:  { type: 'string' },
        source: { type: 'string' },
        link:   { type: 'string' },
        type:   { type: 'string' },
        domain: { type: 'string' },
      },
    },
  },
  {
    name: 'lf_add_skill',
    description: 'Add a skill/course/book to Growth → Skills in LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:    { type: 'string' },
        notes:    { type: 'string' },
        source:   { type: 'string' },
        link:     { type: 'string' },
        type:     { type: 'string' },
        domain:   { type: 'string' },
        status:   { type: 'string', enum: ['todo', 'active', 'done'] },
        progress: { type: 'number' },
      },
    },
  },
  {
    name: 'lf_add_system',
    description: 'Add a system/framework to Growth → Systems in LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title:  { type: 'string' },
        notes:  { type: 'string' },
        source: { type: 'string' },
        link:   { type: 'string' },
        domain: { type: 'string' },
      },
    },
  },
  {
    name: 'lf_add_quote',
    description: 'Save a quote to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text:     { type: 'string' },
        author:   { type: 'string' },
        source:   { type: 'string' },
        category: { type: 'string' },
      },
    },
  },
  {
    name: 'lf_get_meetings',
    description: 'Get recent/upcoming meetings from LeanFlow.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
  {
    name: 'lf_add_meeting',
    description: 'Add a meeting to LeanFlow.',
    inputSchema: {
      type: 'object',
      required: ['title', 'date'],
      properties: {
        title:    { type: 'string' },
        date:     { type: 'string', description: 'YYYY-MM-DD' },
        time:     { type: 'string', description: 'HH:MM' },
        business: { type: 'string' },
        notes:    { type: 'string' },
        outcome:  { type: 'string' },
      },
    },
  },
  {
    name: 'lf_get_journal',
    description: 'Get recent journal entries from LeanFlow.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  },
];

// ── Tool handlers ────────────────────────────────────────
async function handleTool(name, args) {
  switch (name) {
    case 'lf_get_tasks': {
      let tasks = await getData(K.tasks);
      if (args.status)    tasks = tasks.filter(t => t.status === args.status);
      if (args.overdue)   tasks = tasks.filter(t => t.due && t.due < today() && t.status !== 'done');
      if (args.due_today) tasks = tasks.filter(t => t.due === today() && t.status !== 'done');
      if (args.business)  tasks = tasks.filter(t => (t.business||'').toLowerCase().includes(args.business.toLowerCase()));
      return JSON.stringify(tasks.slice(0, args.limit || 20), null, 2);
    }
    case 'lf_add_task': {
      const tasks = await getData(K.tasks);
      const task = { id: uid(), title: args.title, status: 'todo', due: args.due||null, business: args.business||null, dept: args.dept||null, urgent: args.urgent||false, important: args.important||false, notes: args.notes||'', created: today(), ts: Date.now() };
      tasks.unshift(task);
      await setData(K.tasks, tasks);
      return `Task added: "${task.title}" (id: ${task.id})`;
    }
    case 'lf_complete_task': {
      const tasks = await getData(K.tasks);
      const target = tasks.find(t => t.id === args.id) || tasks.find(t => t.title === args.title);
      if (!target) return 'Task not found. Use lf_get_tasks to list tasks.';
      target.status = 'done'; target.completedAt = today();
      await setData(K.tasks, tasks);
      return `Marked done: "${target.title}"`;
    }
    case 'lf_get_habits': {
      const habits   = await getData(K.habits);
      const habitLog = await getData(K.habitLog);
      const todayLog = habitLog.filter(e => e.date === today()).map(e => e.habitId);
      return JSON.stringify(habits.map(h => ({ id: h.id, name: h.name, emoji: h.emoji||'', done_today: todayLog.includes(h.id), streak: h.streak||0 })), null, 2);
    }
    case 'lf_log_habit': {
      const habits  = await getData(K.habits);
      const target  = habits.find(h => h.name.toLowerCase().includes(args.name.toLowerCase()));
      if (!target) return `Habit not found matching "${args.name}". Use lf_get_habits.`;
      const habitLog = await getData(K.habitLog);
      const date = args.date || today();
      if (habitLog.some(e => e.habitId === target.id && e.date === date)) return `"${target.name}" already logged for ${date}.`;
      habitLog.push({ id: uid(), habitId: target.id, date, ts: Date.now() });
      await setData(K.habitLog, habitLog);
      return `Logged "${target.name}" for ${date}.`;
    }
    case 'lf_get_goals': {
      let goals = await getData(K.goals);
      if (args.status) goals = goals.filter(g => g.status === args.status);
      return JSON.stringify(goals, null, 2);
    }
    case 'lf_add_goal': {
      const goals = await getData(K.goals);
      const goal = { id: uid(), title: args.title, category: args.category||'Other', deadline: args.deadline||null, why: args.why||'', status: 'active', progress: 0, created: today() };
      goals.push(goal);
      await setData(K.goals, goals);
      return `Goal added: "${goal.title}"`;
    }
    case 'lf_get_notes': {
      let notes = await getData(K.notes);
      if (args.status)   notes = notes.filter(n => (n.status||'open').toLowerCase() === args.status);
      if (args.category) notes = notes.filter(n => n.category === args.category);
      return JSON.stringify([...notes].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0, args.limit||20), null, 2);
    }
    case 'lf_add_note': {
      const notes = await getData(K.notes);
      const note = { id: uid(), text: args.text, category: args.category||null, source: args.source||'', status: null, created: today(), ts: Date.now() };
      notes.unshift(note);
      await setData(K.notes, notes);
      return `Note added.`;
    }
    case 'lf_complete_note': {
      const notes = await getData(K.notes);
      const target = notes.find(n => n.id === args.id) || (args.text ? notes.find(n => n.text === args.text) : undefined);
      if (!target) return 'Note not found. Use lf_get_notes to list notes.';
      target.status = 'done'; target.completedAt = today();
      await setData(K.notes, notes);
      return `Marked done: "${target.text.slice(0,60)}…"`;
    }
    case 'lf_add_lesson':
    case 'lf_add_skill':
    case 'lf_add_system': {
      const cat = name === 'lf_add_lesson' ? 'lessons' : name === 'lf_add_skill' ? 'skills' : 'systems';
      const items = await getData(K.knowledge);
      const entry = { id: uid(), category: cat, title: args.title, type: args.type||'Other', skill: args.domain||'Other', source: args.source||'', link: args.link||'', notes: args.notes||'', date: today(), ...(cat==='skills' ? { status: args.status||'todo', progress: args.progress||0 } : {}) };
      items.push(entry);
      await setData(K.knowledge, items);
      return `${cat.slice(0,-1)} added: "${entry.title}"`;
    }
    case 'lf_add_quote': {
      const quotes = await getData(K.quotes);
      quotes.push({ id: uid(), text: args.text, author: args.author||'', source: args.source||'', category: args.category||'Other', date: today() });
      await setData(K.quotes, quotes);
      return `Quote saved.`;
    }
    case 'lf_get_meetings': {
      const meetings = await getData(K.meetings);
      return JSON.stringify([...meetings].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0, args.limit||10), null, 2);
    }
    case 'lf_add_meeting': {
      const meetings = await getData(K.meetings);
      const meeting = { id: uid(), title: args.title, date: args.date, time: args.time||'', business: args.business||'', notes: args.notes||'', outcome: args.outcome||'', created: today() };
      meetings.unshift(meeting);
      await setData(K.meetings, meetings);
      return `Meeting added: "${meeting.title}" on ${meeting.date}`;
    }
    case 'lf_get_journal': {
      const entries = await getData(K.journal);
      return JSON.stringify([...entries].sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0, args.limit||7), null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ── MCP server factory ───────────────────────────────────
function makeServer() {
  const server = new Server(
    { name: 'leanflow', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await handleTool(req.params.name, req.params.arguments || {});
      return { content: [{ type: 'text', text: result }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
    }
  });
  return server;
}

// ── HTTP server ──────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessions = new Map(); // sessionId -> transport
const codes    = new Map(); // code -> { challenge, ts }

// ── OAuth 2.0 endpoints (required by Claude Cowork) ──────
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    issuer: base,
    authorization_endpoint:              `${base}/authorize`,
    token_endpoint:                      `${base}/token`,
    registration_endpoint:               `${base}/register`,
    response_types_supported:            ['code'],
    grant_types_supported:               ['authorization_code'],
    code_challenge_methods_supported:    ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  });
});

app.post('/register', (req, res) => {
  res.json({
    client_id:              randomUUID(),
    client_secret:          randomUUID(),
    redirect_uris:          req.body?.redirect_uris || [],
    grant_types:            ['authorization_code'],
    response_types:         ['code'],
    token_endpoint_auth_method: 'none',
  });
});

app.get('/authorize', (req, res) => {
  const { redirect_uri, state, code_challenge, code_challenge_method } = req.query;
  if (!redirect_uri) { res.status(400).send('redirect_uri required'); return; }
  const code = randomUUID();
  codes.set(code, { challenge: code_challenge, method: code_challenge_method, ts: Date.now() });
  for (const [k, v] of codes) if (Date.now() - v.ts > 600_000) codes.delete(k);
  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.post('/token', (req, res) => {
  const { code, grant_type, code_verifier } = req.body;
  if (grant_type !== 'authorization_code') {
    res.status(400).json({ error: 'unsupported_grant_type' }); return;
  }
  const stored = codes.get(code);
  if (!stored) { res.status(400).json({ error: 'invalid_grant' }); return; }
  if (stored.challenge && code_verifier) {
    const expected = createHash('sha256').update(code_verifier).digest('base64url');
    if (expected !== stored.challenge) {
      res.status(400).json({ error: 'invalid_grant' }); return;
    }
  }
  codes.delete(code);
  res.json({ access_token: MCP_TOKEN, token_type: 'Bearer', expires_in: 31_536_000 });
});

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${MCP_TOKEN}`) {
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  next();
}

app.all('/mcp', requireAuth, async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];

    if (req.method === 'POST' && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport),
      });
      transport.onclose = () => sessions.delete(transport.sessionId);
      await makeServer().connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Session not found' } });
      return;
    }
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get('/health', (_req, res) => res.json({ ok: true, sessions: sessions.size }));

app.listen(PORT, () => console.log(`LeanFlow MCP remote → http://localhost:${PORT}/mcp`));
